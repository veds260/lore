/**
 * Provider abstraction for Lore.
 *
 * Lore talks to a model through one of three routes:
 *   - `cli`   the agent CLI already installed on the user's machine (claude, codex).
 *             Costs the user nothing extra, uses the subscription they already pay for.
 *             This is the default for self-hosted Lore.
 *   - `http`  a direct API key (Anthropic, OpenAI, or OpenRouter).
 *   - `proxy` Lore's hosted relay, rate-limited, for people trying it before setting anything up.
 *
 * Call sites never pick a provider or a model string. They ask for a ROLE and the
 * active provider decides what that means for the backend it is talking to.
 */

export type Role =
  | 'creative'   // post generation and revision, quality matters most
  | 'extract'    // structured JSON, cheap and fast
  | 'agent'      // tool routing in the telegram loop, latency matters
  | 'longform'   // summarising large knowledge bases
  | 'vision';    // image understanding

export interface GenerateOptions {
  role: Role;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  /** data: URL. Only meaningful for role 'vision'. */
  imageDataUrl?: string;
  /** Abort long CLI runs. Defaults to 120s. */
  timeoutMs?: number;
}

export interface Provider {
  readonly id: 'cli' | 'http' | 'proxy';
  /** Human-readable, shown in the setup screen: "Claude Code (claude)" */
  readonly label: string;
  /** False when the provider cannot serve vision requests. */
  supportsVision: boolean;
  generate(opts: GenerateOptions): Promise<string>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    /** Set when the user can fix this themselves, e.g. a missing key or an expired login. */
    readonly userActionable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
