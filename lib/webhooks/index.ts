import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Outgoing webhooks.
 *
 * Lore posts an event to every endpoint subscribed to it, signed so the receiver
 * can prove it came from this install. Deliveries retry with backoff and give up
 * after a few attempts rather than blocking whatever triggered them.
 *
 * Receivers verify with `verifySignature` (exported so people can copy it).
 */

export const EVENTS = [
  'draft.created',
  'draft.approved',
  'post.published',
  'post.failed',
  'interview.completed',
  'idea.captured',
  'report.ready',
] as const;

export type EventName = (typeof EVENTS)[number];

export interface Endpoint {
  id: string;
  url: string;
  /** Empty means every event. */
  events: EventName[];
  active: boolean;
}

export interface DeliveryResult {
  endpointId: string;
  url: string;
  ok: boolean;
  status?: number;
  attempts: number;
  error?: string;
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 1_000, 5_000];
const TIMEOUT_MS = 10_000;

function sign(body: string, secret: string, timestamp: number): string {
  // Timestamp is inside the signed payload so a captured delivery cannot be
  // replayed later against a receiver that checks freshness.
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * Verify an incoming Lore delivery. Copy this into your receiver.
 *
 *   const ok = verifySignature(rawBody, req.headers['x-lore-signature'], SECRET);
 *
 * Rejects deliveries older than `toleranceSec` to blunt replay attacks.
 */
export function verifySignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  toleranceSec = 300,
): boolean {
  if (!header) return false;

  const parts = Object.fromEntries(
    header.split(',').map((p) => p.trim().split('=') as [string, string]),
  );
  const ts = Number(parts.t);
  const given = parts.v1;
  if (!ts || !given) return false;

  if (Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false;

  const expected = sign(rawBody, secret, ts);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function deliverOnce(url: string, body: string, signature: string, timestamp: number) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Lore-Webhook/1',
      'X-Lore-Signature': `t=${timestamp},v1=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function deliver(endpoint: Endpoint, body: string, secret: string): Promise<DeliveryResult> {
  let lastError: string | undefined;
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt - 1]) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]));
    }
    // Re-sign per attempt: a retry after backoff would otherwise carry a stale
    // timestamp and get rejected by receivers that check freshness.
    const timestamp = Math.floor(Date.now() / 1000);
    try {
      const res = await deliverOnce(endpoint.url, body, sign(body, secret, timestamp), timestamp);
      lastStatus = res.status;
      if (res.ok) {
        return { endpointId: endpoint.id, url: endpoint.url, ok: true, status: res.status, attempts: attempt };
      }
      // 4xx other than 429 means the receiver understood and refused, so stop.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return {
          endpointId: endpoint.id, url: endpoint.url, ok: false, status: res.status, attempts: attempt,
          error: `receiver refused with ${res.status}`,
        };
      }
      lastError = `status ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    endpointId: endpoint.id, url: endpoint.url, ok: false, status: lastStatus,
    attempts: MAX_ATTEMPTS, error: lastError,
  };
}

/**
 * Fire an event at every subscribed endpoint.
 *
 * Never throws and never blocks the caller on a slow receiver: a webhook failing
 * must not fail the draft that triggered it. Results are returned for logging.
 */
export async function emit(
  event: EventName,
  payload: Record<string, unknown>,
  opts: { endpoints: Endpoint[]; secret?: string } ,
): Promise<DeliveryResult[]> {
  const secret = opts.secret ?? process.env.LORE_WEBHOOK_SECRET;
  if (!secret) return [];

  const targets = opts.endpoints.filter(
    (e) => e.active && (e.events.length === 0 || e.events.includes(event)),
  );
  if (!targets.length) return [];

  const body = JSON.stringify({
    id: `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    event,
    created: new Date().toISOString(),
    data: payload,
  });

  const results = await Promise.allSettled(targets.map((t) => deliver(t, body, secret)));
  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          endpointId: targets[i].id, url: targets[i].url, ok: false,
          attempts: MAX_ATTEMPTS, error: String(r.reason),
        },
  );
}

/** Rejects anything that is not a plausible public receiver, before we store it. */
export function validateEndpointUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    return { ok: false, reason: 'must be https (localhost is allowed for testing)' };
  }
  return { ok: true, url: parsed.toString() };
}
