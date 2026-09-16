import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { skills } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { status } = await req.json().catch(() => ({}));

  if (status !== 'active' && status !== 'dismissed') {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  await db
    .update(skills)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(skills.id, id), eq(skills.userId, session.user.id)));

  return NextResponse.json({ ok: true });
}
