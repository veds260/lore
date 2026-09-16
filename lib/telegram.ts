// Telegram Bot API utilities for Lore.
// Env: TELEGRAM_BOT_TOKEN (required), TELEGRAM_BOT_USERNAME (for start link), TELEGRAM_WEBHOOK_SECRET (optional, for webhook verification)

const API_BASE = 'https://api.telegram.org';

export interface TelegramMessage {
  message_id: number;
  from?: { id: number; is_bot: boolean; first_name?: string; username?: string };
  chat: { id: number; type: string };
  date: number;
  text?: string;
  voice?: { file_id: string; duration: number; mime_type?: string; file_size?: number };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN not set');
  return t;
}

export function botUsername(): string {
  return process.env.TELEGRAM_BOT_USERNAME ?? 'LoreContentBot';
}

export function startLink(linkToken: string): string {
  return `https://t.me/${botUsername()}?start=${linkToken}`;
}

export async function sendMessage(chatId: number | string, text: string, opts?: { parse_mode?: 'Markdown' | 'HTML' }): Promise<void> {
  try {
    await fetch(`${API_BASE}/bot${token()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: opts?.parse_mode,
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    console.error('[telegram] sendMessage failed:', err);
  }
}

// Register the bot's slash-command menu (shown when user taps the menu button or types /).
// Call this once after deploy. Safe to call multiple times, Telegram replaces the list.
export async function setBotCommands(commands: { command: string; description: string }[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/bot${token()}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    });
    const data = await res.json() as { ok: boolean; description?: string };
    if (!data.ok) return { ok: false, error: data.description };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

// Set the visual "Menu" button next to the text input. Type 'commands' makes
// tapping it open the slash-command list (default behavior in most clients).
export async function setBotMenuButton(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/bot${token()}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menu_button: { type: 'commands' } }),
    });
    const data = await res.json() as { ok: boolean; description?: string };
    if (!data.ok) return { ok: false, error: data.description };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export async function getFileUrl(fileId: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/bot${token()}/getFile?file_id=${fileId}`);
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean; result?: { file_path: string } };
    if (!data.ok || !data.result?.file_path) return null;
    return `${API_BASE}/file/bot${token()}/${data.result.file_path}`;
  } catch (err) {
    console.error('[telegram] getFileUrl failed:', err);
    return null;
  }
}

export async function downloadFile(fileId: string): Promise<Blob | null> {
  const url = await getFileUrl(fileId);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.blob();
  } catch (err) {
    console.error('[telegram] downloadFile failed:', err);
    return null;
  }
}

// Transcribe a voice blob via Groq Whisper (same model used elsewhere in the app).
export async function transcribeVoice(blob: Blob): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return transcribeThroughRelay(blob);
  try {
    const form = new FormData();
    form.append('file', blob, 'voice.ogg');
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'json');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      console.error(`[telegram] Whisper error ${res.status}`);
      return null;
    }
    const data = await res.json() as { text: string };
    return data.text?.trim() ?? null;
  } catch (err) {
    console.error('[telegram] transcribeVoice failed:', err);
    return null;
  }
}

// Generate a URL-safe random token for linking.
export function generateLinkToken(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Without a Groq key, voice notes go through the shared relay when one is connected.
async function transcribeThroughRelay(blob: Blob): Promise<string | null> {
  const { activeRelayKey, relayFetch } = await import('./relay/client');
  if (!(await activeRelayKey())) {
    console.error('[telegram] no GROQ_API_KEY and no shared relay, cannot transcribe');
    return null;
  }
  try {
    const form = new FormData();
    form.append('audio', blob, 'voice.ogg');
    const res = await relayFetch('/voice/stt', { method: 'POST', body: form, timeoutMs: 65_000 });
    const data = (await res.json()) as { transcript?: string };
    return data.transcript?.trim() || null;
  } catch (err) {
    console.error('[telegram] relay transcription failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
