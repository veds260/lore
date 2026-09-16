import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands, skills } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getActiveBrandId } from '@/lib/active-brand';

// Parse the briefMd blob back into named sections (best-effort).
function parseBrief(brief: string | null): Record<string, string> {
  if (!brief) return {};
  const out: Record<string, string> = {};
  const sections = brief.split(/\n\n+/);
  for (const s of sections) {
    const m = s.match(/^([A-Z][^:\n]{2,40}):\s*([\s\S]+)$/);
    if (m) {
      const key = m[1].toLowerCase().replace(/[^a-z]/g, '_').replace(/^_+|_+$/g, '');
      out[key] = m[2].trim();
    }
  }
  return out;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const activeBrandId = await getActiveBrandId(session.user.id);
  if (!activeBrandId) return NextResponse.json({ error: 'No brand' }, { status: 404 });

  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.id, activeBrandId))
    .limit(1);

  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 });

  const brief = parseBrief(brand.briefMd);

  // Active brand-scoped avoidance rules = "banned phrases"
  const bannedRows = await db
    .select({
      id: skills.id,
      name: skills.name,
      body: skills.body,
      source: skills.source,
      createdAt: skills.createdAt,
    })
    .from(skills)
    .where(and(
      eq(skills.brandId, brand.id),
      eq(skills.kind, 'avoidance_rule'),
      eq(skills.status, 'active'),
    ))
    .orderBy(desc(skills.createdAt))
    .limit(50);

  return NextResponse.json({
    id: brand.id,
    name: brand.name,
    handle: brand.handle,
    linkedinHandle: brand.linkedinHandle,
    avatarUrl: brand.avatarUrl,
    niche: brand.niche,
    voiceSummary: brand.voiceSummary,
    contentStyle: brand.contentStyle,
    contentPillars: brand.contentPillars ?? [],
    weeklyFocus: brand.weeklyFocus,
    brief: {
      whatYouDo:    brief.platform ? brief.platform : (brand.briefMd?.split('\n\n')[1] ?? ''),
      audience:     brief.audience_icp ?? brief.audience ?? '',
      positioning:  brief.unique_angle ?? '',
      background:   brief.background ?? '',
      recentWin:    brief.recent_win ?? '',
      strongBelief: brief.core_belief ?? '',
    },
    bannedPhrases: bannedRows.map(r => ({
      id: r.id,
      name: r.name,
      body: r.body,
      source: r.source, // 'manual' | 'system' | 'auto' | 'consolidated'
      isInferred: r.source !== 'manual',
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

const PatchSchema = z.object({
  name:           z.string().min(1).max(120).optional(),
  niche:          z.string().max(200).optional(),
  voiceSummary:   z.string().max(2000).optional(),
  contentStyle:   z.enum(['witty-short', 'deep-value', 'mixed']).optional(),
  contentPillars: z.array(z.string().max(120)).max(8).optional(),
  weeklyFocus:    z.string().max(500).optional(),
  brief:          z.object({
    whatYouDo:    z.string().max(2000).optional(),
    audience:     z.string().max(2000).optional(),
    positioning:  z.string().max(2000).optional(),
    background:   z.string().max(4000).optional(),
    recentWin:    z.string().max(4000).optional(),
    strongBelief: z.string().max(4000).optional(),
  }).optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const activeBrandId = await getActiveBrandId(session.user.id);
  if (!activeBrandId) return NextResponse.json({ error: 'No brand' }, { status: 404 });

  const [brand] = await db
    .select({ id: brands.id, briefMd: brands.briefMd })
    .from(brands)
    .where(eq(brands.id, activeBrandId))
    .limit(1);

  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 });

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined)           update.name = parsed.data.name;
  if (parsed.data.niche !== undefined)          update.niche = parsed.data.niche;
  if (parsed.data.voiceSummary !== undefined)   update.voiceSummary = parsed.data.voiceSummary;
  if (parsed.data.contentStyle !== undefined)   update.contentStyle = parsed.data.contentStyle;
  if (parsed.data.contentPillars !== undefined) update.contentPillars = parsed.data.contentPillars;
  if (parsed.data.weeklyFocus !== undefined)    update.weeklyFocus = parsed.data.weeklyFocus;

  if (parsed.data.brief) {
    const b = parsed.data.brief;
    update.briefMd = [
      b.whatYouDo ? b.whatYouDo : '',
      b.audience ? `Audience (ICP): ${b.audience}` : '',
      b.positioning ? `Unique angle: ${b.positioning}` : '',
      b.background ? `Background: ${b.background}` : '',
      b.recentWin ? `Recent win: ${b.recentWin}` : '',
      b.strongBelief ? `Core belief: ${b.strongBelief}` : '',
    ].filter(Boolean).join('\n\n');
  }

  await db.update(brands).set(update).where(eq(brands.id, brand.id));

  return NextResponse.json({ ok: true });
}
