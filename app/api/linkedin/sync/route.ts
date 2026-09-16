import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands, ownPosts } from '@/lib/db/schema';
import { eq, and, gte, count } from 'drizzle-orm';
import { syncLinkedInPosts } from '@/lib/sync-linkedin-posts';
import { deductCredits, checkDailyScrapeLimit } from '@/lib/credits';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;
  const { force } = await req.json().catch(() => ({}) as { force?: boolean });

  const [brand] = await db
    .select({
      id: brands.id,
      linkedinHandle: brands.linkedinHandle,
      linkedinPersonId: brands.linkedinPersonId,
      linkedinAccessToken: brands.linkedinAccessToken,
    })
    .from(brands)
    .where(and(eq(brands.userId, userId), eq(brands.isActive, true)))
    .limit(1);

  if (!brand?.linkedinHandle) {
    return NextResponse.json({ error: 'No LinkedIn handle set on brand' }, { status: 400 });
  }

  if (!brand.linkedinPersonId || !brand.linkedinAccessToken) {
    return NextResponse.json({
      error: 'LinkedIn account not connected. Go to Settings and click Connect LinkedIn.',
      type: 'not_connected',
    }, { status: 400 });
  }

  const scrapeLimit = await checkDailyScrapeLimit(userId);
  if (!scrapeLimit.allowed) {
    return NextResponse.json({
      error: 'Daily scrape limit reached',
      used: scrapeLimit.used,
      limit: scrapeLimit.limit,
      type: 'scrape_limit',
    }, { status: 429 });
  }

  if (!force) {
    const cutoff = new Date(Date.now() - CACHE_TTL_MS);
    const [{ n }] = await db
      .select({ n: count() })
      .from(ownPosts)
      .where(and(
        eq(ownPosts.brandId, brand.id),
        eq(ownPosts.platform, 'linkedin'),
        gte(ownPosts.fetchedAt, cutoff),
      ));
    if (Number(n) > 0) {
      return NextResponse.json({ cached: true, message: 'Cache is fresh. Pass force=true to refresh.' });
    }
  }

  const synced = await syncLinkedInPosts(brand.id, brand.linkedinHandle);
  await deductCredits(userId, 'scrape_linkedin');
  return NextResponse.json({ synced, total: synced });
}
