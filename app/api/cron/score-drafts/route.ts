import { NextRequest, NextResponse } from 'next/server';
import { assertCronRequest, cronTriggeredBy } from '@/lib/cron-auth';
import { db } from '@/lib/db';
import { drafts, cronRuns, systemConfig } from '@/lib/db/schema';
import { eq, isNull, and, not, inArray } from 'drizzle-orm';
import { scoreDraft } from '@/lib/score-draft';

export const maxDuration = 300;

async function isJobEnabled(): Promise<boolean> {
  const [row] = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, 'cron:score-drafts:enabled'));
  if (!row) return true;
  return (row.value as { enabled: boolean }).enabled !== false;
}

export async function POST(req: NextRequest) {
  const unauthorized = assertCronRequest(req);
  if (unauthorized) return unauthorized;
  const triggeredBy = cronTriggeredBy(req);

  const enabled = await isJobEnabled();
  if (!enabled) {
    await db.insert(cronRuns).values({
      jobName: 'score-drafts',
      status: 'skipped',
      triggeredBy,
      result: { reason: 'disabled' },
      durationMs: 0,
    });
    return NextResponse.json({ skipped: true, reason: 'disabled' });
  }

  const start = Date.now();
  let scored = 0;
  let failed = 0;

  // Find unscored drafts that have real content (not ideas without content)
  const unscored = await db
    .select({ id: drafts.id, content: drafts.content })
    .from(drafts)
    .where(
      and(
        isNull(drafts.qualityScore),
        not(inArray(drafts.status, ['idea'])),
      ),
    )
    .limit(50); // cap per run to control cost

  for (const draft of unscored) {
    if (!draft.content?.trim() || draft.content.length < 20) continue;
    const scores = await scoreDraft(draft.content);
    if (scores) {
      await db.update(drafts)
        .set({
          qualityScore: scores.quality,
          hookScore: scores.hook,
          substanceScore: scores.substance,
          authenticityScore: scores.authenticity,
          formattingScore: scores.formatting,
          updatedAt: new Date(),
        })
        .where(eq(drafts.id, draft.id));
      scored++;
    } else {
      failed++;
    }
  }

  const durationMs = Date.now() - start;

  // Real status: success only if no failures, partial if some, failed if all
  let status: 'success' | 'partial' | 'failed' = 'success';
  if (failed > 0 && scored === 0) status = 'failed';
  else if (failed > 0) status = 'partial';

  await db.insert(cronRuns).values({
    jobName: 'score-drafts',
    status,
    triggeredBy,
    result: { scored, failed, total: unscored.length },
    durationMs,
  });

  return NextResponse.json({ ok: true, scored, failed, total: unscored.length, durationMs, status });
}
