import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands, skills } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getActiveBrandId } from '@/lib/active-brand';

const AddSchema = z.object({
  phrase: z.string().min(1).max(120),
  why: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = AddSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const activeBrandId = await getActiveBrandId(session.user.id);
  if (!activeBrandId) return NextResponse.json({ error: 'No brand' }, { status: 404 });
  const brand = { id: activeBrandId };

  const phrase = parsed.data.phrase.trim();
  const why = parsed.data.why?.trim() || `Never use "${phrase}".`;

  const [inserted] = await db.insert(skills).values({
    brandId: brand.id,
    userId: session.user.id,
    scope: 'brand' as const,
    name: `Avoid: ${phrase.slice(0, 60)}`,
    kind: 'avoidance_rule' as const,
    body: why,
    confidence: 1.0,
    source: 'manual',
  }).returning({ id: skills.id });

  return NextResponse.json({ id: inserted.id, phrase, body: why });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const activeBrandId = await getActiveBrandId(session.user.id);
  if (!activeBrandId) return NextResponse.json({ error: 'No brand' }, { status: 404 });
  const brand = { id: activeBrandId };

  // Soft delete by setting status to 'dismissed' so it stops being used in prompts
  await db.update(skills)
    .set({ status: 'dismissed' as const, updatedAt: new Date() })
    .where(and(eq(skills.id, id), eq(skills.brandId, brand.id)));

  return NextResponse.json({ ok: true });
}
