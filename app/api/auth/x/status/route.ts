import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands } from '@/lib/db/schema';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [brand] = await db
    .select({ xUsername: brands.xUsername, xAccessToken: brands.xAccessToken })
    .from(brands)
    .where(and(eq(brands.userId, session.user.id), eq(brands.isActive, true)))
    .orderBy(desc(brands.createdAt))
    .limit(1);

  return NextResponse.json({
    connected: !!brand?.xAccessToken,
    username: brand?.xUsername ?? null,
  });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.userId, session.user.id), eq(brands.isActive, true)))
    .orderBy(desc(brands.createdAt))
    .limit(1);
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 400 });

  await db.update(brands)
    .set({
      xUserId: null,
      xUsername: null,
      xAccessToken: null,
      xRefreshToken: null,
      xTokenExpiresAt: null,
      xScope: null,
      updatedAt: new Date(),
    })
    .where(eq(brands.id, brand.id));

  return NextResponse.json({ ok: true });
}
