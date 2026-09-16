// Module-level in-memory cache for client pages.
//
// Survives client-side navigations within the same tab because the JS bundle
// stays loaded. Cleared on full page reload, sign-out, or brand switch (which
// triggers a hard navigation).

type Entry<T> = { data: T; at: number };

const store = new Map<string, Entry<unknown>>();

export function getCache<T>(key: string, ttlMs?: number): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (ttlMs !== undefined && Date.now() - entry.at > ttlMs) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCache<T>(key: string, data: T): void {
  store.set(key, { data, at: Date.now() });
}

export function invalidateCache(key: string): void {
  store.delete(key);
}

export function clearCache(): void {
  store.clear();
}
