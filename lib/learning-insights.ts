import { and, desc, eq, gte, lt, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { brands, drafts, ownPosts, skills } from './db/schema';

const DAYS_30 = 30 * 24 * 60 * 60 * 1000;
const DAYS_60 = 60 * 24 * 60 * 60 * 1000;

export interface LearningInsights {
  stats: {
    draftsCreated: number;
    postsPublished: number;
    avgImpressions: number;
    avgImpressionsDelta: number | null;
    rulesLearnedRecently: number;
    totalRules: number;
    hooksInLibrary: number;
  };
  topPosts: Array<{
    id: string;
    hook: string;
    platform: string;
    postedAt: string;
    likes: number;
    replies: number;
    reposts: number;
    views: number;
  }>;
  learnedRules: Array<{
    id: string;
    name: string;
    body: string;
    kind: string;
    source: string;
    timesApplied: number;
    learnedAt: string;
  }>;
  hooks: Array<{
    id: string;
    name: string;
    body: string;
    timesApplied: number;
    createdAt: string;
  }>;
  voiceProfile: {
    lastUpdated: string | null;
    pillars: string[];
  };
}

export async function getInsightsForBrand(brandId: string): Promise<LearningInsights | null> {
  try {
    return await getInsightsForBrandInner(brandId);
  } catch (err) {
    console.error('[learning-insights] failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function getInsightsForBrandInner(brandId: string): Promise<LearningInsights | null> {
  const [brand] = await db
    .select({
      id: brands.id,
      voiceDocumentUpdatedAt: brands.voiceDocumentUpdatedAt,
      contentPillars: brands.contentPillars,
    })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);

  if (!brand) return null;

  const since30 = new Date(Date.now() - DAYS_30);
  const since60 = new Date(Date.now() - DAYS_60);

  const [draftStats] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(drafts)
    .where(and(eq(drafts.brandId, brand.id), gte(drafts.createdAt, since30)));

  const [postStats] = await db
    .select({
      count:    sql<number>`count(*)::int`,
      avgViews: sql<number>`coalesce(avg(${ownPosts.viewCount}), 0)::int`,
    })
    .from(ownPosts)
    .where(and(eq(ownPosts.brandId, brand.id), gte(ownPosts.postedAt, since30)));

  const [priorPostStats] = await db
    .select({ avgViews: sql<number>`coalesce(avg(${ownPosts.viewCount}), 0)::int` })
    .from(ownPosts)
    .where(and(
      eq(ownPosts.brandId, brand.id),
      gte(ownPosts.postedAt, since60),
      lt(ownPosts.postedAt, since30),
    ));

  const topPosts = await db
    .select({
      id: ownPosts.id,
      content: ownPosts.content,
      platform: ownPosts.platform,
      postedAt: ownPosts.postedAt,
      likes: ownPosts.likeCount,
      replies: ownPosts.replyCount,
      reposts: ownPosts.retweetCount,
      views: ownPosts.viewCount,
    })
    .from(ownPosts)
    .where(and(eq(ownPosts.brandId, brand.id), gte(ownPosts.postedAt, since30)))
    .orderBy(desc(sql`${ownPosts.likeCount} + ${ownPosts.retweetCount} * 2 + ${ownPosts.replyCount}`))
    .limit(3);

  const learnedRules = await db
    .select({
      id: skills.id,
      name: skills.name,
      body: skills.body,
      kind: skills.kind,
      source: skills.source,
      timesApplied: skills.timesApplied,
      createdAt: skills.createdAt,
    })
    .from(skills)
    .where(and(
      eq(skills.brandId, brand.id),
      eq(skills.status, 'active'),
      inArray(skills.kind, ['voice_rule', 'avoidance_rule', 'format_rule', 'structure_template']),
      inArray(skills.source, ['auto', 'consolidated']),
      gte(skills.createdAt, since30),
    ))
    .orderBy(desc(skills.createdAt))
    .limit(8);

  const hooks = await db
    .select({
      id: skills.id,
      name: skills.name,
      body: skills.body,
      timesApplied: skills.timesApplied,
      createdAt: skills.createdAt,
    })
    .from(skills)
    .where(and(
      eq(skills.brandId, brand.id),
      eq(skills.kind, 'hook_formula'),
      eq(skills.status, 'active'),
    ))
    .orderBy(desc(skills.timesApplied), desc(skills.createdAt))
    .limit(6);

  const [totalRules] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(skills)
    .where(and(
      eq(skills.brandId, brand.id),
      eq(skills.status, 'active'),
      inArray(skills.kind, ['voice_rule', 'avoidance_rule', 'format_rule', 'structure_template']),
    ));

  const viewsDelta = priorPostStats?.avgViews
    ? Math.round(((postStats.avgViews - priorPostStats.avgViews) / priorPostStats.avgViews) * 100)
    : null;

  return {
    stats: {
      draftsCreated: draftStats?.total ?? 0,
      postsPublished: postStats?.count ?? 0,
      avgImpressions: postStats?.avgViews ?? 0,
      avgImpressionsDelta: viewsDelta,
      rulesLearnedRecently: learnedRules.length,
      totalRules: totalRules?.count ?? 0,
      hooksInLibrary: hooks.length,
    },
    topPosts: topPosts.map(p => ({
      id: p.id,
      hook: p.content.split('\n')[0].slice(0, 200),
      platform: p.platform,
      postedAt: p.postedAt.toISOString(),
      likes: p.likes,
      replies: p.replies,
      reposts: p.reposts,
      views: p.views,
    })),
    learnedRules: learnedRules.map(r => ({
      id: r.id,
      name: r.name,
      body: r.body,
      kind: r.kind,
      source: r.source,
      timesApplied: r.timesApplied,
      learnedAt: r.createdAt.toISOString(),
    })),
    hooks: hooks.map(h => ({
      id: h.id,
      name: h.name,
      body: h.body,
      timesApplied: h.timesApplied,
      createdAt: h.createdAt.toISOString(),
    })),
    voiceProfile: {
      lastUpdated: brand.voiceDocumentUpdatedAt?.toISOString() ?? null,
      pillars: brand.contentPillars ?? [],
    },
  };
}
