import { NextRequest, NextResponse } from 'next/server';
import { assertCronRequest, cronTriggeredBy } from '@/lib/cron-auth';
import { eq, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, cronRuns } from '@/lib/db/schema';
import { sendMessage } from '@/lib/telegram';
import { activeBrandFor, buildEveningReport, ritualEnabled } from '@/lib/briefs';

export const maxDuration = 300;

const DAYS_1 = 24 * 60 * 60 * 1000;

interface PerUserResult {
  userId: string;
  status: 'sent' | 'no-brand' | 'quiet-day' | 'recent-ping' | 'ritual-off' | 'error';
  error?: string;
}

export async function POST(req: NextRequest) {
  const unauthorized = assertCronRequest(req);
  if (unauthorized) return unauthorized;
  const triggeredBy = cronTriggeredBy(req);

  const start = Date.now();

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    await db.insert(cronRuns).values({
      jobName: 'telegram-performance',
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
      lastIdeas: users.telegramLastIdeas,
    })
    .from(users)
    .where(isNotNull(users.telegramChatId));

  const results: PerUserResult[] = [];
  const since1 = Date.now() - DAYS_1;

  for (const u of linkedUsers) {
    if (!u.telegramChatId) continue;

    if (!ritualEnabled(u.ritualSettings, 'evening_report')) {
      results.push({ userId: u.id, status: 'ritual-off' });
      continue;
    }

    // Don't pile on if a perf ping already went out in the last 24h (the
    // morning brief is separate, it has its own slot).
    if (u.lastIdeas?.type === 'perf' && u.lastIdeas.sentAt) {
      if (new Date(u.lastIdeas.sentAt).getTime() > since1) {
        results.push({ userId: u.id, status: 'recent-ping' });
        continue;
      }
    }

    try {
      const brand = await activeBrandFor(u.id);
      if (!brand) {
        results.push({ userId: u.id, status: 'no-brand' });
        continue;
      }

      const report = await buildEveningReport(u.id, brand.id, brand.name);
      if (!report) {
        results.push({ userId: u.id, status: 'quiet-day' });
        continue;
      }

      await sendMessage(u.telegramChatId, report.body);

      await db.update(users)
        .set({
          telegramLastIdeas: {
            type: 'perf',
            sentAt: new Date().toISOString(),
            ideas: [],
          },
          updatedAt: new Date(),
        })
        .where(eq(users.id, u.id));

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
  const errored = results.filter(r => r.status === 'error').length;

  let status: 'success' | 'partial' | 'failed' = 'success';
  if (linkedUsers.length === 0) {
    status = 'success';
  } else if (errored > 0 && sent === 0) {
    status = 'failed';
  } else if (errored > 0) {
    status = 'partial';
  }

  const durationMs = Date.now() - start;
  await db.insert(cronRuns).values({
    jobName: 'telegram-performance',
    status,
    triggeredBy,
    result: { total: linkedUsers.length, pinged: sent, errored, recipients: sent, details: results },
    durationMs,
  });

  return NextResponse.json({
    ok: true,
    total: linkedUsers.length,
    sent,
    errored,
    durationMs,
    status,
    details: results,
  });
}
