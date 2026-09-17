/**
 * Client for the shared Lore relay.
 *
 * Installs without their own X, Fish Audio or Groq keys can use the maintainer's
 * through the relay, on limited per-install credits that unlock with a follow on X. The user's own key always
 * wins; the relay is only used when that key is missing, a relay key exists and
 * LORE_RELAY is not `off`. Contract: RELAY-CONTRACT.md in the publish repo.
 *
 * The key is a credential. Never log it or put it in an error message.
 */

const DEFAULT_RELAY_URL = 'https://trylore.xyz';
const KEY_SETTING = 'relay_key';
const KEY_CACHE_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;

export type RelayErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'locked'
  | 'not_following'
  | 'not_verified'
  | 'out_of_credits'
  | 'rate_limited'
  | 'daily_cap'
  | 'disabled'
  | 'upstream';

const CODES: readonly RelayErrorCode[] = [
  'bad_request', 'unauthorized', 'locked', 'not_following', 'not_verified', 'out_of_credits', 'rate_limited', 'daily_cap', 'disabled', 'upstream',
];

export class RelayError extends Error {
  status: number;
  code: RelayErrorCode;
  constructor(message: string, status: number, code: RelayErrorCode) {
    super(message);
    this.name = 'RelayError';
    this.status = status;
    this.code = code;
  }
}

export function relayBaseUrl(): string {
  const raw = process.env.LORE_RELAY_URL?.trim();
  return (raw || DEFAULT_RELAY_URL).replace(/\/+$/, '');
}

export function relayTurnedOff(): boolean {
  return process.env.LORE_RELAY?.trim().toLowerCase() === 'off';
}

let keyCache: { value: string | null; at: number } | null = null;

export async function getRelayKey(): Promise<string | null> {
  const fromEnv = process.env.LORE_RELAY_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (keyCache && Date.now() - keyCache.at < KEY_CACHE_MS) return keyCache.value;

  let value: string | null = null;
  try {
    // Imported lazily: the db module validates env at import time and throws
    // when there is no database, which must not take callers down.
    const { db } = await import('@/lib/db');
    const { instanceSettings } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await db
      .select({ value: instanceSettings.value })
      .from(instanceSettings)
      .where(eq(instanceSettings.key, KEY_SETTING))
      .limit(1);
    value = row?.value?.trim() || null;
  } catch {
    value = null;
  }
  // Only a found key is cached. Route handlers and pages are separate module
  // instances, so a cached miss would hide a key another one just saved.
  keyCache = value ? { value, at: Date.now() } : null;
  return value;
}

/** The relay key to use right now, or null when the relay is off or not connected. */
export async function activeRelayKey(): Promise<string | null> {
  if (relayTurnedOff()) return null;
  return getRelayKey();
}

export async function saveRelayKey(key: string): Promise<void> {
  const { db } = await import('@/lib/db');
  const { instanceSettings } = await import('@/lib/db/schema');
  const now = new Date();
  await db
    .insert(instanceSettings)
    .values({ key: KEY_SETTING, value: key, updatedAt: now })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value: key, updatedAt: now } });
  keyCache = null;
}

async function forgetRelayKey(): Promise<void> {
  const { db } = await import('@/lib/db');
  const { instanceSettings } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  await db.delete(instanceSettings).where(eq(instanceSettings.key, 'relay_key'));
  keyCache = null;
}

export interface RelayFetchInit extends RequestInit {
  timeoutMs?: number;
  /** Send without the Authorization header. Only register does this. */
  anonymous?: boolean;
}

export async function relayFetch(path: string, init: RelayFetchInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, anonymous = false, headers, ...rest } = init;
  const h = new Headers(headers);
  if (!anonymous) {
    const key = await getRelayKey();
    if (!key) throw new RelayError('Not connected to the shared relay', 401, 'unauthorized');
    h.set('Authorization', `Bearer ${key}`);
  }
  if (rest.body && !h.has('Content-Type') && !(rest.body instanceof FormData)) h.set('Content-Type', 'application/json');

  const suffix = path.startsWith('/') ? path : `/${path}`;
  const res = await fetch(`${relayBaseUrl()}/api/relay/v1${suffix}`, {
    ...rest,
    headers: h,
    signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
  });
  if (res.ok) return res;

  const body = (await res.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
  const code = CODES.includes(body?.code as RelayErrorCode) ? (body!.code as RelayErrorCode) : 'upstream';
  const message = typeof body?.error === 'string' && body.error ? body.error : `relay responded ${res.status}`;
  throw new RelayError(message, res.status, code);
}

