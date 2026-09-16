/**
 * One capability registry, two surfaces.
 *
 * `npm run doctor` and the in-app /setup screen both render this list, so there
 * is a single place that knows what Lore needs, how to test it, and what the
 * user types to fix it. Adding a capability means adding one entry here.
 *
 * Every check must be safe to run repeatedly and must never throw: a capability
 * that cannot be tested reports `unknown` rather than taking the page down.
 */

import { describeSetup, resetProviderCache } from '../providers';
import { getRelayKey, relayBalance, relayTurnedOff } from '../relay/client';

export type Status = 'ok' | 'missing' | 'broken' | 'unknown';

export interface Capability {
  id: string;
  label: string;
  /** Lore will not run at all without this. */
  required: boolean;
  /** One line on what turning this on gets you. Shown before the user has it. */
  unlocks: string;
  status: Status;
  /** What we found. Shown when status is ok. */
  detail?: string;
  /** Copy-pasteable steps, in order. Shown when status is not ok. */
  fix?: string[];
}

const env = (k: string) => process.env[k]?.trim() || undefined;

async function checkModel(): Promise<Capability> {
  resetProviderCache();
  const s = await describeSetup();
  return {
    id: 'model',
    label: 'Model backend',
    required: true,
    unlocks: 'Everything. Lore cannot write, score or answer without one.',
    status: s.ready ? 'ok' : 'missing',
    detail: s.ready ? `${s.provider}${s.vision ? ', images on' : ', images off'}` : undefined,
    fix: s.ready ? undefined : [
      'Option A, free with a subscription you may already have:',
      '  1. Install Claude Code, then run `claude` once and sign in.',
      '  2. Re-run this check. Lore will find it on PATH.',
      'Option B, pay per token:',
      '  1. Put ANTHROPIC_API_KEY (or OPENAI_API_KEY / OPENROUTER_API_KEY) in .env.local',
    ],
  };
}

async function checkDatabase(): Promise<Capability> {
  const url = env('DATABASE_URL');
  if (!url) {
    return {
      id: 'database',
      label: 'Database',
      required: true,
      unlocks: 'Your drafts, voice profile and history. Without it nothing persists.',
      status: 'missing',
      fix: [
        '1. Start a local Postgres: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=lore --name lore-db postgres:16`',
        '2. Put this in .env.local: DATABASE_URL=postgresql://postgres:lore@localhost:5432/postgres',
        '3. Create the tables: `npm run db:push`',
      ],
    };
  }

  // A URL in the env proves nothing, so open a connection and read one row.
  try {
    const { db } = await import('../db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`select 1`);
    const host = (() => { try { return new URL(url).host; } catch { return 'configured'; } })();
    return {
      id: 'database',
      label: 'Database',
      required: true,
      unlocks: 'Your drafts, voice profile and history.',
      status: 'ok',
      detail: `connected to ${host}`,
    };
  } catch (err) {
    return {
      id: 'database',
      label: 'Database',
      required: true,
      unlocks: 'Your drafts, voice profile and history.',
      status: 'broken',
      fix: [
        `Could not connect: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`,
        '1. Check the database is running and DATABASE_URL is right.',
        '2. If the tables are missing, run `npm run db:push`.',
      ],
    };
  }
}

async function checkTelegram(): Promise<Capability> {
  const token = env('TELEGRAM_BOT_TOKEN');
  const base: Omit<Capability, 'status'> = {
    id: 'telegram',
    label: 'Telegram bot',
    required: false,
    unlocks: 'Talk to Lore from your phone, and get drafts pushed to you.',
    fix: [
      '1. Message @BotFather on Telegram, send /newbot, follow the prompts.',
      '2. Put the token it gives you in .env.local as TELEGRAM_BOT_TOKEN',
      '3. Running locally: `npm run worker`. It long-polls, so no public URL is needed.',
      '4. Link it to your account: `npm run telegram:pair`, then send the code to your bot.',
    ],
  };
  if (!token) return { ...base, status: 'missing' };

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      return { ...base, status: 'broken', fix: ['Telegram rejected the token. Get a fresh one from @BotFather.', ...(base.fix ?? [])] };
    }
    return { ...base, status: 'ok', detail: `@${json.result?.username ?? 'bot'} responding` };
  } catch {
    return { ...base, status: 'unknown', detail: 'could not reach Telegram to verify the token' };
  }
}

/** A relay key that is actually usable: present, and the relay not turned off. */
async function relayConnected(): Promise<boolean> {
  if (relayTurnedOff()) return false;
  return Boolean(await getRelayKey());
}

