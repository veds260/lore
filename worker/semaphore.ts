// Tiny promise semaphore: global cap on concurrent model-heavy operations so a
// burst of briefs can't stampede the Anthropic/OpenRouter rate limits.

export function createSemaphore(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (active < limit) {
      active++;
      return;
    }
    await new Promise<void>(resolve => waiters.push(resolve));
    active++;
  }

  function release(): void {
    active--;
    const next = waiters.shift();
    if (next) next();
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
    get active() { return active; },
  };
}
