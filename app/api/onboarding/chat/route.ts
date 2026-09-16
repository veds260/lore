import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands, ownPosts } from '@/lib/db/schema';
import { callAI, MODEL_AGENT } from '@/lib/ai';
import { recordCost } from '@/lib/credits';

export const maxDuration = 60;

// Chat-led onboarding: the audit step. Computes real numbers from the user's
// backfilled posts and narrates them once. Everything else in the chat flow is
// deterministic client copy; this is the single model call.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (body?.step !== 'audit') {
    return NextResponse.json({ error: 'Unknown step' }, { status: 400 });
  }

  const [brand] = await db
    .select({ id: brands.id, name: brands.name, handle: brands.handle })
    .from(brands)
    .where(and(eq(brands.userId, session.user.id), eq(brands.isActive, true)))
    .orderBy(desc(brands.createdAt))
    .limit(1);
  if (!brand) {
    return NextResponse.json({ message: null, reason: 'no-brand' });
  }

  const [stats] = await db
    .select({
      postCount: sql<number>`count(*)::int`,
      avgViews: sql<number>`coalesce(avg(${ownPosts.viewCount}), 0)::float`,
      avgLikes: sql<number>`coalesce(avg(${ownPosts.likeCount}), 0)::float`,
      firstPost: sql<Date | null>`min(${ownPosts.postedAt})`,
      lastPost: sql<Date | null>`max(${ownPosts.postedAt})`,
    })
    .from(ownPosts)
    .where(eq(ownPosts.brandId, brand.id));

  if (!stats || stats.postCount === 0) {
    return NextResponse.json({ message: null, reason: 'no-posts' });
  }

  const [bestPost] = await db
    .select({
      content: ownPosts.content,
      views: ownPosts.viewCount,
      likes: ownPosts.likeCount,
      replies: ownPosts.replyCount,
    })
    .from(ownPosts)
    .where(eq(ownPosts.brandId, brand.id))
    .orderBy(desc(sql`${ownPosts.likeCount} + ${ownPosts.retweetCount} * 2 + ${ownPosts.replyCount}`))
    .limit(1);

  // Posting cadence over the captured window
  let cadence = '';
  if (stats.firstPost && stats.lastPost) {
    const spanDays = Math.max(1, (new Date(stats.lastPost).getTime() - new Date(stats.firstPost).getTime()) / 86_400_000);
    const perWeek = (stats.postCount / spanDays) * 7;
    cadence = `${perWeek.toFixed(1)} posts/week across the captured window`;
  }

  const recent = await db
    .select({ content: ownPosts.content, views: ownPosts.viewCount, likes: ownPosts.likeCount })
    .from(ownPosts)
    .where(and(eq(ownPosts.brandId, brand.id), gte(ownPosts.postedAt, new Date(Date.now() - 30 * 86_400_000))))
    .orderBy(desc(ownPosts.postedAt))
    .limit(5);

  const facts = [
    `Account: ${brand.handle ? '@' + brand.handle : brand.name}`,
    `Posts captured: ${stats.postCount}`,
    `Averages: ${Math.round(stats.avgViews)} views, ${stats.avgLikes.toFixed(1)} likes per post`,
    cadence ? `Cadence: ${cadence}` : '',
    bestPost
      ? `Best post: "${bestPost.content.split('\n')[0].slice(0, 120)}" with ${bestPost.views} views, ${bestPost.likes} likes, ${bestPost.replies} replies`
      : '',
    recent.length > 0
      ? `Last posts (newest first):\n${recent.map(p => `- "${p.content.split('\n')[0].slice(0, 80)}" (${p.views} views, ${p.likes} likes)`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n');

  const prompt = `You are Lore, an AI head of content, meeting a new user. You just read their real X posts. Give them a first-look audit in 4 to 6 sentences.

VOICE RULES (hard): plain language, warm, specific. NEVER use em dashes. NEVER use rhetorical questions. No "isn't X, it's Y" constructions. Numbers stay exact. Quote the first line of their best post back to them. Name one concrete thing the better posts have in common if the data supports it, otherwise skip that. End with exactly one real question: ask whether they want their posts witty and short, deep and valuable, or a mix.

FACTS (the only data you may use):
${facts}

Write the audit now. Output ONLY the message text.`;

  try {
    const message = await callAI({ model: MODEL_AGENT, prompt, temperature: 0.5, maxTokens: 400 });
    recordCost(session.user.id, 'brand_enrich', { kind: 'onboarding_audit', brandId: brand.id }).catch(() => {});
    if (!message || message.length < 30) {
      return NextResponse.json({ message: null, reason: 'generation-failed' });
    }
    return NextResponse.json({ message, postCount: stats.postCount });
  } catch {
    return NextResponse.json({ message: null, reason: 'generation-failed' });
  }
}
