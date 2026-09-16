import { NextRequest, NextResponse } from 'next/server';
import { assertCronRequest, cronTriggeredBy } from '@/lib/cron-auth';
import { eq, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, cronRuns } from '@/lib/db/schema';
import { sendMessage } from '@/lib/telegram';
import { activeBrandFor, buildMorningBrief, ritualEnabled, saveLastIdeas } from '@/lib/briefs';

export const maxDuration = 300;

interface PerUserResult {
  userId: string;
  status: 'sent' | 'no-brand' | 'nothing-to-say' | 'ritual-off' | 'error';
  error?: string;
}

export async function POST(req: NextRequest) {
  const unauthorized = assertCronRequest(req);
  if (unauthorized) return unauthorized;
  const triggeredBy = cronTriggeredBy(req);

  const start = Date.now();

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    await db.insert(cronRuns).values({
      jobName: 'telegram-daily',
      status: 'failed',
      triggeredBy,
      result: { error: 'TELEGRAM_BOT_TOKEN not set' },
      durationMs: Date.now() - start,
    });
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 503 });
  }

  const linkedUsers = await db
    .select({
      id: users.id,
      telegramChatId: users.telegramChatId,
      ritualSettings: users.ritualSettings,
    })
    .from(users)
    .where(isNotNull(users.telegramChatId));

  const results: PerUserResult[] = [];

  for (const u of linkedUsers) {
    if (!u.telegramChatId) continue;

    if (!ritualEnabled(u.ritualSettings, 'morning_brief')) {
      results.push({ userId: u.id, status: 'ritual-off' });
      continue;
    }

    try {
      const brand = await activeBrandFor(u.id);
      if (!brand) {
        results.push({ userId: u.id, status: 'no-brand' });
        continue;
      }

      const brief = await buildMorningBrief(u.id, brand.id, brand.name);
      if (!brief) {
        results.push({ userId: u.id, status: 'nothing-to-say' });
        continue;
      }

      await sendMessage(u.telegramChatId, brief.body);
      await saveLastIdeas(u.id, 'daily', brief.ideas);

      results.push({ userId: u.id, status: 'sent' });
    } catch (err) {
      results.push({
        userId: u.id,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const skipped = results.filter(r => r.status !== 'sent' && r.status !== 'error').length;
  const errored = results.filter(r => r.status === 'error').length;

  // Status: failed if every linked user errored, partial if some errored, success otherwise.
  let status: 'success' | 'partial' | 'failed' = 'success';
  if (linkedUsers.length === 0) {
    status = 'success'; // nothing to do is fine
  } else if (errored > 0 && sent === 0) {
    status = 'failed';
  } else if (errored > 0) {
    status = 'partial';
  }

  const durationMs = Date.now() - start;
  await db.insert(cronRuns).values({
    jobName: 'telegram-daily',
    status,
    triggeredBy,
    result: { total: linkedUsers.length, sent, skipped, errored, recipients: sent, details: results },
    durationMs,
  });

  return NextResponse.json({
    ok: true,
    total: linkedUsers.length,
    sent,
    skipped,
    errored,
    durationMs,
    status,
    details: results,
  });
}
