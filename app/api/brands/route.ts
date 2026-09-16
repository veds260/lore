import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands, skills, users } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { syncBrandTweets, quickSyncBrandTweets } from '@/lib/sync-brand-tweets';
import { setActiveBrandCookie } from '@/lib/active-brand';
import { PLAN_CONFIG } from '@/lib/plans';
import { enrichBrand } from '@/lib/enrich-brand';
import { recordCost } from '@/lib/credits';
import { z } from 'zod';

const CreateBrandSchema = z.object({
  name:                z.string().min(1).max(120),
  handle:              z.string().max(50).optional(),
  twitterHandle:       z.string().max(50).optional(),
  linkedinHandle:      z.string().max(100).optional(),
  whatYouDo:           z.string().min(1).max(2000),
  platform:            z.enum(['twitter', 'linkedin', 'both']),
  vibe:                z.enum(['direct', 'story', 'educator', '']),
  contentStyle:        z.enum(['witty-short', 'deep-value', 'mixed']).default('mixed'),
  recentWin:           z.string().min(1).max(4000),
  strongBelief:        z.string().min(1).max(4000),
  inspirationHandles:  z.array(z.string().max(50)).max(5).default([]),
  // Richer context from AI profile parse and onboarding
  expertise:           z.array(z.string()).optional(),
  audience:            z.string().max(2000).optional(),
  positioning:         z.string().max(2000).optional(),
  credibilityMarkers:  z.array(z.string()).optional(),
  writingTone:         z.array(z.string()).optional(),
  contentThemes:       z.array(z.string()).optional(),
  backgroundSummary:   z.string().max(4000).optional(),
  // When true, await a fast profile + 10-tweet sync before responding.
  // Used by interview-first onboarding so Q1-Q9 can reference real tweets.
  awaitQuickProfile:   z.boolean().optional(),
});

const VIBE_VOICE: Record<string, string> = {
  direct:   'Direct and punchy. Leads with a specific claim or number. Short sentences. Says what others dance around.',
  story:    'Story-first. Opens with a concrete scene or moment. Lesson comes at the end, not the front.',
  educator: 'Educational and structured. Uses numbered lists or clear frameworks. Leads with the lesson.',
};

