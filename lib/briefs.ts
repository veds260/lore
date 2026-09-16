// Editorial Telegram briefs, the proactive layer.
//
// Two briefs per day, both generated (not templated):
//   - Morning brief: performance vs the user's own baseline, one extracted
//     pattern, stale-draft nudges, today's ideas, honest gaps.
//   - Evening report: what shipped today, how it's pulling vs baseline
//     (including underperformance), who engaged, what to queue for tomorrow.
//
// Data is computed in plain SQL; the model only writes the words. The model
// is told to skip sections it has no data for instead of padding, so a quiet
// day says "nothing worth your attention" instead of inventing insight.

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { brands, drafts, ownPosts, users } from './db/schema';
import { callAI, MODEL_AGENT } from './ai';
import { generateIdeasFromLatestInterview, type ContentIdea } from './interview-engine';
import { recordCost } from './credits';

const DAY = 24 * 60 * 60 * 1000;

export interface BriefResult {
  body: string;
  ideas: ContentIdea[];           // numbered ideas referenced in the body (reply-with-number)
  meta: Record<string, unknown>;  // cron logging
}

export type RitualId = 'morning_brief' | 'evening_report';

// Absent key = enabled. Rituals are opt-out, not opt-in.
export function ritualEnabled(
  settings: Record<string, { enabled: boolean }> | null | undefined,
  ritual: RitualId,
): boolean {
  return settings?.[ritual]?.enabled !== false;
}

interface BrandSnapshot {
  brandId: string;
  brandName: string;
  baseline14d: { avgViews: number; avgLikes: number; postCount: number };
  daysSinceLastPost: number | null;
  latestPosts: Array<{
    content: string;
    postedAt: Date;
    views: number;
    likes: number;
    replies: number;
    platform: string;
  }>;
  bestPost14d: { content: string; views: number; likes: number } | null;
  queuedDrafts: Array<{ content: string; ageDays: number; status: string }>;
}

async function loadSnapshot(brandId: string, brandName: string): Promise<BrandSnapshot> {
  const since14 = new Date(Date.now() - 14 * DAY);

  const [baseline] = await db
    .select({
      avgViews: sql<number>`coalesce(avg(${ownPosts.viewCount}), 0)::float`,
      avgLikes: sql<number>`coalesce(avg(${ownPosts.likeCount}), 0)::float`,
      postCount: sql<number>`count(*)::int`,
    })
    .from(ownPosts)
    .where(and(eq(ownPosts.brandId, brandId), gte(ownPosts.postedAt, since14)));

  const latestPosts = await db
    .select({
      content: ownPosts.content,
      postedAt: ownPosts.postedAt,
      views: ownPosts.viewCount,
      likes: ownPosts.likeCount,
      replies: ownPosts.replyCount,
      platform: ownPosts.platform,
    })
    .from(ownPosts)
    .where(eq(ownPosts.brandId, brandId))
    .orderBy(desc(ownPosts.postedAt))
    .limit(5);

  const [bestPost] = await db
    .select({
      content: ownPosts.content,
      views: ownPosts.viewCount,
      likes: ownPosts.likeCount,
    })
    .from(ownPosts)
    .where(and(eq(ownPosts.brandId, brandId), gte(ownPosts.postedAt, since14)))
    .orderBy(desc(sql`${ownPosts.likeCount} + ${ownPosts.retweetCount} * 2 + ${ownPosts.replyCount}`))
    .limit(1);

  const queuedRows = await db
    .select({ content: drafts.content, createdAt: drafts.createdAt, status: drafts.status })
    .from(drafts)
    .where(and(eq(drafts.brandId, brandId), inArray(drafts.status, ['draft', 'review'] as const)))
    .orderBy(desc(drafts.createdAt))
    .limit(5);

  const daysSinceLastPost = latestPosts.length > 0
    ? Math.floor((Date.now() - latestPosts[0].postedAt.getTime()) / DAY)
    : null;

  return {
    brandId,
    brandName,
    baseline14d: baseline ?? { avgViews: 0, avgLikes: 0, postCount: 0 },
    daysSinceLastPost,
    latestPosts,
    bestPost14d: bestPost ?? null,
    queuedDrafts: queuedRows.map(d => ({
      content: d.content,
      ageDays: Math.floor((Date.now() - d.createdAt.getTime()) / DAY),
      status: d.status,
    })),
  };
}

