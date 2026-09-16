import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { postPatterns } from '@/lib/db/schema';
import { eq, desc, count, sql, ilike, or, and } from 'drizzle-orm';

function isAdmin(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return adminEmail.split(",").map(e => e.trim().toLowerCase()).includes(email.toLowerCase());
}

// GET /api/admin/patterns?page=1&q=search
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const q = url.searchParams.get('q') ?? '';
  const category = url.searchParams.get('category') ?? '';
  const PAGE_SIZE = 20;
  const offset = (page - 1) * PAGE_SIZE;

  const showInactive = url.searchParams.get('inactive') === '1';

  const whereCondition = and(
    showInactive ? undefined : eq(postPatterns.isActive, true),
    q
      ? or(
          ilike(postPatterns.name, `%${q}%`),
          ilike(postPatterns.hookType, `%${q}%`),
          ilike(postPatterns.formatType, `%${q}%`),
          ilike(postPatterns.description, `%${q}%`),
        )
      : undefined,
    category ? eq(postPatterns.contentCategory, category) : undefined,
  );

  const [{ total }] = await db
    .select({ total: count() })
    .from(postPatterns)
    .where(whereCondition);

  const rows = await db
    .select({
      id: postPatterns.id,
      name: postPatterns.name,
      description: postPatterns.description,
      template: postPatterns.template,
      example: postPatterns.example,
      hookType: postPatterns.hookType,
      formatType: postPatterns.formatType,
      bodyStructure: postPatterns.bodyStructure,
      closerType: postPatterns.closerType,
      engagementTarget: postPatterns.engagementTarget,
      coreInsight: postPatterns.coreInsight,
      viralMechanic: postPatterns.viralMechanic,
      emotionTrigger: postPatterns.emotionTrigger,
      postType: postPatterns.postType,
      contentCategory: postPatterns.contentCategory,
      reusableFor: postPatterns.reusableFor,
      tweetUrl: postPatterns.tweetUrl,
      isActive: postPatterns.isActive,
      isQrt: postPatterns.isQrt,
      createdAt: postPatterns.createdAt,
    })
    .from(postPatterns)
    .where(whereCondition)
    .orderBy(desc(postPatterns.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  const byHook = await db
    .select({ hookType: postPatterns.hookType, count: count() })
    .from(postPatterns)
    .groupBy(postPatterns.hookType)
    .orderBy(sql`count(*) DESC`)
    .limit(10);

  return NextResponse.json({
    total,
    page,
    pageSize: PAGE_SIZE,
    patterns: rows,
    byHook,
  });
}

// POST /api/admin/patterns: create a new pattern
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const name = (body.name as string)?.trim();
  const template = (body.template as string)?.trim();
  if (!name || !template) {
    return NextResponse.json({ error: 'name and template are required' }, { status: 400 });
  }

  const [row] = await db.insert(postPatterns).values({
    name,
    template,
    description: (body.description as string) ?? null,
    example: (body.example as string) ?? null,
    hookType: (body.hookType as string) ?? null,
    formatType: (body.formatType as string) ?? null,
    bodyStructure: (body.bodyStructure as string) ?? null,
    closerType: (body.closerType as string) ?? null,
    engagementTarget: (body.engagementTarget as string) ?? null,
    coreInsight: (body.coreInsight as string) ?? null,
    viralMechanic: (body.viralMechanic as string) ?? null,
    emotionTrigger: (body.emotionTrigger as string) ?? null,
    reusableFor: Array.isArray(body.reusableFor) ? body.reusableFor as string[] : [],
    postType: (body.postType as string) ?? 'tweet',
    contentCategory: (body.contentCategory as string) ?? null,
    tweetUrl: (body.tweetUrl as string) ?? null,
    isActive: true,
  }).returning({ id: postPatterns.id });

  return NextResponse.json({ id: row.id }, { status: 201 });
}

// PATCH /api/admin/patterns: toggle active state OR full-field update
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const { id } = body;
  if (!id || typeof id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Full update when name or template is present in the payload
  if (body.name !== undefined || body.template !== undefined) {
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = (body.name as string).trim();
    if (body.template !== undefined) updates.template = (body.template as string).trim();
    if (body.description !== undefined) updates.description = (body.description as string) || null;
    if (body.example !== undefined) updates.example = (body.example as string) || null;
    if (body.hookType !== undefined) updates.hookType = (body.hookType as string) || null;
    if (body.formatType !== undefined) updates.formatType = (body.formatType as string) || null;
    if (body.bodyStructure !== undefined) updates.bodyStructure = (body.bodyStructure as string) || null;
    if (body.closerType !== undefined) updates.closerType = (body.closerType as string) || null;
    if (body.engagementTarget !== undefined) updates.engagementTarget = (body.engagementTarget as string) || null;
    if (body.coreInsight !== undefined) updates.coreInsight = (body.coreInsight as string) || null;
    if (body.viralMechanic !== undefined) updates.viralMechanic = (body.viralMechanic as string) || null;
    if (body.emotionTrigger !== undefined) updates.emotionTrigger = (body.emotionTrigger as string) || null;
    if (body.postType !== undefined) updates.postType = (body.postType as string) || 'tweet';
    if (body.contentCategory !== undefined) updates.contentCategory = (body.contentCategory as string) || null;
    if (body.tweetUrl !== undefined) updates.tweetUrl = (body.tweetUrl as string) || null;
    if (body.reusableFor !== undefined) {
      updates.reusableFor = Array.isArray(body.reusableFor) ? body.reusableFor : [];
    }
    await db.update(postPatterns).set(updates).where(eq(postPatterns.id, id));
    return NextResponse.json({ ok: true });
  }

  // Simple toggle
  const { isActive } = body as { isActive?: boolean };
  await db.update(postPatterns).set({ isActive: !!isActive }).where(eq(postPatterns.id, id));
  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/patterns?id=uuid
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  await db.delete(postPatterns).where(eq(postPatterns.id, id));
  return NextResponse.json({ ok: true });
}
