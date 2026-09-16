import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands, ownPosts, followerSnapshots } from '@/lib/db/schema';
import { and, eq, gte, desc, asc } from 'drizzle-orm';

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [brand] = await db
    .select({ id: brands.id, handle: brands.handle })
    .from(brands)
    .where(and(eq(brands.userId, session.user.id), eq(brands.isActive, true)))
    .limit(1);

  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 });

  const since = new Date(Date.now() - NINETY_DAYS);

  const posts = await db
    .select({
      id: ownPosts.id,
      platform: ownPosts.platform,
      content: ownPosts.content,
      postedAt: ownPosts.postedAt,
      likeCount: ownPosts.likeCount,
      retweetCount: ownPosts.retweetCount,
      replyCount: ownPosts.replyCount,
      viewCount: ownPosts.viewCount,
      commentCount: ownPosts.commentCount,
    })
    .from(ownPosts)
    .where(and(
      eq(ownPosts.brandId, brand.id),
      eq(ownPosts.platform, 'twitter'),
      gte(ownPosts.postedAt, since),
    ))
    .orderBy(desc(ownPosts.postedAt))
    .limit(500);

  const sixtyDays = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const snapshots = await db
    .select({ followerCount: followerSnapshots.followerCount, recordedAt: followerSnapshots.recordedAt })
    .from(followerSnapshots)
    .where(and(
      eq(followerSnapshots.brandId, brand.id),
      eq(followerSnapshots.platform, 'twitter'),
      gte(followerSnapshots.recordedAt, sixtyDays),
    ))
    .orderBy(asc(followerSnapshots.recordedAt))
    .limit(120);

  const latestFollowers = snapshots.at(-1)?.followerCount ?? null;

  const topPosts = [...posts]
    .map(p => ({
      ...p,
      totalInteractions: p.likeCount + p.retweetCount + p.replyCount + p.commentCount,
      content: p.content.slice(0, 280),
    }))
    .sort((a, b) => b.totalInteractions - a.totalInteractions)
    .slice(0, 20);

  // Heatmap
  const heatmapMap = new Map<string, { sum: number; count: number }>();
  for (const p of posts) {
    const d = p.postedAt.getUTCDay();
    const h = p.postedAt.getUTCHours();
    const key = `${d}-${h}`;
    const interactions = p.likeCount + p.retweetCount + p.replyCount + p.commentCount;
    const existing = heatmapMap.get(key) ?? { sum: 0, count: 0 };
    heatmapMap.set(key, { sum: existing.sum + interactions, count: existing.count + 1 });
  }
  const heatmap = Array.from(heatmapMap.entries()).map(([key, val]) => {
    const [day, hour] = key.split('-').map(Number);
    return { day, hour, avg: val.sum / val.count, count: val.count };
  });

  // Posts per week (last 12 weeks)
  const twelveWeeks = new Map<string, number>();
  for (const p of posts) {
    const weekStart = new Date(p.postedAt);
    weekStart.setUTCHours(0, 0, 0, 0);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    const key = weekStart.toISOString().slice(0, 10);
    twelveWeeks.set(key, (twelveWeeks.get(key) ?? 0) + 1);
  }
  const activityByWeek = Array.from(twelveWeeks.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, count]) => ({ week, count }));

  const avgEngagement = posts.length
    ? posts.reduce((s, p) => s + p.likeCount + p.retweetCount + p.replyCount, 0) / posts.length
    : null;

  return NextResponse.json({
    hasSocialData: posts.length > 0,
    summary: {
      totalPosts: posts.length,
      latestFollowers,
      avgEngagement: avgEngagement != null ? Math.round(avgEngagement * 10) / 10 : null,
    },
    topPosts,
    followerHistory: snapshots.map(s => ({
      count: s.followerCount,
      date: s.recordedAt.toISOString().slice(0, 10),
    })),
    heatmap,
    activityByWeek,
  });
}
