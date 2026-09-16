import type { ChatBinding } from '../state';

export interface TickContext {
  now: { day: string; minutes: number };
  /** Per-brand minute offset, so brands do not all fire on the same minute. */
  offset: number;
  /**
   * Run a daily job at most once per brand per day, inside the delivery window,
   * using the same claim log as the built-in brief and report.
   */
  runRitual(ritual: string, targetMinutes: number, run: () => Promise<string>): Promise<void>;
}

export interface WorkerPlugin {
  name: string;
  /** Lines appended to the /help reply. */
  help?: string[];
  /** Runs once at worker boot. Create any tables or columns the plugin owns here. */
  init?(): Promise<void>;
  /** Return true when the plugin handled the message. `lower` is trimmed and lowercased. */
  onMessage?(b: ChatBinding, lower: string): Promise<boolean>;
  /** Return true when the plugin owns this onboarding step. */
  onOnboardingStep?(chatId: string, step: string, text: string, data: Record<string, unknown>): Promise<boolean>;
  /** Called every scheduler tick for each active binding. */
  onTick?(b: ChatBinding, ctx: TickContext): Promise<void>;
}
