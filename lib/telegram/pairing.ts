import { randomInt } from 'node:crypto';
import { db } from '../db';
import { systemConfig } from '../db/schema';
import { eq } from 'drizzle-orm';
import { decideInbound, type Owner, type PairingCode } from './pairing-rules';

export * from './pairing-rules';

/**
 * Binding a self-hosted Lore to one Telegram account.
 *
 * The hosted app links a chat to a logged-in session. A self-hoster has no
 * session and no account, so instead the install binds to exactly one chat the
 * first time someone proves they can see the setup screen or the terminal.
 *
 * This matters more than it looks. The bot token is theirs, but a bot's
 * @username is discoverable, so an unpaired bot left running would happily
 * answer a stranger with the owner's drafts. Until a chat is bound, the bot
 * answers nobody.
 *
 * State lives in system_config so there is no migration to run.
 */

const OWNER_KEY = 'telegram_owner';
const CODE_KEY = 'telegram_pairing_code';
const CODE_TTL_MS = 10 * 60 * 1000;


async function readConfig<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, key)).limit(1);
  return (row?.value as T) ?? null;
}

async function writeConfig(key: string, value: unknown): Promise<void> {
  await db
    .insert(systemConfig)
    .values({ key, value: value as object, updatedAt: new Date() })
    .onConflictDoUpdate({ target: systemConfig.key, set: { value: value as object, updatedAt: new Date() } });
}

async function clearConfig(key: string): Promise<void> {
  await db.delete(systemConfig).where(eq(systemConfig.key, key));
}

export async function getOwner(): Promise<Owner | null> {
  return readConfig<Owner>(OWNER_KEY);
}

export async function isOwner(chatId: string | number): Promise<boolean> {
  const owner = await getOwner();
  return !!owner && owner.chatId === String(chatId);
}

/**
 * Mints a fresh pairing code. Shown in the setup screen and printed by
 * `npm run telegram:pair`. Issuing a new one invalidates the previous code.
 */
export async function issuePairingCode(): Promise<{ code: string; expiresInMinutes: number }> {
  // Six digits, spoken aloud easily, and useless after ten minutes. Not trying to
  // resist offline brute force: it only works against a bot the attacker must
  // already know the username of, within the window, before the owner pairs.
  const code = String(randomInt(100_000, 1_000_000));
  await writeConfig(CODE_KEY, { code, expiresAt: Date.now() + CODE_TTL_MS } satisfies PairingCode);
  return { code, expiresInMinutes: CODE_TTL_MS / 60_000 };
}

export type ClaimResult =
  | { ok: true; owner: Owner }
  | { ok: false; reason: 'already-paired' | 'no-code' | 'expired' | 'wrong-code' };

/**
 * Binds a chat to this install, if the code is live and nobody is bound yet.
 * The code is consumed either way, so a wrong guess costs the attacker the
 * window rather than letting them keep trying.
 */
export async function claimPairingCode(
  code: string,
  chat: { id: string | number; username?: string; firstName?: string },
): Promise<ClaimResult> {
  const existing = await getOwner();
  if (existing) {
    return existing.chatId === String(chat.id)
      ? { ok: true, owner: existing }
      : { ok: false, reason: 'already-paired' };
  }

  const pending = await readConfig<PairingCode>(CODE_KEY);
  if (!pending) return { ok: false, reason: 'no-code' };

  if (Date.now() > pending.expiresAt) {
    await clearConfig(CODE_KEY);
    return { ok: false, reason: 'expired' };
  }

  if (pending.code !== code.trim()) {
    await clearConfig(CODE_KEY);
    return { ok: false, reason: 'wrong-code' };
  }

  const owner: Owner = {
    chatId: String(chat.id),
    username: chat.username,
    firstName: chat.firstName,
    boundAt: new Date().toISOString(),
  };
  await writeConfig(OWNER_KEY, owner);
  await clearConfig(CODE_KEY);
  return { ok: true, owner };
}

/** Releases the binding so another chat can pair. Deliberately explicit. */
export async function unpair(): Promise<void> {
  await clearConfig(OWNER_KEY);
  await clearConfig(CODE_KEY);
}

/** Loads state, applies `decideInbound`, persists whatever it decided. */
export async function gateInbound(
  text: string,
  chat: { id: string | number; username?: string; firstName?: string },
): Promise<{ allow: true } | { allow: false; reply: string | null }> {
  const [owner, pending] = await Promise.all([
    readConfig<Owner>(OWNER_KEY),
    readConfig<PairingCode>(CODE_KEY),
  ]);

  const decision = decideInbound(text, chat, { owner, pending, now: Date.now() });

  if (decision.allow) return { allow: true };
  if (decision.bind) await writeConfig(OWNER_KEY, decision.bind);
  if (decision.consumeCode) await clearConfig(CODE_KEY);
  return { allow: false, reply: decision.reply };
}
