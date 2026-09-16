// Lore agent worker: the proactive layer, as its own Railway service.
//
//   npm run worker        (start command on Railway: same repo, second service)
//
// Safety posture:
//   - AGENT_ENABLED must be exactly 'true' or the process logs and exits 0.
//     Nothing here can start by accident on a deploy (the SCHEDULER_ENABLED
//     lesson: defaults are OFF).
//   - Telegram polling refuses to start while the Next app's webhook is
//     registered, unless AGENT_TAKEOVER_TELEGRAM=true.
//   - Every model-facing operation passes a per-brand daily budget gate and a
//     global concurrency semaphore. The provider-side spend cap on the API key
//     is the outer wall; these are the inner ones.

import { and, eq, isNotNull, sql as dsql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { brands, users } from '@/lib/db/schema';
import { bootstrapAgentSchema, getBinding, getOnboarding, setBinding } from './state';
import { canPoll, pollLoop, send, type AgentUpdate } from './telegram';
import { handleOnboardingMessage, startOnboarding } from './onboarding';
import { handleBoundMessage } from './chat';
import { schedulerTick } from './jobs';
import { loadPlugins } from './plugins';

let shuttingDown = false;

// One-time convenience: users already linked via the dashboard who own exactly
// ONE active brand get a binding seeded automatically. Multi-brand (agency)
// users are never auto-bound; guessing the brand is the exact bug this worker
// exists to kill; they pick explicitly on /start.
async function seedBindingsFromLinkedUsers(): Promise<void> {
  const linked = await db
    .select({ id: users.id, chatId: users.telegramChatId })
    .from(users)
    .where(isNotNull(users.telegramChatId));

  for (const u of linked) {
    if (!u.chatId) continue;
    if (await getBinding(u.chatId)) continue;

    const active = await db
      .select({ id: brands.id, name: brands.name })
      .from(brands)
      .where(and(eq(brands.userId, u.id), eq(brands.isActive, true)));

    if (active.length === 1) {
      await setBinding(u.chatId, { userId: u.id, brandId: active[0].id }, active[0].name);
      console.log(`[agent] seeded binding chat=${u.chatId} -> ${active[0].name}`);
    }
  }
}

async function handleUpdate(update: AgentUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;
  const chatId = String(msg.chat.id);
  const text = msg.text;

  // Mid-onboarding messages route to the flow first.
  const onboarding = await getOnboarding(chatId);
  if (onboarding && text.trim().toLowerCase() !== '/start') {
    await handleOnboardingMessage(chatId, text);
    return;
  }

  const binding = await getBinding(chatId);
  if (binding && !onboarding) {
    await handleBoundMessage(binding, text);
    return;
  }

  await startOnboarding(chatId, msg.from?.first_name);
}

export async function main(): Promise<void> {
  console.log('[agent] booting');
  await bootstrapAgentSchema();
  for (const plugin of await loadPlugins()) {
    if (plugin.init) await plugin.init();
  }
  await seedBindingsFromLinkedUsers();

  // Cheap connectivity sanity check before starting loops.
  await db.execute(dsql`SELECT 1`);

  const interval = setInterval(() => { void schedulerTick(); }, 60_000);
  void schedulerTick();
  console.log('[agent] scheduler running (60s tick)');

  const stop = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[agent] shutting down, finishing in-flight work');
    clearInterval(interval);
    // Give in-flight sends/model calls a moment, then exit; the ritual log and
    // the persisted Telegram offset make a hard cut safe either way.
    setTimeout(() => process.exit(0), 15_000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  if (await canPoll()) {
    console.log('[agent] telegram polling started');
    await pollLoop(handleUpdate, () => shuttingDown);
  } else {
    console.log('[agent] telegram polling disabled — scheduler-only mode (proactive sends still work)');
    // Keep the process alive for the scheduler.
    await new Promise<void>(resolve => {
      const check = setInterval(() => {
        if (shuttingDown) { clearInterval(check); resolve(); }
      }, 1000);
    });
  }
}

// Exported for tests / manual runs.
export { handleUpdate };
export { send as agentSend };
