import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { visualInspirations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

function isAdmin(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return adminEmail.split(',').map(e => e.trim().toLowerCase()).includes(email.toLowerCase());
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const update: Partial<{ name: string; stylePrompt: string; category: string; sortOrder: number; isActive: boolean }> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.stylePrompt !== undefined) update.stylePrompt = body.stylePrompt;
  if (body.category !== undefined) update.category = body.category;
  if (body.sortOrder !== undefined) update.sortOrder = body.sortOrder;
  if (body.isActive !== undefined) update.isActive = body.isActive;

  const [row] = await db
    .update(visualInspirations)
    .set(update)
    .where(eq(visualInspirations.id, id))
    .returning();

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const deleted = await db
    .delete(visualInspirations)
    .where(eq(visualInspirations.id, id))
    .returning({ id: visualInspirations.id });

  if (deleted.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
