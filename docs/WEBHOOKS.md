# Webhooks

Lore can push events to any URL the moment they happen, so you can wire it into n8n, Make, Zapier, Slack, or something you wrote yourself.

## Turning them on

```bash
echo "LORE_WEBHOOK_SECRET=$(openssl rand -hex 32)" >> .env.local
```

Without that secret, Lore sends nothing. Deliveries are always signed, so there is no unsigned mode to fall back to.

Add an endpoint in Settings, or:

```bash
curl -X POST http://localhost:3000/api/webhooks/endpoints \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://your-service.com/lore","events":["draft.created"]}'
```

An empty `events` array means send everything.

Endpoints must be `https`, except `localhost` and `127.0.0.1`, which are allowed so you can test.

## Events

| Event | Fires when |
|---|---|
| `draft.created` | Lore writes a new draft |
| `draft.approved` | You approve a draft |
| `post.published` | A post goes out |
| `post.failed` | Publishing failed |
| `interview.completed` | An interview session ends |
| `idea.captured` | A new idea lands in the board |
| `report.ready` | A learning report finishes generating |

## What arrives

```http
POST /your-endpoint
Content-Type: application/json
User-Agent: Lore-Webhook/1
X-Lore-Signature: t=1757836800,v1=9f86d081884c7d659a2feaa0...

{
  "id": "evt_m1a2b3c4d5e6",
  "event": "draft.created",
  "created": "2026-09-14T09:20:00.000Z",
  "data": { "draftId": "d_123", "title": "..." }
}
```

## Verifying the signature

Do this. An unverified endpoint is a URL anyone can post anything to.

The header carries a timestamp and a signature: `t=<unix seconds>,v1=<hex>`. The signature is `HMAC-SHA256(secret, "<t>.<raw body>")`. Sign the raw body, before any JSON parsing, or the bytes will not match.

**Node**
```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map(p => p.trim().split('=')));
  const ts = Number(parts.t);
  if (!ts || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false;

  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

**Python**
```python
import hmac, hashlib, time

def verify(raw_body: bytes, header: str, secret: str, tolerance=300) -> bool:
    parts = dict(p.strip().split("=", 1) for p in header.split(","))
    ts = int(parts.get("t", 0))
    if not ts or abs(time.time() - ts) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

The timestamp check is what stops someone replaying a delivery they captured earlier. Deliveries older than five minutes should be rejected.

Lore exports the same function if you are building your receiver in this repo:

```ts
import { verifySignature } from '@/lib/webhooks';
```

## Delivery behaviour

- **Retries:** up to 3 attempts, immediately, then after 1s, then after 5s.
- **Giving up:** a `4xx` other than `429` stops retries at once, since the receiver understood and refused. `5xx` and timeouts retry.
- **Timeout:** 10 seconds per attempt.
- **Re-signing:** each attempt gets a fresh timestamp and signature, so a retry after backoff is not rejected as stale.
- **Isolation:** a failing webhook never fails whatever triggered it. Lore logs the failure and carries on.
- **Ordering:** not guaranteed. Endpoints are delivered in parallel. Use the `created` field if order matters to you.

## Setting up a receiver in n8n

1. Add a **Webhook** node, method POST, and copy its production URL.
2. Register it with Lore (Settings, or the curl above).
3. Add a **Code** node right after it that verifies the signature with the snippet above, and stops the workflow when it fails.
4. Build the rest of your flow off `{{$json.data}}`.

Skipping step 3 leaves a public URL that anyone can trigger with fake Lore events.

## Incoming webhooks

Telegram is the other direction: Telegram posts to Lore. That is covered in [SETUP.md](./SETUP.md#step-3-optional-telegram). Locally you do not need it at all, since the worker long-polls instead.
