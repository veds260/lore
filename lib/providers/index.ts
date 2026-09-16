import { createCliProvider, detectClis } from './cli';
import { createHttpProvider, type Backend } from './http';
import type { GenerateOptions, Provider } from './types';
import { ProviderError } from './types';

export type { Provider, GenerateOptions, Role } from './types';
export { ProviderError } from './types';

/**
 * Picks how Lore talks to a model, in this order:
 *
 *   1. LORE_PROVIDER, when the user has pinned one explicitly.
 *   2. An API key in the environment.
 *   3. An agent CLI on PATH (claude, then codex).
 *
 * Keys win over the CLI when both exist because a key is an explicit choice,
 * while a CLI is usually just present. Self-hosters with neither get a clear
 * error naming both ways out.
 */

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

  const pinned = process.env.LORE_PROVIDER?.trim().toLowerCase();

  if (pinned === 'cli' || (!pinned && !keyBackend())) {
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
  if (keyed && pinned !== 'cli') {
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
