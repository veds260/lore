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
  /** argv for the browser sign-in, run by the setup page on a local install. */
  loginArgs: string[];
  /** argv that reports whether the CLI is signed in. */
  statusArgs: string[];
  /** Commands that install it, most common first. */
  install: string[];
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
    login: 'claude auth login',
    loginArgs: ['auth', 'login', '--claudeai'],
    statusArgs: ['auth', 'status'],
    install: ['npm install -g @anthropic-ai/claude-code'],
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
    loginArgs: ['login'],
    statusArgs: ['login', 'status'],
    install: ['npm install -g @openai/codex', 'brew install codex'],
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


const SIGNED_OUT = /not logged in|log ?in again|sign(ed)? in again|please (log|sign) ?in|run \/login|unauthori[sz]ed|\b401\b|invalid api key|credential|access token|token (has )?expired|refresh token|could not be refreshed/i;

function looksSignedOut(text: string): boolean {
  return SIGNED_OUT.test(text);
}

/**
 * The most useful line a CLI printed, for showing to the user. Codex logs a lot
 * of timestamped noise before the real error, so error lines win, then the last line.
 */
function cliSaid(text: string): string {
  const lines = text.split('\n')
    .map((l) => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+/, '').replace(/\x1b\[[0-9;]*m/g, '').trim())
    .filter(Boolean);
  const errors = lines.filter((l) => /^error\b|error:/i.test(l) && !/rmcp::|mcp/i.test(l));
  const pick = errors.at(-1) ?? lines.at(-1) ?? '';
  return pick.replace(/^ERROR:?\s*/i, '').replace(/^[\w:]+:\s(?=[A-Z])/, '').slice(0, 240);
}

// Shared across route bundles in the same process, so a failed generation on one
// page shows up as signed out on the setup page.
type AuthMemo = Partial<Record<CliKind, { at: number; said: string }>>;
const g = globalThis as typeof globalThis & { __loreCliAuth?: AuthMemo; __loreCliLogin?: Partial<Record<CliKind, LoginRun>> };
const authFailures: AuthMemo = (g.__loreCliAuth ??= {});

function noteAuthFailure(kind: CliKind, said: string) {
  authFailures[kind] = { at: Date.now(), said };
}

function clearAuthFailure(kind: CliKind) {
  delete authFailures[kind];
}

/** "Check again" on setup: the person may have signed in from a terminal since the last failure. */
export function forgetAuthFailures() {
  delete authFailures.claude;
  delete authFailures.codex;
}

function runQuiet(bin: string, args: string[], timeoutMs: number, env: NodeJS.ProcessEnv = childEnv()): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: tmpdir(), env });
    } catch (err) {
      resolve({ code: null, out: err instanceof Error ? err.message : String(err) });
      return;
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: null, out: err.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

export interface CliStatus {
  installed: boolean;
  /** null when the CLI answered in a way we could not read. */
  signedIn: boolean | null;
  /** How it is signed in, in plain words: "Claude Max subscription", "ChatGPT". */
  account?: string;
  /** What the CLI itself said when it is not signed in or could not be checked. */
  said?: string;
}

/** Installed and signed in are different things. This asks the CLI for both. */
export async function cliStatus(kind: CliKind): Promise<CliStatus> {
  const spec = SPECS[kind];
  if (!(await onPath(spec.bin))) return { installed: false, signedIn: false };

  const { code, out } = await runQuiet(spec.bin, spec.statusArgs, 20_000);
  let status: CliStatus;

  if (kind === 'claude') {
    const json = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
    try {
      const parsed = JSON.parse(json) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };
      const plan = parsed.subscriptionType ? `Claude ${parsed.subscriptionType[0].toUpperCase()}${parsed.subscriptionType.slice(1)}` : 'Claude';
      status = parsed.loggedIn
        ? { installed: true, signedIn: true, account: parsed.authMethod === 'claude.ai' ? `${plan} subscription` : parsed.authMethod === 'console' ? 'Anthropic Console, billed per use' : parsed.authMethod || 'signed in' }
        : { installed: true, signedIn: false, said: 'Not logged in' };
    } catch {
      status = { installed: true, signedIn: null, said: cliSaid(out) || `exit code ${code}` };
    }
  } else {
    const m = out.match(/Logged in using (.+)/i);
    if (m) status = { installed: true, signedIn: true, account: m[1].trim() };
    else if (/not logged in/i.test(out)) status = { installed: true, signedIn: false, said: 'Not logged in' };
    else status = { installed: true, signedIn: null, said: cliSaid(out) || `exit code ${code}` };
  }

  // A status check only reads the saved login. Codex can report "Logged in" with a
  // refresh token the server already rejected, which only shows up on a real call.
  const failed = authFailures[kind];
  if (status.signedIn && failed) return { ...status, signedIn: false, said: failed.said || 'The saved sign-in stopped working' };
  return status;
}

