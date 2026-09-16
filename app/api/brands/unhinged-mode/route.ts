import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getActiveBrandId } from '@/lib/active-brand';
import { z } from 'zod';

const Schema = z.object({
  allowUnhingedMode: z.boolean(),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const brandId = await getActiveBrandId(session.user.id);
  if (!brandId) return NextResponse.json({ error: 'No active brand' }, { status: 404 });

  await db
    .update(brands)
    .set({ allowUnhingedMode: parsed.data.allowUnhingedMode, updatedAt: new Date() })
    .where(and(eq(brands.id, brandId), eq(brands.userId, session.user.id)));

  return NextResponse.json({ ok: true, allowUnhingedMode: parsed.data.allowUnhingedMode });
}
