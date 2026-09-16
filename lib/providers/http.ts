import type { GenerateOptions, Provider, Role } from './types';
import { ProviderError } from './types';

/**
 * Direct API access, for people who would rather pay per token than install a CLI,
 * and for the vision calls a one-shot CLI cannot serve.
 *
 * Three backends share one shape because they all speak the OpenAI chat format
 * (Anthropic via its own endpoint, which differs enough to warrant its own branch).
 */

type Backend = 'anthropic' | 'openai' | 'openrouter';

const MODELS: Record<Backend, Record<Role, string>> = {
  anthropic: {
    creative: 'claude-sonnet-5',
    extract: 'claude-haiku-4-5-20251001',
    agent: 'claude-haiku-4-5-20251001',
    longform: 'claude-sonnet-5',
    vision: 'claude-sonnet-5',
  },
  openai: {
    creative: 'gpt-5.2',
    extract: 'gpt-5.2-mini',
    agent: 'gpt-5.2-mini',
    longform: 'gpt-5.2',
    vision: 'gpt-5.2',
  },
  openrouter: {
    creative: 'anthropic/claude-sonnet-5',
    extract: 'google/gemini-2.0-flash-001',
    agent: 'anthropic/claude-haiku-4-5',
    longform: 'google/gemini-2.5-pro-preview-05-06',
    vision: 'anthropic/claude-sonnet-5',
  },
};

const ENDPOINTS: Record<Backend, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

function content(opts: GenerateOptions, backend: Backend) {
  if (!opts.imageDataUrl) return opts.prompt;

  if (backend === 'anthropic') {
    const [meta, data] = opts.imageDataUrl.split(',');
    const mediaType = meta.match(/data:(.*?);/)?.[1] ?? 'image/jpeg';
    return [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
      { type: 'text', text: opts.prompt },
    ];
  }
  return [
    { type: 'text', text: opts.prompt },
    { type: 'image_url', image_url: { url: opts.imageDataUrl } },
  ];
}

export function createHttpProvider(backend: Backend, apiKey: string): Provider {
  return {
    id: 'http',
    label: backend === 'openrouter' ? 'OpenRouter' : backend === 'openai' ? 'OpenAI' : 'Anthropic',
    supportsVision: true,

    async generate(opts: GenerateOptions): Promise<string> {
      const model = MODELS[backend][opts.role];
      const maxTokens = opts.maxTokens ?? 2000;
      const isAnthropic = backend === 'anthropic';

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (isAnthropic) {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      if (backend === 'openrouter') headers['X-Title'] = 'Lore';

      const body = isAnthropic
        ? {
            model,
            max_tokens: maxTokens,
            temperature: opts.temperature ?? 0.8,
            messages: [{ role: 'user', content: content(opts, backend) }],
          }
        : {
            model,
            max_tokens: maxTokens,
            temperature: opts.temperature ?? 0.8,
            messages: [{ role: 'user', content: content(opts, backend) }],
          };

      const res = await fetch(ENDPOINTS[backend], {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        const fixable = res.status === 401 || res.status === 403 || res.status === 402;
        throw new ProviderError(
          fixable
            ? `${backend} rejected the API key (${res.status}). Check the key and its billing status.`
            : `${backend} request failed (${res.status}): ${detail.slice(0, 300)}`,
          'http',
          fixable,
        );
      }

      const json = await res.json();
      const text = isAnthropic
        ? json?.content?.[0]?.text
        : json?.choices?.[0]?.message?.content;

      if (typeof text !== 'string' || !text.trim()) {
        throw new ProviderError(`${backend} returned an empty response`, 'http');
      }
      return text;
    },
  };
}

export type { Backend };
