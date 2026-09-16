import { spawn } from 'node:child_process';
import { access, constants, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenerateOptions, Provider } from './types';
import { ProviderError } from './types';

/**
 * Drives an agent CLI the user already has installed, in one-shot mode.
 * No API key, no per-token cost to them beyond the subscription they already pay for.
 */

export type CliKind = 'claude' | 'codex';

interface CliSpec {
  bin: string;
  label: string;
  /** Which subscription it runs on, for the setup screen. */
  plan: string;
  /** The command that fixes a missing or expired login. */
  login: string;
  /** Builds argv for a single non-interactive completion. `outFile` is a scratch file the CLI may write its answer to. */
  args(outFile: string): string[];
  /** Pull the answer back out, from stdout or the scratch file. */
  parse(stdout: string, outFile: string): Promise<string>;
}

const SPECS: Record<CliKind, CliSpec> = {
  claude: {
    bin: 'claude',
    label: 'Claude Code',
    plan: 'your Claude subscription',
    login: 'claude',
    // -p prints one response and exits. The prompt goes on stdin, so it can be any
    // length and never has to survive shell quoting.
    // --tools '' is the important part: Lore feeds third-party text (tweets, threads,
    // scraped pages) into these prompts, and without it a crafted post could talk the
    // agent into using its file or shell tools.
    // The rest keeps the user's own Claude Code setup out of Lore's writing: no hooks
    // or settings, no CLAUDE.md, no MCP servers starting up, no saved sessions.
    args: () => [
      '-p', '--tools', '', '--strict-mcp-config', '--setting-sources', '',
      '--no-session-persistence', '--disable-slash-commands',
    ],
    parse: async (out) => out.trim(),
  },
  codex: {
    bin: 'codex',
    label: 'Codex',
    plan: 'your ChatGPT subscription',
    login: 'codex login',
    // We run from a temp dir, which codex refuses by default as untrusted.
    // read-only sandbox for the same reason claude gets no tools. Codex prints its
    // progress to stdout, so the final answer is read from the -o file instead.
    args: (outFile) => [
      'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral',
      '--color', 'never', '-o', outFile, '-',
    ],
    parse: async (_out, outFile) => (await readFile(outFile, 'utf8').catch(() => '')).trim(),
  },
};

async function onPath(bin: string): Promise<string | null> {
  const dirs = (process.env.PATH ?? '').split(':').filter(Boolean);
  for (const dir of dirs) {
    const full = join(dir, bin);
    try {
      await access(full, constants.X_OK);
      return full;
    } catch {
      // not here, keep looking
    }
  }
  return null;
}

/** Returns the CLIs actually available on this machine, in preference order. */
export function cliInfo(kind: CliKind): { label: string; plan: string; login: string } {
  const { label, plan, login } = SPECS[kind];
  return { label, plan, login };
}

export async function detectClis(): Promise<CliKind[]> {
  const found: CliKind[] = [];
  for (const kind of ['claude', 'codex'] as CliKind[]) {
    if (await onPath(SPECS[kind].bin)) found.push(kind);
  }
  return found;
}

/**
 * The child is an agent, so it gets the smallest environment that still lets it
 * find its own credentials. Handing it the parent's env would pass DATABASE_URL,
 * AUTH_SECRET, Stripe keys and every API key to a process driven by a model.
 */
function childEnv(): NodeJS.ProcessEnv {
  const keep = [
    'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR',
    'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  ];
  const env: Record<string, string> = {};
  for (const k of keep) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return env as NodeJS.ProcessEnv;
}

// The web app can fire several requests at once. Each one here is a whole agent
// process on the user's machine and counts against their subscription limits, so
// only a few run at a time and the rest wait their turn.
const MAX_PARALLEL = Math.max(1, Number(process.env.LORE_CLI_CONCURRENCY) || 3);
let running = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function run(spec: CliSpec, args: string[], input: string, timeoutMs: number): Promise<string> {
  const bin = spec.bin;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Never inherit the parent's cwd blindly: the agent may read files relative to it.
      cwd: tmpdir(),
      env: childEnv(),
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new ProviderError(`${spec.label} did not answer within ${Math.round(timeoutMs / 1000)}s. Try again, it can be slow when busy.`, 'cli'));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ProviderError(`Could not start ${spec.label} (${bin}): ${err.message}`, 'cli', true));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      // An expired or missing login is the most common failure by far, and the user
      // can fix it in one command, so name it instead of surfacing an exit code.
      // Checked even on exit 0: some CLIs print an auth error and still exit clean.
      const blob = `${stderr}\n${code === 0 ? '' : stdout}`;
      const looksUnauthed = /not logged in|log ?in again|sign in again|please (log|sign) ?in|unauthori[sz]ed|401|invalid api key|credential|access token|token (has )?expired|refresh token/i.test(blob);
      if (looksUnauthed && (code !== 0 || !stdout.trim())) {
        reject(new ProviderError(
          `${spec.label} is installed but not signed in. Run \`${spec.login}\` in a terminal, sign in, then try again.`,
          'cli',
          true,
        ));
        return;
      }

      if (/usage limit|rate limit (reached|exceeded)|you've hit your|quota exceeded|too many requests|exceeded your (current )?quota/i.test(blob) && code !== 0) {
        reject(new ProviderError(
          `${spec.label} hit the usage limit on ${spec.plan}. Wait for it to reset, or switch models in setup.`,
          'cli',
          true,
        ));
        return;
      }
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new ProviderError(
        `${spec.label} stopped with an error: ${(stderr.trim() || stdout.trim()).split('\n').slice(-3).join(' ').slice(0, 300)}`,
        'cli',
      ));
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

export function createCliProvider(kind: CliKind): Provider {
  const spec = SPECS[kind];
  return {
    id: 'cli',
    label: `${spec.label} (${spec.bin})`,
    // The one-shot text interface has no portable way to attach an image, so vision
    // falls back to an HTTP provider when one is configured.
    supportsVision: false,

    async generate(opts: GenerateOptions): Promise<string> {
      if (opts.role === 'vision') {
        throw new ProviderError(
          `${spec.label} cannot handle image analysis in one-shot mode. Add an API key to enable visual features.`,
          'cli',
          true,
        );
      }
      return withSlot(async () => {
        const dir = await mkdtemp(join(tmpdir(), 'lore-cli-'));
        const outFile = join(dir, 'answer.txt');
        try {
          const out = await run(spec, spec.args(outFile), opts.prompt, opts.timeoutMs ?? 180_000);
          const text = await spec.parse(out, outFile);
          if (!text) throw new ProviderError(`${spec.label} returned an empty response`, 'cli');
          return text;
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        }
      });
    },
  };
}
