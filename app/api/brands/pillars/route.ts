import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const VALID_CATEGORIES = [
  'build-in-public', 'educational', 'storytelling', 'case-study',
  'contrarian-take', 'hot-take', 'authority', 'thought-leadership',
  'thesis-building',
] as const;

const UpdatePillarsSchema = z.object({
  selectedCategories: z.array(z.enum(VALID_CATEGORIES)).max(5),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = UpdatePillarsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.userId, session.user.id))
    .limit(1);

  if (!brand) return NextResponse.json({ error: 'No brand found' }, { status: 404 });

  await db
    .update(brands)
    .set({ selectedCategories: parsed.data.selectedCategories, updatedAt: new Date() })
    .where(eq(brands.id, brand.id));

  return NextResponse.json({ ok: true });
}
