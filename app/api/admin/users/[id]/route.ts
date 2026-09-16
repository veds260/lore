import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { users, userCredits, creditTransactions } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

const VALID_PLAN_TIERS = ['free', 'base', 'pro', 'growth', 'agency'] as const;
type PlanTier = typeof VALID_PLAN_TIERS[number];

function isValidPlanTier(v: unknown): v is PlanTier {
  return typeof v === 'string' && (VALID_PLAN_TIERS as readonly string[]).includes(v);
}

function isAdmin(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return adminEmail.split(',').map(e => e.trim().toLowerCase()).includes(email.toLowerCase());
}

// PATCH /api/admin/users/[id]: override plan and/or grant credits
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const { planTier, grantCredits } = body;

  if (planTier !== undefined && !isValidPlanTier(planTier)) {
    return NextResponse.json(
      { error: `Invalid planTier. Must be one of: ${VALID_PLAN_TIERS.join(', ')}` },
      { status: 400 },
    );
  }

  const grantAmount = typeof grantCredits === 'number' ? Math.floor(grantCredits) : 0;
  if (typeof grantCredits !== 'undefined' && (typeof grantCredits !== 'number' || grantCredits < 0)) {
    return NextResponse.json({ error: 'grantCredits must be a non-negative number' }, { status: 400 });
  }

  // Update plan if provided
  if (planTier !== undefined) {
    const updated = await db
      .update(users)
      .set({ planTier: planTier as PlanTier, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });

    if (updated.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
  }

  // Grant credits if requested
  if (grantAmount > 0) {
    // Upsert the userCredits row: if no row exists, create one
    const periodStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));

    const existing = await db
      .select({ balance: userCredits.balance })
      .from(userCredits)
      .where(eq(userCredits.userId, id));

    let newBalance: number;

    if (existing.length === 0) {
      const [row] = await db
        .insert(userCredits)
        .values({ userId: id, balance: grantAmount, periodStart, periodEnd })
        .returning({ balance: userCredits.balance });
      newBalance = row.balance;
    } else {
      const [row] = await db
        .update(userCredits)
        .set({
          balance: sql`${userCredits.balance} + ${grantAmount}`,
          updatedAt: new Date(),
        })
        .where(eq(userCredits.userId, id))
        .returning({ balance: userCredits.balance });
      newBalance = row.balance;
    }

    await db.insert(creditTransactions).values({
      userId: id,
      delta: grantAmount,
      action: 'admin_grant',
      meta: { grantedBy: 'admin' },
      balanceAfter: newBalance,
    });
  }

  // Fetch and return the updated user
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      planTier: users.planTier,
      createdAt: users.createdAt,
      creditBalance: userCredits.balance,
    })
    .from(users)
    .leftJoin(userCredits, eq(userCredits.userId, users.id))
    .where(eq(users.id, id));

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({
    user: {
      ...user,
      createdAt: user.createdAt.toISOString(),
      creditBalance: user.creditBalance ?? 0,
    },
  });
}
