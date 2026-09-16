import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { brands, skills } from '@/lib/db/schema';
import { eq, desc, ne } from 'drizzle-orm';
import { SkillsClient, type DbSkill } from '@/components/skills/skills-client';
import { GLOBAL_RULES } from '@/lib/global-rules';

export default async function SkillsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.userId, session.user.id))
    .limit(1);

  // Deliberately omit `body`: rule text never leaves the server
  const rows = brand
    ? await db
        .select({
          id: skills.id,
          name: skills.name,
          kind: skills.kind,
          status: skills.status,
          source: skills.source,
          confidence: skills.confidence,
          timesApplied: skills.timesApplied,
          createdAt: skills.createdAt,
        })
        .from(skills)
        .where(eq(skills.brandId, brand.id))
        .orderBy(desc(skills.createdAt))
    : [];

  // Filter out consolidated originals, they've been merged and are no longer individual
  const dbSkills: DbSkill[] = rows
    .filter(r => r.status !== 'consolidated')
    .map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));

  return <SkillsClient initialSkills={dbSkills} globalRuleCount={GLOBAL_RULES.length} />;
}
