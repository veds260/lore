/**
 * `npm run telegram:register` — point your Telegram bot at this install's webhook.
 *
 * Use this when Lore runs on a public address. A Lore on your own machine uses the
 * poller instead, so it needs nothing here. `-- --delete` removes the webhook again.
 */
import '../lib/load-env';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

function fail(message: string): never {
  console.error('\n  ' + message + '\n');
  process.exit(1);
}

async function call(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!json.ok) fail(`Telegram said no: ${json.description ?? res.status}`);
  return json;
}

async function main() {
  if (!BOT_TOKEN) fail('TELEGRAM_BOT_TOKEN is not set in .env.local.');

  if (process.argv.includes('--delete')) {
    await call('deleteWebhook', { drop_pending_updates: false });
    console.log('\n  Webhook removed. The poller can take over now.\n');
    return;
  }

  const flag = process.argv.find((a) => a.startsWith('--url='));
  const base = (flag ? flag.slice(6) : process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  if (!base) fail('Set NEXT_PUBLIC_APP_URL to your public address, or pass --url=https://example.com');
  if (!base.startsWith('https://')) fail('Telegram only delivers to https addresses.');
  if (!SECRET) fail('Set TELEGRAM_WEBHOOK_SECRET in .env.local first, or the webhook cannot be verified.');

  await call('setWebhook', {
    url: `${base}/api/telegram/webhook`,
    secret_token: SECRET,
    allowed_updates: ['message', 'callback_query'],
  });
  console.log(`\n  Telegram now posts to ${base}/api/telegram/webhook\n`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
