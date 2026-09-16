import { NextRequest, NextResponse } from 'next/server';
import { assertCronRequest, cronTriggeredBy } from '@/lib/cron-auth';
import { db } from '@/lib/db';
import { brands, cronRuns } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { syncMainstreamNews } from '@/lib/sync-mainstream-news';
import { scoreUnscoredNewsForBrand } from '@/lib/score-news-for-brand';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const unauthorized = assertCronRequest(req);
  if (unauthorized) return unauthorized;
  const triggeredBy = cronTriggeredBy(req);

  const start = Date.now();

  // 1. Fetch fresh news items into mainstream_news_items (dedupes on URL)
  const syncResult = await syncMainstreamNews();

  // 2. Score for every brand that has opted in
  const optedInBrands = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(and(eq(brands.isActive, true), eq(brands.mainstreamNewsEnabled, true)));

  const perBrand: Record<string, { scored: number; skipped: number }> = {};
  let totalScored = 0;
  let totalSkipped = 0;
  let errored = 0;

  for (const brand of optedInBrands) {
    try {
      const r = await scoreUnscoredNewsForBrand(brand.id, { maxItems: 30 });
      perBrand[brand.name] = r;
      totalScored += r.scored;
      totalSkipped += r.skipped;
    } catch (err) {
      console.error(`[fetch-mainstream-news] scoring failed for brand ${brand.id}:`, err instanceof Error ? err.message : err);
      errored++;
    }
  }

  const durationMs = Date.now() - start;

  // Real status: failed if every brand errored, partial if some, success otherwise.
  let status: 'success' | 'partial' | 'failed' = 'success';
  if (optedInBrands.length > 0 && errored === optedInBrands.length) status = 'failed';
  else if (errored > 0) status = 'partial';

  await db.insert(cronRuns).values({
    jobName: 'fetch-mainstream-news',
    status,
    triggeredBy,
    result: {
      fetched: syncResult.fetched,
      inserted: syncResult.inserted,
      perSource: syncResult.perSource,
      brandsScored: optedInBrands.length,
      totalScored,
      totalSkipped,
      errored,
      perBrand,
    },
    durationMs,
  });

  return NextResponse.json({
    ok: true,
    fetched: syncResult.fetched,
    inserted: syncResult.inserted,
    brandsScored: optedInBrands.length,
    totalScored,
    durationMs,
    status,
  });
}
