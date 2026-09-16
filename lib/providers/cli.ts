import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenerateOptions, Provider } from './types';
import { ProviderError } from './types';

/**
 * Drives an agent CLI the user already has installed, in one-shot mode.
 * No API key, no per-token cost to them beyond the subscription they already pay for.
 */

type CliKind = 'claude' | 'codex';

interface CliSpec {
  bin: string;
  label: string;
  /** Builds argv for a single non-interactive completion. */
  args(prompt: string): string[];
  /** Some CLIs wrap their answer; pull the text back out. */
  parse(stdout: string): string;
}

const SPECS: Record<CliKind, CliSpec> = {
  claude: {
    bin: 'claude',
    label: 'Claude Code',
    // -p prints one response and exits. The prompt goes on stdin, so it can be any
    // length and never has to survive shell quoting.
    // --allowedTools with an empty set is the important part: Lore feeds third-party
    // text (tweets, reddit threads, scraped pages) into these prompts, and without it
    // a crafted post could talk the agent into using its file or shell tools.
    args: () => ['-p', '--allowedTools', ''],
    parse: (out) => out.trim(),
  },
  codex: {
    bin: 'codex',
    label: 'Codex',
    // We run from a temp dir, which codex refuses by default as untrusted.
    // read-only sandbox for the same reason claude gets an empty tool list.
    args: () => ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-'],
    parse: (out) => out.trim(),
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

function run(bin: string, args: string[], input: string, timeoutMs: number): Promise<string> {
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
      reject(new ProviderError(`${bin} did not respond within ${Math.round(timeoutMs / 1000)}s`, 'cli'));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ProviderError(`could not start ${bin}: ${err.message}`, 'cli', true));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      // An expired or missing login is the most common failure by far, and the user
      // can fix it in one command, so name it instead of surfacing an exit code.
      // Checked even on exit 0: some CLIs print an auth error and still exit clean.
      const blob = `${stderr}\n${stdout}`;
      const looksUnauthed = /log ?in|sign in|unauthor|401|credential|access token|expired/i.test(blob);
      if (looksUnauthed) {
        reject(new ProviderError(
          `${bin} is installed but not signed in. Run \`${bin}\` once in a terminal, sign in, then retry.`,
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
        `${bin} exited with code ${code}: ${stderr.trim().slice(0, 400)}`,
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
      const out = await run(spec.bin, spec.args(opts.prompt), opts.prompt, opts.timeoutMs ?? 120_000);
      const text = spec.parse(out);
      if (!text) throw new ProviderError(`${spec.bin} returned an empty response`, 'cli');
      return text;
    },
  };
}
