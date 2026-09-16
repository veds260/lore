import { auth } from '@/lib/auth';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { postPatterns } from '@/lib/db/schema';
import { count, desc, sql, eq } from 'drizzle-orm';
import { PatternsClient } from '@/components/admin/patterns-client';

function isAdmin(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return adminEmail.split(',').map(e => e.trim().toLowerCase()).includes(email.toLowerCase());
}

const PAGE_SIZE = 20;

export default async function AdminPatternsPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const [{ total }] = await db
    .select({ total: count() })
    .from(postPatterns)
    .where(eq(postPatterns.isActive, true));

  const patterns = await db
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
    .where(eq(postPatterns.isActive, true))
    .orderBy(desc(postPatterns.createdAt))
    .limit(PAGE_SIZE);

  const byHook = await db
    .select({ hookType: postPatterns.hookType, count: count() })
    .from(postPatterns)
    .where(eq(postPatterns.isActive, true))
    .groupBy(postPatterns.hookType)
    .orderBy(sql`count(*) DESC`)
    .limit(15);

  const initialData = {
    total,
    page: 1,
    pageSize: PAGE_SIZE,
    patterns: patterns.map(p => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      reusableFor: (p.reusableFor ?? []) as string[],
    })),
    byHook,
  };

  return <PatternsClient initialData={initialData} />;
}
