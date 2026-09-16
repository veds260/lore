import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const weeklyFocus = typeof body?.weeklyFocus === 'string' ? body.weeklyFocus.trim() : null;

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.userId, session.user.id))
    .limit(1);

  if (!brand) return NextResponse.json({ error: 'No brand found' }, { status: 404 });

  await db
    .update(brands)
    .set({ weeklyFocus: weeklyFocus || null, updatedAt: new Date() })
    .where(eq(brands.id, brand.id));

  return NextResponse.json({ ok: true });
}
