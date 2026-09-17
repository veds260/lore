import { createHash } from 'node:crypto';
import { cliInfo, cliStatus, createCliProvider, detectClis, loginState, type CliKind, type CliStatus, type LoginRun } from './cli';
import { createHttpProvider, type Backend } from './http';
import type { GenerateOptions, Provider } from './types';
import { ProviderError } from './types';

export type { Provider, GenerateOptions, Role } from './types';
export { ProviderError } from './types';

/**
 * Picks how Lore talks to a model, in this order:
 *
 *   1. LORE_PROVIDER in the environment: claude, codex, cli or api.
 *   2. The choice made on the setup screen, saved in the database.
 *   3. An API key in the environment.
 *   4. An agent CLI on PATH (claude, then codex).
 *
 * Keys win over a CLI by default because a key is an explicit choice, while a CLI
 * is usually just present. Self-hosters with neither get a clear error naming both
 * ways out.
 */

export type BackendChoice = CliKind | 'api';
const CHOICE_SETTING = 'model_backend';
const CHOICE_CACHE_MS = 30_000;
let choiceCache: { value: BackendChoice | null; at: number } | null = null;

function asChoice(v: string | undefined | null): BackendChoice | null {
  const x = v?.trim().toLowerCase();
  return x === 'claude' || x === 'codex' || x === 'api' ? x : null;
}

async function savedChoice(): Promise<BackendChoice | null> {
  if (choiceCache && Date.now() - choiceCache.at < CHOICE_CACHE_MS) return choiceCache.value;
  let value: BackendChoice | null = null;
  try {
    const { db } = await import('@/lib/db');
    const { instanceSettings } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select({ value: instanceSettings.value }).from(instanceSettings)
      .where(eq(instanceSettings.key, CHOICE_SETTING)).limit(1);
    value = asChoice(row?.value);
  } catch {
    value = null;
  }
  choiceCache = { value, at: Date.now() };
  return value;
}

/** Saves the model picked on the setup screen and makes the next call use it. */
export async function saveBackendChoice(choice: BackendChoice): Promise<void> {
  const { db } = await import('@/lib/db');
  const { instanceSettings } = await import('@/lib/db/schema');
  const now = new Date();
  await db.insert(instanceSettings).values({ key: CHOICE_SETTING, value: choice, updatedAt: now })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value: choice, updatedAt: now } });
  choiceCache = null;
  resetProviderCache();
}

export type KeyBackend = Backend;

export interface BackendOption {
  id: BackendChoice;
  label: string;
  /** What it bills against, in plain words. */
  plan: string;
  /** Ready to pick: installed and signed in for a CLI, a key set for the API. */
  available: boolean;
  installed: boolean;
  signedIn: boolean | null;
  /** How the CLI is signed in, or which key is set. */
  account?: string;
  /** What the CLI said when it is not signed in. */
  said?: string;
  /** Install commands, when it is not installed. */
  install?: string[];
  /** Terminal command that signs in, for when the button is not offered. */
  login?: string;
  loginRun?: Omit<LoginRun, 'child'> | null;
}

function cliOption(kind: CliKind, status: CliStatus): BackendOption {
  const info = cliInfo(kind);
  return {
    id: kind,
    label: kind === 'claude' ? 'Claude' : 'ChatGPT',
    plan: kind === 'claude' ? 'Runs on your Claude Pro or Max plan through Claude Code' : 'Runs on your ChatGPT Plus or Pro plan through Codex',
    available: status.installed && status.signedIn !== false,
    installed: status.installed,
    signedIn: status.signedIn,
    account: status.account,
    said: status.said,
    install: status.installed ? undefined : info.install,
    login: info.login,
    loginRun: loginState(kind),
  };
}

export async function backendOptions(): Promise<{ options: BackendOption[]; active: BackendChoice | null; pinned: boolean }> {
  const [claude, codex] = await Promise.all([cliStatus('claude'), cliStatus('codex')]);
  const keyed = keyBackend();
  const options: BackendOption[] = [
    cliOption('claude', claude),
    cliOption('codex', codex),
    {
      id: 'api', label: 'API key', plan: 'Billed per use by Anthropic, OpenAI or OpenRouter', available: Boolean(keyed),
      installed: Boolean(keyed), signedIn: Boolean(keyed),
      account: keyed ? `${KEY_NAMES[keyed.backend]} key ending ${keyed.key.slice(-4)}` : undefined,
    },
  ];
  let active: BackendChoice | null = null;
  try {
    active = choiceOf(await resolveProvider());
  } catch {
    active = null;
  }
  return { options, active, pinned: Boolean(asChoice(process.env.LORE_PROVIDER) || process.env.LORE_PROVIDER?.trim().toLowerCase() === 'cli') };
}

