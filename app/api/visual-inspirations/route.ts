import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { visualInspirations } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db
    .select({ id: visualInspirations.id, name: visualInspirations.name, stylePrompt: visualInspirations.stylePrompt, category: visualInspirations.category })
    .from(visualInspirations)
    .where(eq(visualInspirations.isActive, true))
    .orderBy(asc(visualInspirations.sortOrder), asc(visualInspirations.createdAt));

  return NextResponse.json(rows);
}
