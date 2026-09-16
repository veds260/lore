import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { interviewSessions, users } from '@/lib/db/schema';

const PLAN_QUOTA: Record<string, number> = {
  free:   0,
  base:   2,
  pro:    5,
  agency: 9999,
};

function billingPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;
  const period = billingPeriod();

  const [user] = await db
    .select({ planTier: users.planTier })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const planTier = user?.planTier ?? 'free';
  const quota = PLAN_QUOTA[planTier] ?? 0;
  const isUnlimited = quota >= 9999;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(interviewSessions)
    .where(and(eq(interviewSessions.userId, userId), eq(interviewSessions.billingPeriod, period)));

  return NextResponse.json({ used: count, quota, plan: planTier, isUnlimited });
}