/** Remaining credits from a metered response, when the relay sent them. */
export function relayCreditsFrom(res: { headers: Headers }): number | null {
  const raw = res.headers.get('x-relay-credits');
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export const DEFAULT_FOLLOW_HANDLE = 'vedsayys';

export interface RelayBalance {
  credits: number;
  granted: number;
  /** False until the install proves an X account that follows the maintainer. */
  unlocked: boolean;
  followHandle: string;
}

/** Null when the relay is off or there is no key. Throws when the call fails. */
export async function relayBalance(): Promise<RelayBalance | null> {
  if (!(await activeRelayKey())) return null;
  const res = await relayFetch('/balance', { method: 'GET' });
  const data = (await res.json()) as Partial<RelayBalance>;
  return {
    credits: Number(data.credits ?? 0),
    granted: Number(data.granted ?? 0),
    unlocked: data.unlocked !== false,
    followHandle: typeof data.followHandle === 'string' && data.followHandle ? data.followHandle : DEFAULT_FOLLOW_HANDLE,
  };
}

export interface UnlockStatus {
  credits: number;
  granted: number;
  unlocked: boolean;
  x: string | null;
  github: string | null;
  githubRequired: boolean;
  followHandle: string;
}

async function ensureConnected(): Promise<void> {
  if (!(await getRelayKey())) await connectRelay();
}

async function relayJson<T>(path: string, init: RelayFetchInit = {}): Promise<T> {
  await ensureConnected();
  const res = await relayFetch(path, { timeoutMs: 30_000, ...init });
  return (await res.json()) as T;
}

/** Where this install is in unlocking the free credits. Connects first if needed. */
export function unlockStatus(): Promise<UnlockStatus> {
  return relayJson<UnlockStatus>('/unlock/status', { method: 'GET' });
}

export function startXUnlock(handle: string): Promise<{ code: string; handle: string }> {
  return relayJson('/unlock/start', { method: 'POST', body: JSON.stringify({ handle }) });
}

export function verifyXUnlock(): Promise<{ credits: number; granted: number; unlocked: boolean }> {
  return relayJson('/unlock/verify', { method: 'POST', body: '{}' });
}

export function startGithubUnlock(): Promise<{ userCode: string; verificationUri: string; interval: number; expiresIn: number }> {
  return relayJson('/unlock/github/start', { method: 'POST', body: '{}' });
}

export function pollGithubUnlock(): Promise<{ state: 'pending' | 'not_starred' | 'done'; login?: string; credits?: number; unlocked?: boolean }> {
  return relayJson('/unlock/github/poll', { method: 'POST', body: '{}' });
}

export async function connectRelay(): Promise<{ credits: number }> {
  if (relayTurnedOff()) throw new Error('The shared relay is turned off with LORE_RELAY=off');

  if (await getRelayKey()) {
    try {
      const res = await relayFetch('/balance');
      const data = (await res.json()) as { credits?: unknown };
      return { credits: Number(data.credits ?? 0) };
    } catch (err) {
      if (!(err instanceof RelayError && err.code === 'unauthorized')) throw err;
      if (process.env.LORE_RELAY_KEY) {
        throw new RelayError('LORE_RELAY_KEY is not a valid relay key. Remove it from .env.local and connect again.', 401, 'unauthorized');
      }
      await forgetRelayKey();
    }
  }

  const res = await relayFetch('/register', {
    method: 'POST',
    anonymous: true,
    body: JSON.stringify({ client: 'lore', version: process.env.npm_package_version ?? 'unknown' }),
  });
  const data = (await res.json()) as { key?: unknown; credits?: unknown };
  if (typeof data.key !== 'string' || !data.key) {
    throw new RelayError('The relay did not return a key', 502, 'upstream');
  }
  await saveRelayKey(data.key);
  return { credits: Number(data.credits ?? 0) };
}
