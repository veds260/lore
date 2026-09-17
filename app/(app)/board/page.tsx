import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { drafts, ownPosts, skills } from '@/lib/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { BoardClient } from '@/components/board/board-client';
import { getActiveBrandId } from '@/lib/active-brand';
import type { Draft, DraftStatus, Platform, RecommendedImage } from '@/components/board/types';

function toBoardStatus(dbStatus: string): DraftStatus {
  switch (dbStatus) {
    case 'idea':      return 'ideas';
    case 'draft':     return 'drafts';
    case 'review':
    case 'approved':
    case 'scheduled': return 'review';
    case 'posted':
    case 'scored':    return 'posted';
    default:          return 'drafts';
  }
}

interface NotesPayload {
  platform?: Platform;
  linkedinContent?: string;
  imageUrl?: string;
  recommendedImage?: RecommendedImage;
}

function parseNotes(notes: string | null): NotesPayload {
  if (!notes) return {};
  try {
    return JSON.parse(notes) as NotesPayload;
  } catch {
    return {};
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DEMO_DRAFTS: Draft[] = [
  {
    id: 'demo-1',
    platform: 'both',
    status: 'ideas',
    isDemo: true,
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    content:
      'Most people optimize for follower count.\nThe ones actually making money optimize for follower trust.\n\nThese are not the same thing, and conflating them is why so many large accounts earn less than you would expect.',
    linkedinContent:
      'I used to think follower count was the metric that mattered.\n\nThen I started looking at the revenue side of accounts I worked with.\n\nA founder with 12k followers was closing consulting calls weekly. Another with 90k was barely getting DMs. Same niche. Completely different results.\n\nThe difference was trust density. The smaller account posted specific, opinionated takes from direct experience. The larger one posted content designed to go viral: broad enough to appeal to everyone, which meant it resonated with no one deeply enough to buy.\n\nFollower count measures reach. Trust measures influence. They are not correlated the way most people assume.',
  },
  {
    id: 'demo-2',
    platform: 'both',
    status: 'ideas',
    isDemo: true,
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    content:
      'I tracked every post I published for 90 days.\n\nThe top-performing ones had one thing in common: they started with a specific number, not an opinion.',
    linkedinContent:
      'For 90 days straight, I logged every post I published: the hook format, the topic, the engagement, the replies.\n\nThe posts that consistently outperformed everything else had one structural thing in common: they opened with a specific number.',
  },
  {
    id: 'demo-3',
    platform: 'both',
    status: 'drafts',
    isDemo: true,
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    content:
      "I posted for 6 months without a single viral post and still grew every month.\n\nHere's the boring system that actually worked:\n\n1. 3 posts per week, same time slots\n2. Every post answered one question from the previous week's comments\n3. No \"content pillars\": just topics the audience asked about",
    linkedinContent:
      "Six months ago I had no posting history at all, and the account has grown every month since.\n\nNo viral moment, no influencer shoutout, and no posting every day.",
  },
  {
    id: 'demo-4',
    platform: 'both',
    status: 'review',
    score: 7.4,
    scoreBreakdown: { hook: 8, clarity: 8, originality: 7, cta: 6, format: 8 },
    isDemo: true,
    createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    content:
      "Something I noticed editing my own drafts:\n\nThe first version usually sounds more like me than the polished one.\n\nEditing should cut the extra words and leave the voice alone.",
    linkedinContent:
      "Three years ago I thought good writing meant sounding smarter than I talk.\n\nI had that backwards for a long time.",
  },
  {
    id: 'demo-5',
    platform: 'both',
    status: 'review',
    score: 7.8,
    scoreBreakdown: { hook: 8, clarity: 8, originality: 7, cta: 8, format: 8 },
    isDemo: true,
    createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
    content:
      '3 things that separate a personal brand that compounds from one that plateaus:\n\n1. They publish what they actually think, not what they think people want to hear\n2. They respond to every comment for the first 30 minutes after posting\n3. They treat each post as a test, not a performance',
    linkedinContent:
      "I have watched dozens of personal brands stall at the same point, somewhere between 5k and 20k followers, engagement drops off, growth flatlines, and the creator starts wondering if the algorithm changed.",
  },
  {
    id: 'demo-6',
    platform: 'both',
    status: 'posted',
    score: 9.1,
    scoreBreakdown: { hook: 10, clarity: 9, originality: 9, cta: 8, format: 9 },
    isDemo: true,
    createdAt: new Date(Date.now() - 86400000 * 14).toISOString(),
    content:
      "87% of founders who hire a ghostwriter quit within 3 months.\n\nNot because the writing was bad.\n\nBecause nobody sat them down in week one and explained that the point of consistent posting is not to go viral. It is to build a body of proof that you know what you're talking about.",
    linkedinContent:
      "Most people who start posting consistently stop within 90 days, usually right before it starts working.",
  },
];

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ firstVisit?: string }>;
}) {
  const session = await auth();
  const { firstVisit } = await searchParams;

  let realDrafts: Draft[] = [];
  const stats = { postsRead: 0, rulesLearned: 0 };

  if (session?.user?.id) {
    const brandId = await getActiveBrandId(session.user.id);
    const brand = brandId ? { id: brandId } : null;

    if (brand) {
      const [read] = await db.select({ n: sql<number>`count(*)::int` }).from(ownPosts).where(eq(ownPosts.brandId, brand.id));
      const [learned] = await db.select({ n: sql<number>`count(*)::int` }).from(skills).where(and(eq(skills.brandId, brand.id), eq(skills.status, 'active')));
      stats.postsRead = read?.n ?? 0;
      stats.rulesLearned = learned?.n ?? 0;

      const rows = await db
        .select({
          id: drafts.id,
          content: drafts.content,
          status: drafts.status,
          qualityScore: drafts.qualityScore,
          hookScore: drafts.hookScore,
          substanceScore: drafts.substanceScore,
          authenticityScore: drafts.authenticityScore,
          formattingScore: drafts.formattingScore,
          notes: drafts.notes,
          createdAt: drafts.createdAt,
        })
        .from(drafts)
        .where(eq(drafts.brandId, brand.id))
        .orderBy(desc(drafts.createdAt));

      realDrafts = rows.map(row => {
        const { platform, linkedinContent, imageUrl, recommendedImage } = parseNotes(row.notes);
        const score = row.qualityScore ?? undefined;
        const hasBreakdown =
          row.hookScore != null &&
          row.substanceScore != null &&
          row.authenticityScore != null &&
          row.formattingScore != null;

        return {
          id: row.id,
          content: row.content,
          linkedinContent,
          imageUrl,
          recommendedImage,
          platform: platform ?? 'both',
          status: toBoardStatus(row.status),
          score,
          scoreBreakdown: hasBreakdown
            ? {
                hook: row.hookScore!,
                clarity: row.substanceScore!,
                originality: row.authenticityScore!,
                cta: row.formattingScore!,
                format: row.formattingScore!,
              }
            : undefined,
          createdAt: row.createdAt.toISOString(),
        };
      });
    }
  }

  const isFirstVisit = firstVisit === 'true' && realDrafts.length === 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden">
        <BoardClient initialDrafts={realDrafts} firstVisit={isFirstVisit} stats={stats} />
      </div>
    </div>
  );
}
