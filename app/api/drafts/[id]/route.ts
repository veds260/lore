import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { drafts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { DraftStatus, Platform, RecommendedImage } from '@/components/board/types';
import { recordDraftSources, type DraftSourceInput } from '@/lib/draft-sources';

function toDbStatus(boardStatus: DraftStatus): 'idea' | 'draft' | 'review' | 'posted' {
  switch (boardStatus) {
    case 'ideas':  return 'idea';
    case 'drafts': return 'draft';
    case 'review': return 'review';
    case 'posted': return 'posted';
    default:       return 'draft';
  }
}

interface NotesPayload {
  platform?: Platform;
  linkedinContent?: string;
  imageUrl?: string | null;
  imageSize?: string | null;
  recommendedImage?: RecommendedImage | null;
}

function parseNotes(notes: string | null): NotesPayload {
  if (!notes) return {};
  try {
    return JSON.parse(notes) as NotesPayload;
  } catch {
    return {};
  }
}

// Sanitize a recommendedImage payload before storing it in notes. Strips
// anything that isn't a known, non-secret field. Returns null to clear it.
function sanitizeRecommendedImage(input: unknown): RecommendedImage | null {
  if (input === null) return null;
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const url = typeof obj.url === 'string' ? obj.url : null;
  if (!url) return null;
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;
  const { id } = await params;

  if (id.startsWith('demo-')) {
    return NextResponse.json({ error: 'Cannot modify demo content' }, { status: 400 });
  }

  // Confirm draft belongs to this user
  const [existing] = await db
    .select({ id: drafts.id, notes: drafts.notes, brandId: drafts.brandId })
    .from(drafts)
    .where(and(eq(drafts.id, id), eq(drafts.userId, userId)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const hasSourceInputs = Object.prototype.hasOwnProperty.call(body, 'sourceInputs');
  const { status, content, linkedinContent, imageUrl, imageSize, recommendedImage, sourceInputs = [] } = body as {
    status?: DraftStatus;
    content?: string;
    linkedinContent?: string;
    imageUrl?: string | null;
    imageSize?: string | null;
    recommendedImage?: RecommendedImage | null;
    sourceInputs?: DraftSourceInput[];
  };

  // Build update payload
  const updateValues: Partial<{
    status: 'idea' | 'draft' | 'review' | 'approved' | 'posted' | 'scored';
    content: string;
    notes: string;
    updatedAt: Date;
  }> = { updatedAt: new Date() };

  if (status !== undefined) {
    updateValues.status = toDbStatus(status);
  }

  if (content !== undefined) {
    updateValues.content = content;
  }

  // Update notes with new linkedinContent / imageUrl / platform if provided
  if (linkedinContent !== undefined || imageUrl !== undefined || imageSize !== undefined || recommendedImage !== undefined) {
    const current = parseNotes(existing.notes);
    const updated: NotesPayload = { ...current };
    if (linkedinContent !== undefined) updated.linkedinContent = linkedinContent;
    if (imageUrl !== undefined) updated.imageUrl = imageUrl;
    if (imageSize !== undefined) updated.imageSize = imageSize;
    if (recommendedImage !== undefined) {
      const cleanRecommended = sanitizeRecommendedImage(recommendedImage);
      if (cleanRecommended) updated.recommendedImage = cleanRecommended;
      else delete updated.recommendedImage;
    }
    updateValues.notes = JSON.stringify(updated);
  }

  await db
    .update(drafts)
    .set(updateValues)
    .where(eq(drafts.id, id));

  if (hasSourceInputs) {
    await recordDraftSources({
      draftId: id,
      userId,
      brandId: existing.brandId,
      inputs: sourceInputs,
      replaceExisting: true,
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;
  const { id } = await params;

  if (id.startsWith('demo-')) {
    return NextResponse.json({ error: 'Cannot modify demo content' }, { status: 400 });
  }

  const deleted = await db
    .delete(drafts)
    .where(and(eq(drafts.id, id), eq(drafts.userId, userId)))
    .returning({ id: drafts.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
