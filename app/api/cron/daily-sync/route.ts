import { NextRequest, NextResponse } from 'next/server';
import { assertCronRequest, cronTriggeredBy } from '@/lib/cron-auth';
import { db } from '@/lib/db';
import { brands, cronRuns, drafts, ownPosts } from '@/lib/db/schema';
import { eq, isNotNull, isNull, and, gte } from 'drizzle-orm';
import { syncBrandTweets } from '@/lib/sync-brand-tweets';
import { syncLinkedInPosts } from '@/lib/sync-linkedin-posts';

function bigrams(str: string): Set<string> {
  const s = str.toLowerCase().replace(/\s+/g, ' ').trim();
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function jaccardSimilarity(a: string, b: string): number {
  const ba = bigrams(a);
  const bb = bigrams(b);
  let intersection = 0;
  for (const g of ba) if (bb.has(g)) intersection++;
  const union = ba.size + bb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

async function matchDraftsToOwnPosts(brandId: string): Promise<number> {
  // Only match drafts that haven't been matched yet
  const unmatchedDrafts = await db
    .select({ id: drafts.id, content: drafts.content })
    .from(drafts)
    .where(and(eq(drafts.brandId, brandId), isNull(drafts.postedAt)));

  if (unmatchedDrafts.length === 0) return 0;

  // Look at own posts from the last 60 days
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const recentPosts = await db
    .select({
      content: ownPosts.content,
      postedAt: ownPosts.postedAt,
      likeCount: ownPosts.likeCount,
      retweetCount: ownPosts.retweetCount,
      replyCount: ownPosts.replyCount,
      viewCount: ownPosts.viewCount,
    })
    .from(ownPosts)
    .where(and(eq(ownPosts.brandId, brandId), gte(ownPosts.postedAt, since)));

  if (recentPosts.length === 0) return 0;

  let matched = 0;
  for (const post of recentPosts) {
    let bestDraftId: string | null = null;
    let bestScore = 0;

    for (const draft of unmatchedDrafts) {
      const score = jaccardSimilarity(draft.content, post.content);
      if (score > bestScore) {
        bestScore = score;
        bestDraftId = draft.id;
      }
    }

    if (bestDraftId && bestScore >= 0.65) {
      await db.update(drafts)
        .set({
          postedAt: post.postedAt,
          likes: post.likeCount,
          reposts: post.retweetCount,
          replies: post.replyCount,
          impressions: post.viewCount,
          status: 'posted',
          updatedAt: new Date(),
        })
        .where(eq(drafts.id, bestDraftId));

      // Remove from candidates so it can't match again
      const idx = unmatchedDrafts.findIndex(d => d.id === bestDraftId);
      if (idx !== -1) unmatchedDrafts.splice(idx, 1);

      matched++;
    }
  }

  return matched;
}

// Triggered by Railway cron or admin panel. Not user-facing.
export async function POST(req: NextRequest) {
  const unauthorized = assertCronRequest(req);
  if (unauthorized) return unauthorized;
  const triggeredBy = cronTriggeredBy(req);

  const start = Date.now();
  const results: Record<string, { twitter: number; linkedin: number; matched: number }> = {};

  const activeBrands = await db
    .select({ id: brands.id, handle: brands.handle, linkedinHandle: brands.linkedinHandle })
    .from(brands)
    .where(eq(brands.isActive, true));

  for (const brand of activeBrands) {
    let twitterSynced = 0;
    let linkedinSynced = 0;

    if (brand.handle) {
      twitterSynced = await syncBrandTweets(brand.id, brand.handle);
    }

    if (brand.linkedinHandle) {
      linkedinSynced = await syncLinkedInPosts(brand.id, brand.linkedinHandle);
    }

    const matched = await matchDraftsToOwnPosts(brand.id);

    results[brand.id] = { twitter: twitterSynced, linkedin: linkedinSynced, matched };
  }

  const durationMs = Date.now() - start;
  const totalTwitter = Object.values(results).reduce((s, r) => s + r.twitter, 0);
  const totalLinkedin = Object.values(results).reduce((s, r) => s + r.linkedin, 0);
  const totalMatched = Object.values(results).reduce((s, r) => s + r.matched, 0);

  await db.insert(cronRuns).values({
    jobName: 'daily-sync',
    status: 'success',
    triggeredBy,
    result: { brands: activeBrands.length, totalTwitter, totalLinkedin, totalMatched, perBrand: results },
    durationMs,
  });

  return NextResponse.json({ ok: true, brands: activeBrands.length, totalTwitter, totalLinkedin, totalMatched, durationMs });
}
