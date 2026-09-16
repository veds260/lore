import { NextRequest, NextResponse } from 'next/server';
import { assertCronRequest, cronTriggeredBy } from '@/lib/cron-auth';
import { and, eq, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { cronRuns, scheduledPosts, users } from '@/lib/db/schema';
import { sendMessage } from '@/lib/telegram';
import { LINKEDIN_SHARE_URL, xIntentUrl } from '@/lib/post-intents';

export const maxDuration = 120;

const BATCH = 50;

// Scheduled posts are reminders. When one is due, mark it and ping the owner
// on Telegram if they linked a chat. Nothing is posted from here.

interface ItemResult {
  id: string;
  status: 'reminded' | 'marked' | 'skipped' | 'failed';
  error?: string;
}

function reminderText(platform: string, content: string): string {
  const link = platform === 'linkedin' ? LINKEDIN_SHARE_URL : xIntentUrl(content);
  const where = platform === 'linkedin' ? 'LinkedIn' : 'X';
  return `time to post this one on ${where}\n\n${content}\n\n${link}`;
}

export async function POST(req: NextRequest) {
  const unauthorized = assertCronRequest(req);
  if (unauthorized) return unauthorized;
  const triggeredBy = cronTriggeredBy(req);

  const start = Date.now();
  const results: ItemResult[] = [];
  const telegramReady = !!process.env.TELEGRAM_BOT_TOKEN;

  const due = await db
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.status, 'pending'), lte(scheduledPosts.scheduledFor, new Date())))
    .limit(BATCH);

  for (const item of due) {
    // Atomic claim, another concurrent run skips rows it can't claim.
    const [claimed] = await db.update(scheduledPosts)
      .set({ status: 'due' })
      .where(and(eq(scheduledPosts.id, item.id), eq(scheduledPosts.status, 'pending')))
      .returning();
    if (!claimed) {
      results.push({ id: item.id, status: 'skipped' });
      continue;
    }

    try {
      const [owner] = await db
        .select({ telegramChatId: users.telegramChatId })
        .from(users)
        .where(eq(users.id, claimed.userId))
        .limit(1);

      if (!telegramReady || !owner?.telegramChatId) {
        results.push({ id: claimed.id, status: 'marked' });
        continue;
      }

      await sendMessage(owner.telegramChatId, reminderText(claimed.platform, claimed.content));
      await db.update(scheduledPosts)
        .set({ status: 'done', error: null })
        .where(eq(scheduledPosts.id, claimed.id));
      results.push({ id: claimed.id, status: 'reminded' });
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await db.update(scheduledPosts)
        .set({ error: message })
        .where(eq(scheduledPosts.id, claimed.id));
      results.push({ id: claimed.id, status: 'failed', error: message });
    }
  }

  const reminded = results.filter(r => r.status === 'reminded').length;
  const marked = results.filter(r => r.status === 'marked').length;
  const failed = results.filter(r => r.status === 'failed').length;

  let status: 'success' | 'partial' | 'failed' = 'success';
  if (failed > 0 && reminded + marked === 0) status = 'failed';
  else if (failed > 0) status = 'partial';

  const durationMs = Date.now() - start;
  await db.insert(cronRuns).values({
    jobName: 'publish-scheduled',
    status,
    triggeredBy,
    result: { due: due.length, reminded, marked, failed, details: results },
    durationMs,
  });

  return NextResponse.json({ ok: true, due: due.length, reminded, marked, failed, durationMs, status, details: results });
}