const KEY_NAMES: Record<Backend, string> = { anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter' };
const KEY_ENV: Record<Backend, string> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY' };

function choiceOf(p: Provider): BackendChoice {
  return p.id === 'http' ? 'api' : p.label.includes('(codex)') ? 'codex' : 'claude';
}

/**
 * What a passing test proved. A CLI is identified by name, a key by a hash of the
 * key itself, so swapping in a different key needs a fresh test.
 */
function fingerprint(p: Provider): string {
  const choice = choiceOf(p);
  if (choice !== 'api') return choice;
  const keyed = keyBackend();
  return keyed ? `api:${keyed.backend}:${createHash('sha256').update(keyed.key).digest('hex').slice(0, 16)}` : 'api';
}

const VERIFIED_SETTING = 'model_verified';

async function readVerified(): Promise<string | null> {
  try {
    const { db } = await import('@/lib/db');
    const { instanceSettings } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select({ value: instanceSettings.value }).from(instanceSettings).where(eq(instanceSettings.key, VERIFIED_SETTING)).limit(1);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function writeVerified(value: string | null): Promise<void> {
  const { db } = await import('@/lib/db');
  const { instanceSettings } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  if (value === null) {
    await db.delete(instanceSettings).where(eq(instanceSettings.key, VERIFIED_SETTING));
    return;
  }
  const now = new Date();
  await db.insert(instanceSettings).values({ key: VERIFIED_SETTING, value, updatedAt: now })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value, updatedAt: now } });
}

export async function clearModelVerified(): Promise<void> {
  await writeVerified(null);
}

/**
 * The one gate for "Lore has a model that really answered". True only when the
 * backend in use right now is the one that last passed a live test on setup.
 */
export async function modelReady(): Promise<boolean> {
  let provider: Provider;
  try {
    provider = await resolveProvider();
  } catch {
    return false;
  }
  return (await readVerified()) === fingerprint(provider);
}

