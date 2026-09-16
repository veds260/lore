import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands, drafts, postPatterns } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { getActiveBrandId } from '@/lib/active-brand';
import type { DraftStatus, Platform, RecommendedImage } from '@/components/board/types';
import { recordDraftSources, type DraftSourceInput } from '@/lib/draft-sources';

// Map DB status enum values to board status values
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

// Map board status values to DB enum values
function toDbStatus(boardStatus: DraftStatus): 'idea' | 'draft' | 'review' | 'posted' {
  switch (boardStatus) {
    case 'ideas':  return 'idea';
    case 'drafts': return 'draft';
    case 'review': return 'review';
    case 'posted': return 'posted';
    default:       return 'draft';
  }
}

// We store linkedinContent, platform, and imageUrl in the notes JSON field
interface NotesPayload {
  platform?: Platform;
  linkedinContent?: string;
  imageUrl?: string;
  recommendedImage?: RecommendedImage;
}

// Sanitize a recommendedImage payload before storing it in notes. Strips
// anything that isn't a known, non-secret field so a crafted request can't
// stash arbitrary data in the JSON blob.
function sanitizeRecommendedImage(input: unknown): RecommendedImage | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  const url = typeof obj.url === 'string' ? obj.url : null;
  if (!url) return undefined;
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 500) : null);
  return {
    id: str(obj.id),
    url: url.slice(0, 2000),
    filename: str(obj.filename),
    caption: str(obj.caption),
    reason: str(obj.reason),
    source: obj.source === 'vault' ? 'vault' : undefined,
  };
}

function parseNotes(notes: string | null): NotesPayload {
  if (!notes) return {};
  try {
    return JSON.parse(notes) as NotesPayload;
  } catch {
    return {};
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;

  const brandId = await getActiveBrandId(userId);
  if (!brandId) return NextResponse.json([]);
  const brand = { id: brandId };

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

  const result = rows.map(row => {
    const notes = parseNotes(row.notes);
    const { platform, linkedinContent } = notes;

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
      imageUrl: notes.imageUrl,
      recommendedImage: notes.recommendedImage,
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

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;

  const body = await req.json().catch(() => null);
  if (!body?.content?.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  const {
    content,
    linkedinContent,
    imageUrl,
    recommendedImage,
    platform = 'both',
    status = 'drafts',
    brandId,
    contentCategory,
    templateId,
    sourceInputs = [],
  } = body as {
    content: string;
    linkedinContent?: string;
    imageUrl?: string;
    recommendedImage?: RecommendedImage;
    platform?: Platform;
    status?: DraftStatus;
    brandId?: string;
    contentCategory?: string;
    templateId?: string;
    sourceInputs?: DraftSourceInput[];
  };

  let targetBrandId: string | undefined = brandId;
  if (!targetBrandId) {
    const activeId = await getActiveBrandId(userId);
    targetBrandId = activeId ?? undefined;
  }

  if (!targetBrandId) {
    return NextResponse.json(
      { error: 'No brand found. Complete onboarding first.' },
      { status: 400 },
    );
  }

  const [ownedBrand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.id, targetBrandId), eq(brands.userId, userId)))
    .limit(1);
  if (!ownedBrand) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }

  const notesPayload: NotesPayload = { platform };
  if (linkedinContent) notesPayload.linkedinContent = linkedinContent;
  if (imageUrl) notesPayload.imageUrl = imageUrl;
  const cleanRecommended = sanitizeRecommendedImage(recommendedImage);
  if (cleanRecommended) notesPayload.recommendedImage = cleanRecommended;

  // Resolve contentCategory: explicit > lookup from template
  let resolvedCategory = contentCategory ?? null;
  if (!resolvedCategory && templateId) {
    const [pattern] = await db
      .select({ contentCategory: postPatterns.contentCategory })
      .from(postPatterns)
      .where(eq(postPatterns.id, templateId))
      .limit(1);
    resolvedCategory = pattern?.contentCategory ?? null;
  }

  const [inserted] = await db
    .insert(drafts)
    .values({
      userId,
      brandId: targetBrandId,
      content: content.trim(),
      status: toDbStatus(status),
      contentCategory: resolvedCategory,
      sourceTemplateId: templateId ?? null,
      notes: JSON.stringify(notesPayload),
    })
    .returning();

  if (sourceInputs.length > 0) {
    await recordDraftSources({
      draftId: inserted.id,
      userId,
      brandId: targetBrandId,
      inputs: sourceInputs,
    }).catch(() => null);
  }

  // Fire-and-forget quality scoring (skip ideas, not worth scoring half-baked content)
  if (toDbStatus(status) !== 'idea') {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? '';
    if (appUrl) {
      fetch(`${appUrl}/api/cron/score-drafts`, {
        method: 'POST',
        headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
      }).catch(() => {});
    }
  }

  return NextResponse.json(
    {
      id: inserted.id,
      content: inserted.content,
      linkedinContent,
      imageUrl: imageUrl ?? null,
      recommendedImage: cleanRecommended ?? null,
      platform,
      status,
      createdAt: inserted.createdAt.toISOString(),
    },
    { status: 201 },
  );
}
