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

const RELAY_OFF_NOTE = 'The shared relay with free credits is off (LORE_RELAY=off). Remove that setting and restart Lore to use it instead of keys.';

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
      'Option A, runs on a Claude or ChatGPT plan you already pay for:',
      '  Claude: `npm install -g @anthropic-ai/claude-code`, then `claude auth login`',
      '  ChatGPT: `npm install -g @openai/codex`, then `codex login`',
      '  Then pick it on the setup page at /setup, or re-run this check.',
      'Option B, pay per use with an API key:',
      '  Paste it on the setup page, or put ANTHROPIC_API_KEY (or OPENAI_API_KEY / OPENROUTER_API_KEY) in .env.local',
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
        '1. Start the Postgres that ships with Lore, from the Lore folder: `docker compose up -d`',
        '2. Put this in .env.local: DATABASE_URL=postgresql://postgres:lore@localhost:5432/lore (Docker), or postgresql://YOURNAME@localhost:5432/lore for a Postgres you installed yourself',
        '3. Create the tables: `npm run db:push`',
        'Already have Postgres? Point DATABASE_URL at an empty database on it instead.',
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
        '1. Start the database. With Docker, run `docker compose up -d` in the Lore folder.',
        '2. Check DATABASE_URL in .env.local. Docker uses postgresql://postgres:lore@localhost:5432/lore, a Postgres you installed yourself uses postgresql://YOURNAME@localhost:5432/lore',
        '3. If the tables are missing, run `npm run db:push`.',
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
  // Interviews need both directions: speech out (Fish Audio) and speech in (Groq).
  const ownTts = Boolean(env('FISH_AUDIO_API_KEY'));
  const ownStt = Boolean(env('GROQ_API_KEY'));
  const relay = ownTts && ownStt ? false : await relayConnected();
  const ready = (ownTts || relay) && (ownStt || relay);
  const detail = ownTts && ownStt
    ? 'using your own Fish Audio and Groq keys, no limits'
    : relay
      ? 'through the shared relay, limited credits'
      : undefined;
  return {
    id: 'voice',
    label: 'Voice interviews',
    required: false,
    unlocks: 'Lore interviews you out loud instead of by typing, which gets better material faster.',
    status: ready ? 'ok' : 'missing',
    detail,
    fix: ready ? undefined : relayTurnedOff() ? [
      'Add your own keys to .env.local and restart Lore:',
      '  FISH_AUDIO_API_KEY from fish.audio',
      '  GROQ_API_KEY from console.groq.com (free tier)',
      RELAY_OFF_NOTE,
    ] : [
      'Either works:',
      '  A. Free starter credits on the shared relay: open Shared relay under Extras on the setup page.',
      '  B. Your own keys: FISH_AUDIO_API_KEY (fish.audio) and GROQ_API_KEY (console.groq.com, free tier) in .env.local',
    ],
  };
}

async function checkRelay(): Promise<Capability> {
  const base: Omit<Capability, 'status'> = {
    id: 'relay',
    label: 'Shared relay',
    required: false,
    unlocks: 'X lookups and voice interviews without your own API keys, on 200 free credits you unlock in a couple of clicks.',
  };
  if (relayTurnedOff()) {
    return {
      ...base,
      status: 'missing',
      detail: 'turned off with LORE_RELAY=off',
      fix: [
        'To turn it on, remove LORE_RELAY=off from .env.local, or from the command you start Lore with.',
        'Restart Lore, then come back here to unlock the free credits.',
      ],
    };
  }

  const key = await getRelayKey();
  if (!key) {
    return { ...base, status: 'missing', fix: ['Open the setup page, go to Extras, pick Shared relay and follow the steps.'] };
  }

  try {
    const balance = await relayBalance();
    if (!balance) return { ...base, status: 'unknown', detail: 'could not read the balance' };
    if (!balance.unlocked) {
      return {
        ...base,
        status: 'missing',
        detail: 'connected, free credits not unlocked yet',
        fix: ['Open the setup page, go to Extras, pick Shared relay and follow the steps.'],
      };
    }
    if (balance.credits <= 0) {
      return {
        ...base,
        status: 'broken',
        detail: `free credits used up (${balance.granted} granted)`,
        fix: [
          'X lookups and voice now need your own keys:',
          '  TWITTERAPI_IO_KEY from twitterapi.io/dashboard',
          '  FISH_AUDIO_API_KEY from fish.audio',
          '  GROQ_API_KEY from console.groq.com (free tier)',
          'Put them in .env.local and restart. Your own keys always take priority over the relay.',
        ],
      };
    }
    return {
      ...base,
      status: 'ok',
      detail: `${balance.credits} of ${balance.granted} free credits left`,
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
      // openssl is not on a plain Windows install, and Node always is.
      '1. Generate a signing key: `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`',
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
      '2. Set TWITTERAPI_IO_KEY in .env.local and restart Lore',
      relayTurnedOff() ? RELAY_OFF_NOTE : 'Or skip the key and use free starter credits: open Shared relay under Extras on the setup page.',
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
