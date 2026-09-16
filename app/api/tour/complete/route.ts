import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { z } from 'zod';

const Schema = z.object({
  kind: z.enum(['main', 'drawer']),
  reset: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const now = new Date();
  const stamp = parsed.data.reset ? null : now;

  const update = parsed.data.kind === 'main'
    ? { tourCompletedAt: stamp, updatedAt: now }
    : { drawerTourCompletedAt: stamp, updatedAt: now };

  await db.update(users).set(update).where(eq(users.id, session.user.id));
  return NextResponse.json({ ok: true });
}
