import { NextRequest, NextResponse } from 'next/server';
import { assertCronRequest, cronTriggeredBy } from '@/lib/cron-auth';
import { and, eq, lte, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { brands, cronRuns, scheduledPosts } from '@/lib/db/schema';
import { postTweet, postUrl, refreshAccessToken } from '@/lib/x-oauth';
import { recordCost } from '@/lib/credits';

export const maxDuration = 120;

const BATCH = 20;
const STUCK_MS = 15 * 60 * 1000;

interface ItemResult {
  id: string;
  status: 'posted' | 'failed' | 'skipped';
  error?: string;
}

// Ensures a usable access token for the brand, refreshing (and persisting the
// rotated refresh token) when within 5 minutes of expiry.
async function freshAccessToken(brand: {
  id: string;
  xAccessToken: string | null;
  xRefreshToken: string | null;
  xTokenExpiresAt: Date | null;
}): Promise<string> {
  if (!brand.xAccessToken) throw new Error('brand has no X connection');
  const expiresSoon = !brand.xTokenExpiresAt || brand.xTokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000;
  if (!expiresSoon) return brand.xAccessToken;
  if (!brand.xRefreshToken) throw new Error('X token expired and no refresh token stored');

  const tokens = await refreshAccessToken(brand.xRefreshToken);
  await db.update(brands)
    .set({
      xAccessToken: tokens.accessToken,
      xRefreshToken: tokens.refreshToken ?? brand.xRefreshToken,
      xTokenExpiresAt: tokens.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(brands.id, brand.id));
  return tokens.accessToken;
}

export async function POST(req: NextRequest) {
  const unauthorized = assertCronRequest(req);
  if (unauthorized) return unauthorized;
  const triggeredBy = cronTriggeredBy(req);

  const start = Date.now();
  const results: ItemResult[] = [];

  // Crash recovery: anything stuck in 'posting' for 15+ minutes failed silently.
  await db.update(scheduledPosts)
    .set({ status: 'failed', error: 'publisher crashed mid-post (auto-recovered)' })
    .where(and(
      eq(scheduledPosts.status, 'posting'),
      lt(scheduledPosts.createdAt, new Date(Date.now() - STUCK_MS)),
      lte(scheduledPosts.scheduledFor, new Date(Date.now() - STUCK_MS)),
    ));

  const due = await db
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.status, 'pending'), lte(scheduledPosts.scheduledFor, new Date())))
    .limit(BATCH);

  for (const item of due) {
    // Atomic claim, another concurrent run skips rows it can't claim.
    const [claimed] = await db.update(scheduledPosts)
      .set({ status: 'posting' })
      .where(and(eq(scheduledPosts.id, item.id), eq(scheduledPosts.status, 'pending')))
      .returning();
    if (!claimed) {
      results.push({ id: item.id, status: 'skipped' });
      continue;
    }

    try {
      if (claimed.platform !== 'twitter') {
        throw new Error(`publishing not implemented for platform '${claimed.platform}'`);
      }
      if (!claimed.brandId) throw new Error('scheduled post has no brand');

      const [brand] = await db
        .select({
          id: brands.id,
          xUsername: brands.xUsername,
          xAccessToken: brands.xAccessToken,
          xRefreshToken: brands.xRefreshToken,
          xTokenExpiresAt: brands.xTokenExpiresAt,
        })
        .from(brands)
        .where(eq(brands.id, claimed.brandId))
        .limit(1);
      if (!brand) throw new Error('brand not found');

      const token = await freshAccessToken(brand);
      const tweet = await postTweet(token, claimed.content);
      const url = postUrl(brand.xUsername, tweet.id);

      await db.update(scheduledPosts)
        .set({ status: 'posted', postedAt: new Date(), postUrl: url, error: null })
        .where(eq(scheduledPosts.id, claimed.id));

      recordCost(claimed.userId, 'x_publish', { scheduledPostId: claimed.id, url }).catch(() => {});
      results.push({ id: claimed.id, status: 'posted' });
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await db.update(scheduledPosts)
        .set({ status: 'failed', error: message })
        .where(eq(scheduledPosts.id, claimed.id));
      results.push({ id: claimed.id, status: 'failed', error: message });
    }
  }

  const posted = results.filter(r => r.status === 'posted').length;
  const failed = results.filter(r => r.status === 'failed').length;

  let status: 'success' | 'partial' | 'failed' = 'success';
  if (failed > 0 && posted === 0 && results.length > 0) status = 'failed';
  else if (failed > 0) status = 'partial';

  const durationMs = Date.now() - start;
  await db.insert(cronRuns).values({
    jobName: 'publish-scheduled',
    status,
    triggeredBy,
    result: { due: due.length, posted, failed, details: results },
    durationMs,
  });

  return NextResponse.json({ ok: true, due: due.length, posted, failed, durationMs, status, details: results });
}
