import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { visualInspirations } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';

function isAdmin(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return adminEmail.split(',').map(e => e.trim().toLowerCase()).includes(email.toLowerCase());
}

export async function GET() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const rows = await db
    .select()
    .from(visualInspirations)
    .orderBy(asc(visualInspirations.sortOrder), asc(visualInspirations.createdAt));

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body?.name?.trim() || !body?.stylePrompt?.trim()) {
    return NextResponse.json({ error: 'name and stylePrompt are required' }, { status: 400 });
  }

  const [row] = await db
    .insert(visualInspirations)
    .values({
      name: body.name.trim(),
      stylePrompt: body.stylePrompt.trim(),
      category: body.category ?? 'diagram',
      sortOrder: body.sortOrder ?? 0,
      isActive: body.isActive ?? true,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