// Shared voice rules for both briefs. The brief reads like a coworker's
// message but obeys the same writing bans as generated posts.
const BRIEF_VOICE = `VOICE RULES (hard):
- Write like a sharp head of content texting their client. Warm, direct, specific.
- Plain language. Short paragraphs. No corporate phrasing, no hype.
- NEVER use em dashes. NEVER ask rhetorical questions (a real question that expects an answer, like "want me to draft it?", is fine — but only ONE, at the very end).
- No "isn't X, it's Y" constructions. No staccato fragment chains.
- Numbers stay exact (impressions, likes, multipliers). Do not round into vagueness.
- If a section has no data, SKIP it silently. Never pad, never invent. If the whole day is quiet, say so in one line and keep the message short.
- Max ~1600 characters. Telegram message, not an essay.`;

function fmtPost(p: { content: string; views: number; likes: number; replies?: number }): string {
  const head = p.content.split('\n')[0].slice(0, 100);
  return `"${head}" → ${p.views} views, ${p.likes} likes${p.replies != null ? `, ${p.replies} replies` : ''}`;
}

export async function buildMorningBrief(userId: string, brandId: string, brandName: string): Promise<BriefResult | null> {
  const snap = await loadSnapshot(brandId, brandName);
  const ideas = (await generateIdeasFromLatestInterview(brandId).catch(() => null)) ?? [];
  const pickedIdeas = ideas.slice(0, 3);

  // Nothing to say at all: no posts ever, no drafts, no ideas.
  if (snap.latestPosts.length === 0 && snap.queuedDrafts.length === 0 && pickedIdeas.length === 0) {
    return null;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lore.app';
  const facts = [
    `Brand: ${brandName}`,
    `14-day baseline: ${Math.round(snap.baseline14d.avgViews)} avg views, ${snap.baseline14d.avgLikes.toFixed(1)} avg likes across ${snap.baseline14d.postCount} posts.`,
    snap.daysSinceLastPost != null
      ? `Days since last post: ${snap.daysSinceLastPost}`
      : 'No posts synced yet.',
    snap.latestPosts.length > 0
      ? `Most recent posts (newest first):\n${snap.latestPosts.map(p => `- [${p.platform}] ${fmtPost(p)} (${Math.floor((Date.now() - p.postedAt.getTime()) / DAY)}d ago)`).join('\n')}`
      : '',
    snap.bestPost14d
      ? `Best post of the last 14 days: ${fmtPost(snap.bestPost14d)}`
      : '',
    snap.queuedDrafts.length > 0
      ? `Drafts sitting on the board:\n${snap.queuedDrafts.map(d => `- (${d.status}, ${d.ageDays}d old) "${d.content.split('\n')[0].slice(0, 80)}"`).join('\n')}`
      : 'No drafts queued.',
    pickedIdeas.length > 0
      ? `Ideas from their latest interview (number them 1..${pickedIdeas.length} in the message; user can reply with a number to get a full draft):\n${pickedIdeas.map((idea, i) => `${i + 1}. ${idea.angle} — hook: ${idea.hook}`).join('\n')}`
      : 'No interview ideas available (do not fabricate ideas).',
  ].filter(Boolean).join('\n\n');

  const prompt = `You write the MORNING BRIEF a head of content sends their client on Telegram.

${BRIEF_VOICE}

STRUCTURE (only sections with data):
1. One-line greeting with the day's single most important thing.
2. Performance: how the latest post did RELATIVE to their own 14-day baseline (e.g. "about 40% below your average" or "2.1x your average"). If you can see a pattern across the recent posts (what the better ones have in common: hook style, format, topic), name it in one sentence. Only claim a pattern the numbers actually support.
3. Draft nudge: if a draft has been sitting 2+ days, nudge once, concretely.
4. Ideas: the numbered ideas, each as "N. angle" + hook on the next line. Tell them to reply with a number to get the full draft.
5. Close with at most one real question or a one-line pointer to the board: ${appUrl}/board

FACTS (the only data you may use):
${facts}

Write the message now. Output ONLY the message text.`;

  const body = await callAI({ model: MODEL_AGENT, prompt, temperature: 0.6, maxTokens: 700 });
  recordCost(userId, 'telegram_brief', { kind: 'morning', brandId }).catch(() => {});
  if (!body || body.length < 40) return null;

  return {
    body: body.slice(0, 3800),
    ideas: pickedIdeas,
    meta: {
      baselineViews: Math.round(snap.baseline14d.avgViews),
      daysSinceLastPost: snap.daysSinceLastPost,
      queuedDrafts: snap.queuedDrafts.length,
      ideas: pickedIdeas.length,
    },
  };
}

export async function buildEveningReport(userId: string, brandId: string, brandName: string): Promise<BriefResult | null> {
  const snap = await loadSnapshot(brandId, brandName);
  const since1 = new Date(Date.now() - DAY);
  const shippedToday = snap.latestPosts.filter(p => p.postedAt >= since1);

  // Quiet day and nothing pulling: skip the evening ping entirely rather than
  // sending filler. (The morning brief already nudges on stale drafts.)
  const base = snap.baseline14d;
  const hasBaseline = base.postCount >= 3 && (base.avgViews >= 30 || base.avgLikes >= 2);
  const standout = hasBaseline && snap.latestPosts.length > 0
    ? snap.latestPosts.find(p => base.avgViews > 0 && p.views / base.avgViews >= 2)
    : null;
  if (shippedToday.length === 0 && !standout) return null;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lore.app';
  const facts = [
    `Brand: ${brandName}`,
    `14-day baseline: ${Math.round(base.avgViews)} avg views, ${base.avgLikes.toFixed(1)} avg likes (${base.postCount} posts).`,
    shippedToday.length > 0
      ? `Shipped in the last 24h:\n${shippedToday.map(p => `- [${p.platform}] ${fmtPost(p)}`).join('\n')}`
      : 'Nothing shipped in the last 24h.',
    standout
      ? `Standout (>=2x baseline views): ${fmtPost(standout)}`
      : '',
    snap.queuedDrafts.length > 0
      ? `Still queued: ${snap.queuedDrafts.length} draft(s), oldest ${Math.max(...snap.queuedDrafts.map(d => d.ageDays))}d.`
      : '',
  ].filter(Boolean).join('\n\n');

  const prompt = `You write the EVENING REPORT a head of content sends their client on Telegram.

${BRIEF_VOICE}

STRUCTURE (only sections with data):
1. One-line wrap of the day.
2. Each post that shipped today: exact numbers, and whether it ran above or below their 14-day baseline (state the rough multiple or percentage). Underperformance gets named honestly with ONE plausible reason grounded in the post itself (hook, format, timing), not a generic excuse.
3. If something is overperforming, say what to do about it tonight (follow-up, reply to commenters).
4. One-line close. At most one real question. Board: ${appUrl}/board

FACTS (the only data you may use):
${facts}

Write the message now. Output ONLY the message text.`;

  const body = await callAI({ model: MODEL_AGENT, prompt, temperature: 0.6, maxTokens: 600 });
  recordCost(userId, 'telegram_brief', { kind: 'evening', brandId }).catch(() => {});
  if (!body || body.length < 40) return null;

  return {
    body: body.slice(0, 3800),
    ideas: [],
    meta: {
      shippedToday: shippedToday.length,
      standout: !!standout,
      baselineViews: Math.round(base.avgViews),
    },
  };
}

// Resolve the user's active brand. Shared by both cron routes and "Try now".
export async function activeBrandFor(userId: string): Promise<{ id: string; name: string } | null> {
  const [brand] = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(and(eq(brands.userId, userId), eq(brands.isActive, true)))
    .orderBy(desc(brands.createdAt))
    .limit(1);
  return brand ?? null;
}

// Persist the numbered ideas so the existing reply-with-number webhook flow keeps working.
export async function saveLastIdeas(
  userId: string,
  type: 'daily' | 'perf',
  ideas: ContentIdea[],
): Promise<void> {
  await db.update(users)
    .set({
      telegramLastIdeas: {
        type,
        sentAt: new Date().toISOString(),
        ideas: ideas.map((p, i) => ({
          index: i + 1,
          content: `${p.angle}\n\nOpening hook: ${p.hook}`,
        })),
      },
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}
