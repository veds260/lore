import { db } from '@/lib/db';
import { ownPosts, brands, followerSnapshots } from '@/lib/db/schema';
import { fetchUserTweets, fetchUserTweetsSince, fetchUserInfo, xAvailable } from '@/lib/twitterapi';
import { eq, sql } from 'drizzle-orm';

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

// Fast-path: profile info + 10 most recent tweets. Used during interview-first onboarding
// so the question generator has something specific to reference in Q1-Q9. ~2-3 seconds.
export async function quickSyncBrandTweets(brandId: string, handle: string): Promise<number> {
  if (!(await xAvailable())) return 0;

  const [profileRes, tweetsRes] = await Promise.allSettled([
    fetchUserInfo(handle),
    fetchUserTweets(handle, 10),
  ]);

  // Profile info → avatar + follower snapshot + bio (appended to briefMd for richer interview context)
  if (profileRes.status === 'fulfilled' && profileRes.value) {
    const info = profileRes.value;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (info.avatarUrl) updates.avatarUrl = info.avatarUrl;

    // If we have a bio, append it to the briefMd so the AI sees who they are beyond just tweets
    if (info.description?.trim() || info.location?.trim()) {
      const [current] = await db.select({ briefMd: brands.briefMd }).from(brands).where(eq(brands.id, brandId)).limit(1);
      const bioBlock = [
        info.description?.trim() ? `X bio: ${info.description.trim()}` : null,
        info.location?.trim() ? `Location: ${info.location.trim()}` : null,
      ].filter(Boolean).join('\n');
      updates.briefMd = current?.briefMd ? `${current.briefMd}\n\n${bioBlock}` : bioBlock;
    }

    await db.update(brands).set(updates).where(eq(brands.id, brandId));
    if (info.followerCount != null) {
      await db.insert(followerSnapshots).values({
        brandId,
        platform: 'twitter',
        followerCount: info.followerCount,
      }).catch(() => {});
    }
  }

  // 10 most recent tweets → ownPosts
  if (tweetsRes.status === 'fulfilled' && tweetsRes.value.length > 0) {
    const tweets = tweetsRes.value;
    const now = new Date();
    try {
      await db.insert(ownPosts).values(
        tweets.map(t => ({
          brandId,
          platform: 'twitter',
          externalId: t.id,
          content: t.text,
          postedAt: new Date(t.createdAt),
          likeCount: t.likeCount ?? 0,
          retweetCount: t.retweetCount ?? 0,
          replyCount: t.replyCount ?? 0,
          viewCount: t.viewCount ?? 0,
          fetchedAt: now,
        }))
      ).onConflictDoNothing();
      return tweets.length;
    } catch (err) {
      console.error(`[quickSyncBrandTweets] insert failed:`, err instanceof Error ? err.message : err);
    }
  }
  return 0;
}

export async function syncBrandTweets(brandId: string, handle: string): Promise<number> {
  if (!(await xAvailable())) return 0;

  // Fetch profile info (avatar + follower count) alongside tweets
  const [userInfo] = await Promise.allSettled([
    fetchUserInfo(handle),
    Promise.resolve(null),
  ]);

  if (userInfo.status === 'fulfilled' && userInfo.value) {
    const info = userInfo.value;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (info.avatarUrl) updates.avatarUrl = info.avatarUrl;

    await db.update(brands).set(updates).where(eq(brands.id, brandId));

    if (info.followerCount != null) {
      await db.insert(followerSnapshots).values({
        brandId,
        platform: 'twitter',
        followerCount: info.followerCount,
      });
    }
  }

  const since = new Date(Date.now() - SIX_MONTHS_MS);
  let tweets: Awaited<ReturnType<typeof fetchUserTweetsSince>>;
  try {
    tweets = await fetchUserTweetsSince(handle, since, 200);
  } catch {
    return 0;
  }

  const BATCH = 50;
  let inserted = 0;
  const now = new Date();

  for (let i = 0; i < tweets.length; i += BATCH) {
    const batch = tweets.slice(i, i + BATCH);
    try {
      await db.insert(ownPosts).values(
        batch.map(t => ({
          brandId,
          platform: 'twitter',
          externalId: t.id,
          content: t.text,
          postedAt: new Date(t.createdAt),
          likeCount: t.likeCount ?? 0,
          retweetCount: t.retweetCount ?? 0,
          replyCount: t.replyCount ?? 0,
          viewCount: t.viewCount ?? 0,
          fetchedAt: now,
        }))
      ).onConflictDoUpdate({
        target: [ownPosts.brandId, ownPosts.externalId],
        set: {
          likeCount: sql`excluded.like_count`,
          retweetCount: sql`excluded.retweet_count`,
          replyCount: sql`excluded.reply_count`,
          viewCount: sql`excluded.view_count`,
          fetchedAt: sql`now()`,
        },
      });
      inserted += batch.length;
    } catch (err) {
      console.error(`[syncBrandTweets] Batch insert failed at offset ${i}:`, err instanceof Error ? err.message : err);
    }
  }
  return inserted;
}
