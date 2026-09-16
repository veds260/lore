import { cliInfo, createCliProvider, detectClis, type CliKind } from './cli';
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

export interface BackendOption {
  id: BackendChoice;
  label: string;
  /** What it bills against, in plain words. */
  plan: string;
  available: boolean;
  /** How to make it available when it is not. */
  howTo: string;
}

export async function backendOptions(): Promise<{ options: BackendOption[]; active: BackendChoice | null; pinned: boolean }> {
  const clis = await detectClis();
  const keyed = keyBackend();
  const claude = cliInfo('claude');
  const options: BackendOption[] = [
    {
      id: 'claude', label: claude.label, plan: 'Uses your Claude Pro or Max subscription', available: clis.includes('claude'),
      howTo: 'Install Claude Code with `npm install -g @anthropic-ai/claude-code`, run `claude` once and sign in',
    },
    {
      id: 'codex', label: 'ChatGPT (Codex)', plan: 'Uses your ChatGPT Plus or Pro subscription', available: clis.includes('codex'),
      howTo: 'Install Codex with `npm install -g @openai/codex`, then run `codex login`',
    },
    {
      id: 'api', label: 'API key', plan: keyed ? `Pay per use with your ${keyed.backend} key` : 'Pay per use with an API key', available: Boolean(keyed),
      howTo: 'Put ANTHROPIC_API_KEY, OPENAI_API_KEY or OPENROUTER_API_KEY in .env.local and restart',
    },
  ];
  let active: BackendChoice | null = null;
  try {
    const p = await resolveProvider();
    active = p.id === 'http' ? 'api' : p.label.includes('(codex)') ? 'codex' : 'claude';
  } catch {
    active = null;
  }
  return { options, active, pinned: Boolean(asChoice(process.env.LORE_PROVIDER) || process.env.LORE_PROVIDER?.trim().toLowerCase() === 'cli') };
}

/** Sends one tiny prompt through the active backend, so setup can prove it really answers. */
export async function testModel(): Promise<{ ok: true; provider: string; ms: number } | { ok: false; provider: string | null; error: string }> {
  let provider: Provider;
  try {
    provider = await resolveProvider();
  } catch (err) {
    return { ok: false, provider: null, error: err instanceof Error ? err.message : String(err) };
  }
  const started = Date.now();
  try {
    const out = await provider.generate({ role: 'extract', prompt: 'Reply with the single word READY.', maxTokens: 10, timeoutMs: 90_000 });
    if (!out.trim()) throw new ProviderError('The model returned nothing', provider.id);
    return { ok: true, provider: provider.label, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, provider: provider.label, error: err instanceof Error ? err.message : String(err) };
  }
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
    'No model backend available. Either install Claude Code (`claude`) and sign in, or set ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY.',
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
