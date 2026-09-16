// Long-polling Telegram transport for the agent worker.
//
// Polling instead of webhooks so the worker needs no public URL. The bot token
// is shared with the Next app's webhook route; a bot can't do both at once, so
// boot refuses to poll while a webhook is registered unless
// AGENT_TAKEOVER_TELEGRAM=true (which deletes the webhook first), so the worker
// can never take the bot over silently.
//
// The getUpdates offset is persisted in agent.kv, so a restart never re-plays
// already-processed updates (Telegram re-delivers anything past the offset,
// which is the double-send guard).

import { kvGet, kvSet } from './state';

const API = 'https://api.telegram.org';

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN not set');
  return t;
}

export interface AgentUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string; is_bot?: boolean };
    chat: { id: number; type: string };
    text?: string;
  };
}

async function tg<T>(method: string, body?: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`${API}/bot${token()}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json() as { ok: boolean; result?: T; description?: string };
    if (!json.ok) {
      console.error(`[agent:tg] ${method} failed:`, json.description);
      return null;
    }
    return json.result ?? null;
  } catch (err) {
    console.error(`[agent:tg] ${method} error:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function send(chatId: string | number, text: string): Promise<void> {
  // Telegram hard-caps messages at 4096 chars; chunk on paragraph boundaries.
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 4000) {
    let cut = rest.lastIndexOf('\n', 4000);
    if (cut < 1000) cut = 4000;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  chunks.push(rest);
  for (const chunk of chunks) {
    await tg('sendMessage', { chat_id: chatId, text: chunk, disable_web_page_preview: true });
  }
}

// Send a single message and return its message_id, for messages we plan to
// edit later (the onboarding checklist). Falls back to null on failure.
export async function sendReturningId(chatId: string | number, text: string): Promise<number | null> {
  const r = await tg<{ message_id?: number }>('sendMessage', {
    chat_id: chatId, text, disable_web_page_preview: true,
  });
  return r?.message_id ?? null;
}

export async function editMessage(chatId: string | number, messageId: number, text: string): Promise<void> {
  await tg('editMessageText', {
    chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true,
  });
}

// Proactive sends always carry the brand tag, so if a binding is ever wrong the
// wrong name shows up in the client's chat on day one instead of leaking silently.
export function brandTag(brandName: string): string {
  return brandName ? `▸ ${brandName}\n\n` : '';
}

export async function canPoll(): Promise<boolean> {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('[agent:tg] TELEGRAM_BOT_TOKEN not set — polling disabled');
    return false;
  }
  const info = await tg<{ url?: string }>('getWebhookInfo');
  if (info === null) {
    console.error('[agent:tg] could not verify webhook state — polling disabled this boot');
    return false;
  }
  if (info?.url) {
    if (process.env.AGENT_TAKEOVER_TELEGRAM === 'true') {
      console.log(`[agent:tg] webhook ${info.url} registered — AGENT_TAKEOVER_TELEGRAM=true, deleting it`);
      await tg('deleteWebhook');
      return true;
    }
    console.error(
      `[agent:tg] a webhook is registered (${info.url}). Refusing to poll — the Next app owns this bot. ` +
      `Set AGENT_TAKEOVER_TELEGRAM=true to move the bot to the worker, or use a separate bot token.`,
    );
    return false;
  }
  return true;
}

const OFFSET_KEY = 'tg_offset';

export async function pollLoop(
  handle: (update: AgentUpdate) => Promise<void>,
  isShuttingDown: () => boolean,
): Promise<void> {
  let offset = Number(await kvGet(OFFSET_KEY)) || 0;

  while (!isShuttingDown()) {
    const updates = await tg<AgentUpdate[]>('getUpdates', {
      offset: offset + 1,
      timeout: 25,
      allowed_updates: ['message'],
    });

    if (updates === null) {
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    for (const update of updates) {
      offset = Math.max(offset, update.update_id);
      try {
        // Ignore other bots and non-private chats for now, the agent is a DM product.
        if (update.message && !update.message.from?.is_bot && update.message.chat.type === 'private') {
          await handle(update);
        }
      } catch (err) {
        console.error('[agent:tg] update handler failed:', err instanceof Error ? err.message : err);
      }
      // Persist after each update so a crash mid-batch never replays handled ones.
      await kvSet(OFFSET_KEY, String(offset));
    }
  }
}
