import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { inviteCodes, users } from '@/lib/db/schema';
import { z } from 'zod';

const Schema = z.object({ code: z.string().min(1).max(64) });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const code = parsed.data.code.trim().toUpperCase();

  const [user] = await db.select({ planTier: users.planTier }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  if (user.planTier !== 'free') {
    return NextResponse.json({ error: 'Your account already has an active plan' }, { status: 409 });
  }

  const [invite] = await db
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.code, code))
    .limit(1);

  if (!invite) return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 });
  if (invite.redeemedBy !== null) {
    return NextResponse.json({ error: 'This code has already been used' }, { status: 409 });
  }
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return NextResponse.json({ error: 'This code has expired' }, { status: 410 });
  }

  // Claim the code first, conditionally, so two people redeeming at once cannot both win.
  const claimed = await db.transaction(async (tx) => {
    const [won] = await tx.update(inviteCodes)
      .set({ redeemedBy: userId, redeemedAt: new Date() })
      .where(and(eq(inviteCodes.id, invite.id), isNull(inviteCodes.redeemedBy)))
      .returning({ id: inviteCodes.id });
    if (!won) return false;
    await tx.update(users)
      .set({ planTier: invite.planTier })
      .where(eq(users.id, userId));
    return true;
  });
  if (!claimed) return NextResponse.json({ error: 'This code has already been used' }, { status: 409 });

  return NextResponse.json({ planTier: invite.planTier });
}
