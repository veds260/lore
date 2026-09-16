// The proactive rhythm: per-brand morning briefs and evening wraps on a
// minute-tick scheduler with an idempotency log, instead of one big HTTP cron
// that loops every user inside a single 300s request.
//
// Why this shape:
//   - each brand claims its send in agent.ritual_log, so restarts, crashes and
//     even a second replica can never double-message a client
//   - send times are staggered per brand (hash of brandId over 45 min) so 100
//     brands don't stampede the model API at 8:00 sharp
//   - every send passes the per-brand daily budget gate first
//   - a worker that was down past the window (3h) skips instead of delivering
//     a "morning" brief at 6pm

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { brands, users } from '@/lib/db/schema';
import { buildEveningReport, buildMorningBrief, ritualEnabled, saveLastIdeas } from '@/lib/briefs';
import { brandTag, send } from './telegram';
import { claimRitual, consumeBudget, finishRitual, listBindings, type ChatBinding } from './state';
import { staggerMinute } from './onboarding';
import { formatOrbit, peopleInOrbit } from './insights';
import { loadPlugins, type TickContext } from './plugins';
import { dailyOpsCap, modelSemaphore } from './limits';

export { dailyOpsCap, modelSemaphore };

const WINDOW_MIN = 180; // deliver within 3h of the target, otherwise skip the day

// The heartbeat guardrail: no proactive message outside the active-hours
// window, ever, no matter how the per-chat hours are configured.
function withinActiveHours(minutes: number): boolean {
  const start = (Number(process.env.AGENT_ACTIVE_START) || 8) * 60;
  const end = (Number(process.env.AGENT_ACTIVE_END) || 22) * 60;
  return minutes >= start && minutes < end;
}

function localNow(): { day: string; minutes: number } {
  const tz = process.env.AGENT_TZ || 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10),
  };
}

async function ritualSettingsFor(userId: string) {
  const [u] = await db
    .select({ ritualSettings: users.ritualSettings })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u?.ritualSettings ?? null;
}

export async function runMorningBrief(b: ChatBinding, opts: { manual?: boolean } = {}): Promise<string> {
  const used = await consumeBudget(b.brandId, dailyOpsCap());
  if (used === null) return 'over-budget';

  const brief = await modelSemaphore.run(() => buildMorningBrief(b.userId, b.brandId, b.brandName));
  if (!brief) {
    if (opts.manual) await send(b.chatId, `${brandTag(b.brandName)}quiet on the data side right now, nothing worth a brief. send me a topic and i'll draft instead.`);
    return 'nothing-to-say';
  }
  await send(b.chatId, `${brandTag(b.brandName)}${brief.body}`);
  if (brief.ideas.length > 0) await saveLastIdeas(b.userId, 'daily', brief.ideas);
  return 'sent';
}

export async function runEveningReport(b: ChatBinding, opts: { manual?: boolean } = {}): Promise<string> {
  const used = await consumeBudget(b.brandId, dailyOpsCap());
  if (used === null) return 'over-budget';

  const report = await modelSemaphore.run(() => buildEveningReport(b.userId, b.brandId, b.brandName));
  if (!report) {
    if (opts.manual) await send(b.chatId, `${brandTag(b.brandName)}nothing shipped today, so there's no wrap to give. tomorrow's brief will have the next move.`);
    return 'nothing-to-say';
  }
  // "People in your orbit": reply authors on today's posts, biggest first.
  // Computed from real data, appended only when there is anyone to show.
  let orbit: string | null = null;
  try {
    const [brand] = await db.select({ handle: brands.handle }).from(brands).where(eq(brands.id, b.brandId)).limit(1);
    orbit = formatOrbit(await peopleInOrbit(b.brandId, brand?.handle ?? null));
  } catch { /* orbit is a bonus, never block the report on it */ }

  await send(b.chatId, `${brandTag(b.brandName)}${report.body}${orbit ? `\n\n${orbit}` : ''}`);
  if (report.ideas.length > 0) await saveLastIdeas(b.userId, 'perf', report.ideas);
  return 'sent';
}

async function maybeRun(
  b: ChatBinding,
  ritual: string,
  targetMinutes: number,
  now: { day: string; minutes: number },
  run: () => Promise<string>,
  respectSettings = true,
): Promise<void> {
  if (now.minutes < targetMinutes || now.minutes >= targetMinutes + WINDOW_MIN) return;
  if (!withinActiveHours(now.minutes)) return;

  // Only the built-in brief and report have user-facing on/off settings.
  if (respectSettings && (ritual === 'morning_brief' || ritual === 'evening_report')) {
    const settings = await ritualSettingsFor(b.userId);
    if (!ritualEnabled(settings, ritual)) return;
  }

  const claimed = await claimRitual(b.brandId, ritual, now.day);
  if (!claimed) return;

  try {
    const result = await run();
    await finishRitual(b.brandId, ritual, now.day, result === 'sent' ? 'sent' : 'skipped');
    console.log(`[agent:jobs] ${ritual} ${b.brandName} (${b.brandId.slice(0, 8)}): ${result}`);
  } catch (err) {
    await finishRitual(b.brandId, ritual, now.day, 'error');
    console.error(`[agent:jobs] ${ritual} ${b.brandName} failed:`, err instanceof Error ? err.message : err);
  }
}

let tickRunning = false;

export async function schedulerTick(): Promise<void> {
  if (tickRunning) return; // never let a slow tick pile up behind itself
  tickRunning = true;
  try {
    const now = localNow();
    const bindings = await listBindings();
    const plugins = await loadPlugins();
    for (const b of bindings) {
      if (b.paused) continue;
      const offset = staggerMinute(b.brandId);
      await maybeRun(b, 'morning_brief', b.briefHour * 60 + offset, now, () => runMorningBrief(b));
      await maybeRun(b, 'evening_report', b.eveningHour * 60 + offset, now, () => runEveningReport(b));

      const ctx: TickContext = {
        now,
        offset,
        runRitual: (ritual, target, run) => maybeRun(b, ritual, target, now, run, false),
      };
      for (const plugin of plugins) {
        if (plugin.onTick) await plugin.onTick(b, ctx);
      }
    }
  } catch (err) {
    console.error('[agent:jobs] tick failed:', err instanceof Error ? err.message : err);
  } finally {
    tickRunning = false;
  }
}