export interface LoginRun {
  kind: CliKind;
  startedAt: number;
  done: boolean;
  code: number | null;
  /** A sign-in link the CLI printed, for when no browser opened. */
  url?: string;
  said?: string;
  child?: ReturnType<typeof spawn>;
}

const logins: Partial<Record<CliKind, LoginRun>> = (g.__loreCliLogin ??= {});
const LOGIN_MAX_MS = 10 * 60_000;

export function loginState(kind: CliKind): Omit<LoginRun, 'child'> | null {
  const run = logins[kind];
  if (!run) return null;
  return { kind: run.kind, startedAt: run.startedAt, done: run.done, code: run.code, url: run.url, said: run.said };
}

/**
 * Runs the CLI's own browser sign-in on this machine. Only for a local install,
 * where the person at the setup page is also the person at this computer.
 */
export async function startCliLogin(kind: CliKind): Promise<Omit<LoginRun, 'child'>> {
  const existing = logins[kind];
  if (existing && !existing.done && Date.now() - existing.startedAt < LOGIN_MAX_MS) return loginState(kind)!;

  const spec = SPECS[kind];
  if (!(await onPath(spec.bin))) throw new ProviderError(`${spec.label} is not installed. Install it with \`${spec.install[0]}\` first.`, 'cli', true);

  // The sign-in opens a browser, which needs the display variables the model runs never get.
  const env = childEnv();
  for (const k of ['DISPLAY', 'WAYLAND_DISPLAY', 'BROWSER', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR']) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }

  const run: LoginRun = { kind, startedAt: Date.now(), done: false, code: null };
  let out = '';
  const child = spawn(/*turbopackIgnore: true*/ spec.bin, spec.loginArgs, { stdio: ['pipe', 'pipe', 'pipe'], cwd: tmpdir(), env });
  run.child = child;
  const onData = (d: Buffer) => {
    out += d.toString();
    run.url ??= out.match(/https:\/\/\S+/)?.[0]?.replace(/[)\].,]+$/, '');
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const timer = setTimeout(() => child.kill('SIGTERM'), LOGIN_MAX_MS);
  child.on('error', (err) => { run.done = true; run.said = err.message; clearTimeout(timer); });
  child.on('close', (code) => {
    run.done = true;
    run.code = code;
    clearTimeout(timer);
    if (code === 0) clearAuthFailure(kind);
    else run.said = cliSaid(out) || `exit code ${code}`;
  });
  logins[kind] = run;
  return loginState(kind)!;
}

export function cliInfo(kind: CliKind): { label: string; plan: string; login: string; install: string[] } {
  const { label, plan, login, install } = SPECS[kind];
  return { label, plan, login, install };
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
      const said = cliSaid(blob);
      if (looksSignedOut(blob) && (code !== 0 || !stdout.trim())) {
        noteAuthFailure(spec.bin as CliKind, said);
        reject(new ProviderError(
          `${spec.label} is not signed in${said ? ` (it said: ${said.replace(/[.\s]+$/, '')})` : ''}. Sign in again from the setup page, or run \`${spec.login}\` in a terminal.`,
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
        clearAuthFailure(spec.bin as CliKind);
        resolve(stdout);
        return;
      }
      reject(new ProviderError(
        `${spec.label} stopped with an error: ${said || `exit code ${code}`}`,
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
