import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { vaultNotes } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { resolveTenantScope } from '@/lib/vault/workspace';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const scope = await resolveTenantScope(session.user.id);
  if (!scope) return NextResponse.json({ error: 'No active brand' }, { status: 400 });

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    title?: string; tags?: string[]; topics?: string[];
    summary?: string; body?: string; status?: 'active' | 'archived' | 'needs_review';
  };

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === 'string') update.title = body.title.trim();
  if (Array.isArray(body.tags)) update.tags = body.tags;
  if (Array.isArray(body.topics)) update.topics = body.topics;
  if (typeof body.summary === 'string') update.summary = body.summary;
  if (typeof body.body === 'string') update.body = body.body;
  if (body.status === 'active' || body.status === 'archived' || body.status === 'needs_review') {
    update.status = body.status;
  }

  await db.update(vaultNotes)
    .set(update)
    .where(and(
      eq(vaultNotes.id, id),
      eq(vaultNotes.scope, 'tenant'),
      eq(vaultNotes.userId, scope.userId),
      eq(vaultNotes.brandId, scope.brandId),
    ));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const scope = await resolveTenantScope(session.user.id);
  if (!scope) return NextResponse.json({ error: 'No active brand' }, { status: 400 });

  const { id } = await params;
  const res = await db.delete(vaultNotes)
    .where(and(
      eq(vaultNotes.id, id),
      eq(vaultNotes.scope, 'tenant'),
      eq(vaultNotes.userId, scope.userId),
      eq(vaultNotes.brandId, scope.brandId),
    ))
    .returning({ id: vaultNotes.id });
  return NextResponse.json({ ok: res.length > 0 });
}
