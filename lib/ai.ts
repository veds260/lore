import { generate, type Role } from './providers';

/**
 * Model roles.
 *
 * These used to be OpenRouter model slugs. They are now role tokens: the active
 * provider decides what each one means for the backend it is talking to, so the
 * same call works against a local Claude Code CLI, a direct API key, or the
 * hosted relay without any call site changing.
 *
 * Kept as MODEL_* exports because ~70 call sites import them by that name.
 */
export const MODEL_CREATIVE: Role = 'creative';
export const MODEL_TWITTER: Role = 'creative';
export const MODEL_LONG_CONTEXT: Role = 'longform';
export const MODEL_EXTRACT: Role = 'extract';
export const MODEL_AGENT: Role = 'agent';

interface CallOptions {
  model: Role;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}

export async function callAI({ model, prompt, temperature = 0.8, maxTokens = 2000 }: CallOptions): Promise<string> {
  const text = await generate({ role: model, prompt, temperature, maxTokens });
  return text.trim();
}

// Image understanding, used by the visual librarian to label uploads. Providers
// that cannot take an image fall back to an API key when one is configured.
export async function callVisionAI({ prompt, imageDataUrl, temperature = 0.2, maxTokens = 600 }: CallOptions & { imageDataUrl: string }): Promise<string> {
  const text = await generate({ role: 'vision', prompt, imageDataUrl, temperature, maxTokens });
  return text.trim();
}

export function parseJSON<T>(text: string): T | null {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  // Try direct parse first (handles clean JSON)
  try { return JSON.parse(stripped) as T; } catch {}

  // Find the first valid JSON array or object by scanning start positions
  for (const start of ['[', '{']) {
    const idx = stripped.indexOf(start);
    if (idx === -1) continue;
    // Walk forward tracking depth to find the matching close bracket
    let depth = 0;
    const close = start === '[' ? ']' : '}';
    for (let i = idx; i < stripped.length; i++) {
      if (stripped[i] === start) depth++;
      else if (stripped[i] === close) depth--;
      if (depth === 0) {
        try { return JSON.parse(stripped.slice(idx, i + 1)) as T; } catch {}
        break;
      }
    }
  }

  console.warn('[parseJSON] Failed to parse:', text.slice(0, 200));
  return null;
}
