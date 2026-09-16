import { auth } from '@/lib/auth';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { users, userCredits, creditTransactions } from '@/lib/db/schema';
import { eq, count, sql } from 'drizzle-orm';
import { UsersClient } from '@/components/admin/users-client';

function isAdmin(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return adminEmail.split(',').map(e => e.trim().toLowerCase()).includes(email.toLowerCase());
}

export default async function AdminUsersPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const rows = await db
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
    .orderBy(users.createdAt);

  const stats = await db
    .select({
      userId: creditTransactions.userId,
      totalGenerations: count(
        sql`CASE WHEN ${creditTransactions.action} = 'generate' THEN 1 END`,
      ),
      totalRevisions: count(
        sql`CASE WHEN ${creditTransactions.action} = 'revise' THEN 1 END`,
      ),
      lastActiveAt: sql<string | null>`MAX(${creditTransactions.createdAt})`,
    })
    .from(creditTransactions)
    .groupBy(creditTransactions.userId);

  const statsMap = new Map(stats.map(s => [s.userId, s]));

  const userList = rows.map(u => {
    const s = statsMap.get(u.id);
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      planTier: u.planTier,
      createdAt: u.createdAt.toISOString(),
      creditBalance: u.creditBalance ?? 0,
      totalGenerations: s?.totalGenerations ?? 0,
      totalRevisions: s?.totalRevisions ?? 0,
      lastActiveAt: s?.lastActiveAt ?? null,
    };
  });

  return <UsersClient initialUsers={userList} />;
}
