import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands, scheduledPosts } from '@/lib/db/schema';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db
    .select()
    .from(scheduledPosts)
    .where(eq(scheduledPosts.userId, session.user.id))
    .orderBy(desc(scheduledPosts.scheduledFor))
    .limit(50);

  return NextResponse.json({ scheduledPosts: rows });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const content = (body?.content as string | undefined)?.trim();
  const scheduledFor = body?.scheduledFor ? new Date(body.scheduledFor) : null;
  const brandId = body?.brandId as string | undefined;

  if (!content || !scheduledFor || Number.isNaN(scheduledFor.getTime())) {
    return NextResponse.json({ error: 'content and scheduledFor are required' }, { status: 400 });
  }
  if (scheduledFor.getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: 'scheduledFor is in the past' }, { status: 400 });
  }
  if (content.length > 4000) {
    return NextResponse.json({ error: 'content too long' }, { status: 400 });
  }

  // Publishing goes through the brand's official X connection.
  const brandWhere = brandId
    ? and(eq(brands.id, brandId), eq(brands.userId, session.user.id))
    : and(eq(brands.userId, session.user.id), eq(brands.isActive, true));
  const [brand] = await db
    .select({ id: brands.id, xAccessToken: brands.xAccessToken })
    .from(brands)
    .where(brandWhere)
    .orderBy(desc(brands.createdAt))
    .limit(1);

  if (!brand) return NextResponse.json({ error: 'No brand found' }, { status: 400 });
  if (!brand.xAccessToken) {
    return NextResponse.json({ error: 'Connect X in settings before scheduling posts' }, { status: 409 });
  }

  const [row] = await db.insert(scheduledPosts).values({
    userId: session.user.id,
    brandId: brand.id,
    platform: 'twitter',
    content,
    scheduledFor,
    status: 'pending',
  }).returning();

  return NextResponse.json({ scheduledPost: row });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const [row] = await db.update(scheduledPosts)
    .set({ status: 'cancelled' })
    .where(and(
      eq(scheduledPosts.id, id),
      eq(scheduledPosts.userId, session.user.id),
      eq(scheduledPosts.status, 'pending'),
    ))
    .returning();

  if (!row) return NextResponse.json({ error: 'Not found or not cancellable' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