async function checkVoice(): Promise<Capability> {
  const own = env('FISH_AUDIO_API_KEY');
  const relay = own ? false : await relayConnected();
  return {
    id: 'voice',
    label: 'Voice interviews',
    required: false,
    unlocks: 'Lore interviews you out loud instead of by typing, which gets better material faster.',
    status: own || relay ? 'ok' : 'missing',
    detail: own ? 'using your own Fish Audio key, no limits' : relay ? 'through the shared relay, limited credits' : undefined,
    fix: own || relay ? undefined : [
      'Either works:',
      '  A. Free starter credits on the shared relay: run `npm run relay:connect`, or use the Connect button on this page.',
      '  B. Unlimited: make a Fish Audio account, then set FISH_AUDIO_API_KEY in .env.local',
    ],
  };
}

async function checkRelay(): Promise<Capability> {
  const base: Omit<Capability, 'status'> = {
    id: 'relay',
    label: 'Shared relay',
    required: false,
    unlocks: 'X lookups, voice interviews and the template library without your own API keys, on limited free credits.',
  };
  if (relayTurnedOff()) return { ...base, status: 'missing', detail: 'turned off with LORE_RELAY=off' };

  const key = await getRelayKey();
  if (!key) {
    return { ...base, status: 'missing', fix: ['Run `npm run relay:connect`, or use the Connect button on this page.'] };
  }

  try {
    const balance = await relayBalance();
    if (!balance) return { ...base, status: 'unknown', detail: 'could not read the balance' };
    if (balance.credits <= 0) {
      return {
        ...base,
        status: 'broken',
        detail: `free credits used up (${balance.granted} granted), ${balance.patternsLeftToday} templates left today`,
        fix: [
          'X lookups and voice now need your own keys:',
          '  TWITTERAPI_IO_KEY from twitterapi.io/dashboard',
          '  FISH_AUDIO_API_KEY from fish.audio',
          'Put them in .env.local and restart. Your own keys always take priority over the relay.',
        ],
      };
    }
    return {
      ...base,
      status: 'ok',
      detail: `${balance.credits} credits left, ${balance.patternsLeftToday} templates left today`,
    };
  } catch (err) {
    return {
      ...base,
      status: 'unknown',
      detail: `connected, but the balance check failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`,
    };
  }
}

function checkWebhooks(): Capability {
  const secret = env('LORE_WEBHOOK_SECRET');
  return {
    id: 'webhooks',
    label: 'Outgoing webhooks',
    required: false,
    unlocks: 'Push Lore events into n8n, Make, Zapier, Slack or your own service as they happen.',
    status: secret ? 'ok' : 'missing',
    detail: secret ? 'signing key set, deliveries will be signed' : undefined,
    fix: secret ? undefined : [
      '1. Generate a signing key: `openssl rand -hex 32`',
      '2. Put it in .env.local as LORE_WEBHOOK_SECRET',
      '3. Add endpoints in Settings, or POST them to /api/webhooks/endpoints',
      'Receivers verify the X-Lore-Signature header against this key. See docs/WEBHOOKS.md',
    ],
  };
}

async function checkTwitter(): Promise<Capability> {
  const key = env('TWITTERAPI_IO_KEY');
  const relay = key ? false : await relayConnected();
  return {
    id: 'twitter',
    label: 'X lookups',
    required: false,
    unlocks: 'Lore can read X profiles and timelines to learn a voice and find sources.',
    status: key || relay ? 'ok' : 'missing',
    detail: key ? 'your own key' : relay ? 'through the shared relay, limited credits' : undefined,
    fix: key || relay ? undefined : [
      '1. Get a key at twitterapi.io/dashboard',
      '2. Set TWITTERAPI_IO_KEY in .env.local',
      'Or skip the key and use free starter credits: run `npm run relay:connect`.',
    ],
  };
}

export async function runChecks(): Promise<Capability[]> {
  const settled = await Promise.allSettled([
    checkModel(),
    checkDatabase(),
    checkTelegram(),
    checkVoice(),
    Promise.resolve(checkWebhooks()),
    checkTwitter(),
    checkRelay(),
  ]);

  return settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          id: `check-${i}`,
          label: 'Check failed',
          required: false,
          unlocks: '',
          status: 'unknown' as Status,
          detail: r.reason instanceof Error ? r.reason.message : String(r.reason),
        },
  );
}

/** True when every required capability is ok, i.e. Lore will actually run. */
export function canRun(caps: Capability[]): boolean {
  return caps.filter((c) => c.required).every((c) => c.status === 'ok');
}
