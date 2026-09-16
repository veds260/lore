/**
 * `npm run telegram:pair` — bind this Lore install to your Telegram account.
 *
 * Works headless, so a Lore on a server can be paired without opening the app.
 * Prints a code, then waits until the bot sees it.
 */
import { getOwner, issuePairingCode, unpair } from '../lib/telegram/pairing';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function botUsername(): Promise<string | null> {
  if (!BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`, {
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json();
    return json?.result?.username ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const wantsReset = process.argv.includes('--reset');

  if (!BOT_TOKEN) {
    console.error('\nTELEGRAM_BOT_TOKEN is not set. Message @BotFather, run /newbot, then put the token in .env.local\n');
    process.exit(1);
  }

  const existing = await getOwner();
  if (existing && !wantsReset) {
    const who = existing.username ? `@${existing.username}` : existing.firstName ?? existing.chatId;
    console.log(`\nAlready paired to ${who} since ${new Date(existing.boundAt).toLocaleString()}.`);
    console.log('To pair a different account: npm run telegram:pair -- --reset\n');
    process.exit(0);
  }

  if (existing && wantsReset) {
    await unpair();
    console.log('\nPrevious pairing released.');
  }

  const { code, expiresInMinutes } = await issuePairingCode();
  const username = await botUsername();

  console.log('\nPair Telegram with Lore\n');
  console.log(`  1. Open Telegram and message ${username ? `@${username}` : 'your bot'}`);
  console.log(`  2. Send it this code:  ${code}`);
  console.log(`\nThe code is good for ${expiresInMinutes} minutes and can be used once.`);
  console.log('The worker must be running for it to be seen: npm run worker\n');

  // Poll our own state so the script tells you when it worked, rather than
  // leaving you to guess whether the bot got it.
  const deadline = Date.now() + expiresInMinutes * 60_000;
  process.stdout.write('  waiting');
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const owner = await getOwner();
    if (owner) {
      const who = owner.username ? `@${owner.username}` : owner.firstName ?? owner.chatId;
      console.log(`\r  paired to ${who}. The bot will now ignore everyone else.\n`);
      process.exit(0);
    }
    process.stdout.write('.');
  }

  console.log('\r  code expired before it was used. Run this again when the worker is up.\n');
  process.exit(1);
}

main().catch((err) => {
  console.error('\nPairing failed:', err instanceof Error ? err.message : err, '\n');
  process.exit(1);
});
