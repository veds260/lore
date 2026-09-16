import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { setActiveBrandCookie } from '@/lib/active-brand';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null) as { brandId?: string } | null;
  if (!body?.brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 });

  // Verify the brand belongs to this user and is active
  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(and(
      eq(brands.id, body.brandId),
      eq(brands.userId, session.user.id),
      eq(brands.isActive, true),
    ))
    .limit(1);

  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  await setActiveBrandCookie(brand.id);
  return NextResponse.json({ ok: true, brandId: brand.id });
}