/** Sends one tiny prompt through the active backend, so setup can prove it really answers. */
export async function testModel(): Promise<{ ok: true; provider: string; ms: number; reply: string } | { ok: false; provider: string | null; error: string }> {
  let provider: Provider;
  try {
    resetProviderCache();
    provider = await resolveProvider();
  } catch (err) {
    await writeVerified(null).catch(() => {});
    return { ok: false, provider: null, error: err instanceof Error ? err.message : String(err) };
  }
  const started = Date.now();
  try {
    const out = await provider.generate({ role: 'extract', prompt: 'Reply with the single word READY and nothing else.', maxTokens: 10, timeoutMs: 90_000 });
    if (!out.trim()) throw new ProviderError('The model returned nothing', provider.id);
    await writeVerified(fingerprint(provider));
    return { ok: true, provider: provider.label, ms: Date.now() - started, reply: out.trim().slice(0, 40) };
  } catch (err) {
    await writeVerified(null).catch(() => {});
    return { ok: false, provider: provider.label, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Only letters, digits and the few symbols real keys use, so nothing can break out of the env file line. */
const KEY_SHAPE = /^[A-Za-z0-9_\-.]{20,300}$/;

/**
 * Checks a pasted key with a real call first, and only keeps it when the provider
 * accepts it. A rejected key is never written anywhere.
 */
export async function saveApiKey(backend: Backend, key: string): Promise<{ ok: true; ms: number } | { ok: false; error: string }> {
  const clean = key.trim();
  if (!KEY_SHAPE.test(clean)) return { ok: false, error: 'That does not look like an API key. Copy the whole key and paste it again' };

  const started = Date.now();
  try {
    const out = await createHttpProvider(backend, clean).generate({ role: 'extract', prompt: 'Reply with the single word READY and nothing else.', maxTokens: 10, timeoutMs: 45_000 });
    if (!out.trim()) return { ok: false, error: `${KEY_NAMES[backend]} answered with nothing. Try again` };
  } catch (err) {
    if (err instanceof ProviderError && err.userActionable) {
      return { ok: false, error: `${KEY_NAMES[backend]} did not accept that key (${err.message.match(/\((\d{3})\)/)?.[1] ?? 'rejected'}). Check you copied all of it and that the account has billing set up` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not check the key with ${KEY_NAMES[backend]}: ${msg}` };
  }

  const { writeEnvLocal } = await import('@/lib/setup/env-file');
  const updates: Record<string, string | null> = { [KEY_ENV[backend]]: clean };
  // Lore picks the first key it finds, so a new key replaces the other providers' keys.
  for (const other of Object.keys(KEY_ENV) as Backend[]) {
    if (other !== backend) updates[KEY_ENV[other]] = null;
  }
  await writeEnvLocal(updates);
  for (const [k, v] of Object.entries(updates)) {
    if (v === null) delete process.env[k];
    else process.env[k] = v;
  }
  await saveBackendChoice('api');
  const provider = await resolveProvider();
  await writeVerified(fingerprint(provider));
  return { ok: true, ms: Date.now() - started };
}

let cached: Provider | null = null;
let cachedVision: Provider | null = null;

function keyBackend(): { backend: Backend; key: string } | null {
  const { ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY } = process.env;
  if (ANTHROPIC_API_KEY) return { backend: 'anthropic', key: ANTHROPIC_API_KEY };
  if (OPENAI_API_KEY) return { backend: 'openai', key: OPENAI_API_KEY };
  if (OPENROUTER_API_KEY) return { backend: 'openrouter', key: OPENROUTER_API_KEY };
  return null;
}

export async function resolveProvider(): Promise<Provider> {
  if (cached) return cached;

  const envPin = process.env.LORE_PROVIDER?.trim().toLowerCase();
  const choice = asChoice(envPin) ?? (envPin === 'cli' ? null : await savedChoice());
  const pinned = envPin === 'cli' ? 'cli' : choice;

  if (choice === 'claude' || choice === 'codex') {
    const clis = await detectClis();
    if (clis.includes(choice)) {
      cached = createCliProvider(choice);
      return cached;
    }
    const info = cliInfo(choice);
    throw new ProviderError(
      `${info.label} is selected but \`${choice}\` was not found on PATH. Install it, or pick another model in setup.`,
      'cli',
      true,
    );
  }

  if (choice === 'api') {
    const keyed = keyBackend();
    if (keyed) {
      cached = createHttpProvider(keyed.backend, keyed.key);
      return cached;
    }
    throw new ProviderError('API key is selected but no key is set. Add one to .env.local, or pick another model in setup.', 'http', true);
  }

  if (pinned === 'cli' || !keyBackend()) {
    const clis = await detectClis();
    if (clis.length) {
      cached = createCliProvider(clis[0]);
      return cached;
    }
    if (pinned === 'cli') {
      throw new ProviderError(
        'LORE_PROVIDER=cli but no agent CLI was found on PATH. Install Claude Code or Codex, or set an API key instead.',
        'cli',
        true,
      );
    }
  }

  const keyed = keyBackend();
  if (keyed) {
    cached = createHttpProvider(keyed.backend, keyed.key);
    return cached;
  }

  throw new ProviderError(
    'No model is set up yet. Sign in to Claude Code or Codex, or add an API key, on the setup page at /setup.',
    'none',
    true,
  );
}

/**
 * Vision needs a backend that can take an image. A CLI in one-shot mode cannot,
 * so we fall back to a key when one exists rather than failing the whole request.
 */
async function resolveVisionProvider(): Promise<Provider> {
  if (cachedVision) return cachedVision;

  const primary = await resolveProvider();
  if (primary.supportsVision) {
    cachedVision = primary;
    return cachedVision;
  }

  const keyed = keyBackend();
  if (!keyed) {
    throw new ProviderError(
      `${primary.label} cannot analyse images. Set an API key to turn on visual features, or leave them off.`,
      primary.id,
      true,
    );
  }
  cachedVision = createHttpProvider(keyed.backend, keyed.key);
  return cachedVision;
}

/** True when some backend can answer, either an agent CLI on PATH or an API key. */
export async function modelAvailable(): Promise<boolean> {
  try {
    await resolveProvider();
    return true;
  } catch {
    return false;
  }
}

export async function generate(opts: GenerateOptions): Promise<string> {
  const provider = opts.role === 'vision' ? await resolveVisionProvider() : await resolveProvider();
  return provider.generate(opts);
}

/** Setup screen and `lore doctor` both render this. */
export async function describeSetup(): Promise<{
  ready: boolean;
  provider: string | null;
  vision: boolean;
  clisFound: string[];
  hint: string;
}> {
  const clisFound = await detectClis();
  try {
    const p = await resolveProvider();
    let vision = p.supportsVision;
    if (!vision) {
      try { await resolveVisionProvider(); vision = true; } catch { vision = false; }
    }
    return {
      ready: true,
      provider: p.label,
      vision,
      clisFound,
      hint: vision ? '' : 'Image features are off. Add an API key to turn them on.',
    };
  } catch (err) {
    return {
      ready: false,
      provider: null,
      vision: false,
      clisFound,
      hint: err instanceof ProviderError ? err.message : String(err),
    };
  }
}

/** Tests and the setup screen re-run detection after the user changes something. */
export function resetProviderCache(): void {
  cached = null;
  cachedVision = null;
}

/**
 * What an API route sends back when a model call throws. A fixable problem (not
 * signed in, usage limit, nothing set up) comes through word for word so the page
 * can show it, anything else stays a plain 500.
 */
export function modelErrorBody(err: unknown): { status: number; body: { error: string; type?: 'model_setup' } } {
  if (err instanceof ProviderError && err.userActionable) {
    return { status: 503, body: { error: err.message, type: 'model_setup' } };
  }
  if (err instanceof ProviderError) return { status: 502, body: { error: err.message } };
  return { status: 500, body: { error: err instanceof Error ? err.message : String(err) } };
}
