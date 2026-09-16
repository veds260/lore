// Shared throttles, split out so jobs.ts, chat.ts and plugins can all use
// them without import cycles.

import { createSemaphore } from './semaphore';

export const modelSemaphore = createSemaphore(Number(process.env.AGENT_MODEL_CONCURRENCY) || 3);

export function dailyOpsCap(): number {
  return Number(process.env.AGENT_DAILY_OPS_CAP) || 20;
}
