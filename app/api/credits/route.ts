import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getCredits, getRecentTransactions } from '@/lib/credits';
import { isHosted } from '@/lib/plans';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [credits, transactions] = await Promise.all([
    getCredits(session.user.id),
    getRecentTransactions(session.user.id, 20),
  ]);

  return NextResponse.json({
    balance: credits.balance,
    monthlyAllowance: credits.monthlyAllowance,
    isUnlimited: credits.isUnlimited,
    periodEnd: credits.periodEnd,
    plan: credits.plan,
    // Self-hosted installs have no plans or credits, so the app hides that UI.
    hosted: isHosted(),
    transactions: transactions.map(t => ({
      id: t.id,
      delta: t.delta,
      action: t.action,
      balanceAfter: t.balanceAfter,
      createdAt: t.createdAt,
    })),
  });
}