const GLOBAL_RULES = [
  { name: 'No em dashes',              body: 'Never use em dashes (--). Use a comma, period, or restructure the sentence.' },
  { name: 'No rhetorical questions',   body: 'Do not open with a rhetorical question ("The truth?" / "Want to know why?"). Open with a statement.' },
  { name: 'No generic motivational phrases', body: 'Avoid phrases like "your network is your net worth" or any sentence that sounds like a LinkedIn poster.' },
  { name: 'One idea per post',         body: 'Each post explores exactly one insight. If you find yourself pivoting mid-post, that is a second post.' },
];

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => null);
  const parsed = CreateBrandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const {
    name, handle, twitterHandle, linkedinHandle,
    whatYouDo, platform, vibe, contentStyle,
    recentWin, strongBelief, inspirationHandles,
    expertise, audience, positioning, credibilityMarkers, writingTone, contentThemes, backgroundSummary,
    awaitQuickProfile,
  } = parsed.data;

  const resolvedHandle = twitterHandle || handle || null;

  // Build the style guide from everything we know
  const voiceParts: string[] = [];

  voiceParts.push(`## Who this is\n${whatYouDo}`);

  if (audience) {
    voiceParts.push(`## Target audience (ICP)\n${audience}`);
  }

  if (positioning) {
    voiceParts.push(`## Unique angle / positioning\n${positioning}`);
  }

  if (backgroundSummary) {
    voiceParts.push(`## Background\n${backgroundSummary}`);
  }

  if (credibilityMarkers?.length) {
    voiceParts.push(`## Credibility\n${credibilityMarkers.map(c => `- ${c}`).join('\n')}`);
  }

  if (expertise?.length) {
    voiceParts.push(`## Areas of expertise\n${expertise.map(e => `- ${e}`).join('\n')}`);
  }

  if (contentThemes?.length) {
    voiceParts.push(`## Content themes\nRecurring angles and threads to draw from:\n${contentThemes.map(t => `- ${t}`).join('\n')}`);
  }

  if (vibe && VIBE_VOICE[vibe]) {
    voiceParts.push(`## Writing style\n${VIBE_VOICE[vibe]}`);
  }

  if (writingTone?.length) {
    voiceParts.push(`## Tone\n${writingTone.join(', ')}`);
  }

  voiceParts.push(`## Voice samples (founder-supplied)\n### Recent win\n${recentWin}\n\n### Core belief\n${strongBelief}`);

  if (inspirationHandles.length > 0) {
    voiceParts.push(`## Style inspiration\nStudy the phrasing, sentence rhythm, and structure of these accounts:\n${inspirationHandles.map(h => `- @${h}`).join('\n')}`);
  }

  const styleGuideMd = voiceParts.join('\n\n');
  const voiceSummary = vibe ? VIBE_VOICE[vibe] : `Writes about: ${whatYouDo.slice(0, 120)}`;

  const niche = expertise?.slice(0, 3).join(', ') ?? '';

  // Seed `selectedCategories` from vibe so it's never empty when the user opens Settings.
  // The async enrichment below may refine this to taxonomy-matched picks via AI.
  const VIBE_CATEGORY_DEFAULTS: Record<string, string[]> = {
    direct:   ['contrarian-take', 'hot-take', 'thought-leadership'],
    story:    ['storytelling', 'authority', 'build-in-public'],
    educator: ['educational', 'authority', 'thought-leadership'],
  };
  const seededCategories: string[] = VIBE_CATEGORY_DEFAULTS[vibe] ?? ['build-in-public', 'educational', 'thought-leadership'];

  // Multi-brand: only deactivate existing brands if user is at slot limit (single-brand plans)
  // Agency users (5 slots) can have multiple active brands.
  const [user] = await db.select({ planTier: users.planTier }).from(users).where(eq(users.id, userId)).limit(1);
  const planTier = user?.planTier ?? 'free';
  const clientSlots = PLAN_CONFIG[planTier]?.clientSlots ?? 1;

  const existingActive = await db
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.userId, userId), eq(brands.isActive, true)));

  if (existingActive.length >= clientSlots) {
    // Single-brand plan or at limit, replace the oldest by deactivating all
    await db.update(brands).set({ isActive: false }).where(and(eq(brands.userId, userId), eq(brands.isActive, true)));
  }

  const [brand] = await db.insert(brands).values({
    userId,
    name,
    handle: resolvedHandle,
    linkedinHandle: linkedinHandle || null,
    niche,
    voiceSummary,
    styleGuideMd,
    briefMd: [
      `Platform: ${platform}`,
      whatYouDo,
      audience ? `Audience (ICP): ${audience}` : '',
      positioning ? `Unique angle: ${positioning}` : '',
      backgroundSummary ? `Background: ${backgroundSummary}` : '',
      recentWin ? `Recent win: ${recentWin}` : '',
      strongBelief ? `Core belief: ${strongBelief}` : '',
    ].filter(Boolean).join('\n\n'),
    contentPillars: contentThemes?.slice(0, 5) ?? [],
    contentStyle,
    selectedCategories: seededCategories,
  }).returning();

  await db.insert(skills).values(
    GLOBAL_RULES.map(rule => ({
      brandId: brand.id,
      userId,
      scope: 'global' as const,
      name: rule.name,
      kind: 'avoidance_rule' as const,
      body: rule.body,
      confidence: 1.0,
      source: 'system',
    })),
  );

  // Set the new brand as the active one (so all subsequent queries pick it up)
  await setActiveBrandCookie(brand.id);

  // Interview-first onboarding: await a fast profile + 10-tweet sync so Q1-Q9
  // can reference real tweets. ~2-3s. Fail-soft if the API hiccups.
  if (awaitQuickProfile && resolvedHandle) {
    try {
      await quickSyncBrandTweets(brand.id, resolvedHandle);
      // Telemetry: TwitterAPI.io profile + 10 tweets cost
      recordCost(userId, 'brand_profile_sync', { brandId: brand.id, handle: resolvedHandle }).catch(() => {});
    } catch (err) {
      console.error(`[quickSyncBrandTweets] Failed for brand ${brand.id}:`, err instanceof Error ? err.message : err);
    }
  }

  // Fire-and-forget: backfill 6 months of their own tweets so future generation
  // sessions are fully aware of what they've published. Once that lands, seed a voice
  // document from those real tweets so the brand's first drafts already sound on-voice
  // (instead of generic) before any corrections have accumulated.
  if (resolvedHandle) {
    syncBrandTweets(brand.id, resolvedHandle)
      .then(() =>
        import('@/lib/bootstrap-voice').then(({ bootstrapVoiceFromPosts }) =>
          bootstrapVoiceFromPosts(brand.id),
        ),
      )
      .catch(err =>
        console.error(`[syncBrandTweets] Failed for brand ${brand.id}:`, err instanceof Error ? err.message : err)
      );
  }

  // Fire-and-forget: AI enrichment. The manual-form path leaves expertise / credibility
  // / writing tone / content themes empty. This call extracts them from the freeform
  // answers and refines `selectedCategories` from the fixed taxonomy. Safe to run on
  // upload-path brands too, it only writes append-only fields that are still empty.
  const isManualPath = !expertise?.length && !credibilityMarkers?.length && !writingTone?.length && !contentThemes?.length;
  if (isManualPath) {
    enrichBrand({
      brandId: brand.id,
      userId,
      name,
      whatYouDo,
      audience,
      positioning,
      recentWin,
      strongBelief,
      vibe: vibe || undefined,
      inspirationHandles,
    }).catch(err =>
      console.error(`[enrichBrand] Failed for brand ${brand.id}:`, err instanceof Error ? err.message : err)
    );
  }

  return NextResponse.json({ brand }, { status: 201 });
}
