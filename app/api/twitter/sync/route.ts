import { xAvailable } from '@/lib/twitterapi';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands, ownPosts } from '@/lib/db/schema';
import { eq, and, gte, count } from 'drizzle-orm';
import { syncBrandTweets } from '@/lib/sync-brand-tweets';
import { deductCredits, checkDailyScrapeLimit } from '@/lib/credits';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // re-fetch after 7 days

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;
  const { force } = await req.json().catch(() => ({}) as { force?: boolean });

  const [brand] = await db
    .select({ id: brands.id, handle: brands.handle })
    .from(brands)
    .where(and(eq(brands.userId, userId), eq(brands.isActive, true)))
    .limit(1);

  if (!brand?.handle) {
    return NextResponse.json({ error: 'No Twitter handle set on brand' }, { status: 400 });
  }

  if (!(await xAvailable())) {
    return NextResponse.json({ error: 'Twitter API not configured' }, { status: 503 });
  }

  // Check daily scrape limit
  const scrapeLimit = await checkDailyScrapeLimit(userId);
  if (!scrapeLimit.allowed) {
    return NextResponse.json({
      error: 'Daily scrape limit reached',
      used: scrapeLimit.used,
      limit: scrapeLimit.limit,
      type: 'scrape_limit',
    }, { status: 429 });
  }

  // Check if cache is still fresh (unless force=true)
  if (!force) {
    const cutoff = new Date(Date.now() - CACHE_TTL_MS);
    const [{ n }] = await db
      .select({ n: count() })
      .from(ownPosts)
      .where(and(eq(ownPosts.brandId, brand.id), gte(ownPosts.fetchedAt, cutoff)));
    if (Number(n) > 0) {
      return NextResponse.json({ cached: true, message: 'Cache is fresh (fetched within 7 days). Pass force=true to refresh.' });
    }
  }

  const synced = await syncBrandTweets(brand.id, brand.handle);
  // Deduct credit for the scrape (best-effort, agency users are unlimited)
  await deductCredits(userId, 'scrape_twitter');
  return NextResponse.json({ synced, total: synced });
}
