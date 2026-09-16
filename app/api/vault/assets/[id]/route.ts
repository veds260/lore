import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { vaultAssets, vaultNotes } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { deleteStoredFile } from '@/lib/vault/storage';
import { resolveTenantScope } from '@/lib/vault/workspace';

const SENSITIVITIES = ['safe', 'private', 'client-confidential', 'needs_review'] as const;
type Sensitivity = typeof SENSITIVITIES[number];

const STATUSES = ['processing', 'analyzing', 'ready', 'needs_review', 'failed'] as const;
type Status = typeof STATUSES[number];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const scope = await resolveTenantScope(session.user.id);
  if (!scope) return NextResponse.json({ error: 'No active brand' }, { status: 400 });

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    tags?: string[]; topics?: string[]; usableFor?: string[]; doNotUseFor?: string[];
    sensitivity?: string; visualStyle?: string; captionSummary?: string;
    textInImage?: string; status?: string;
  };

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (Array.isArray(body.tags)) update.tags = body.tags;
  if (Array.isArray(body.topics)) update.topics = body.topics;
  if (Array.isArray(body.usableFor)) update.usableFor = body.usableFor;
  if (Array.isArray(body.doNotUseFor)) update.doNotUseFor = body.doNotUseFor;
  if (body.sensitivity && (SENSITIVITIES as readonly string[]).includes(body.sensitivity)) {
    update.sensitivity = body.sensitivity as Sensitivity;
  }
  if (typeof body.visualStyle === 'string') update.visualStyle = body.visualStyle;
  if (typeof body.captionSummary === 'string') update.captionSummary = body.captionSummary;
  if (typeof body.textInImage === 'string') update.textInImage = body.textInImage;
  if (body.status && (STATUSES as readonly string[]).includes(body.status)) {
    update.status = body.status as Status;
  }

  await db.update(vaultAssets)
    .set(update)
    .where(and(
      eq(vaultAssets.id, id),
      eq(vaultAssets.userId, scope.userId),
      eq(vaultAssets.brandId, scope.brandId),
    ));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const scope = await resolveTenantScope(session.user.id);
  if (!scope) return NextResponse.json({ error: 'No active brand' }, { status: 400 });

  const { id } = await params;
  const [asset] = await db.select().from(vaultAssets)
    .where(and(eq(vaultAssets.id, id), eq(vaultAssets.userId, scope.userId), eq(vaultAssets.brandId, scope.brandId)))
    .limit(1);
  if (!asset) return NextResponse.json({ ok: false }, { status: 404 });

  // Remove the visual note and the file from disk, then the row itself.
  if (asset.noteId) {
    await db.delete(vaultNotes).where(and(
      eq(vaultNotes.id, asset.noteId),
      eq(vaultNotes.userId, scope.userId),
      eq(vaultNotes.brandId, scope.brandId),
    )).catch(() => {});
  }
  await deleteStoredFile(asset.storageKey).catch(() => {});
  await db.delete(vaultAssets).where(and(
    eq(vaultAssets.id, asset.id),
    eq(vaultAssets.userId, scope.userId),
    eq(vaultAssets.brandId, scope.brandId),
  ));

  return NextResponse.json({ ok: true });
}
