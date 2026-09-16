import { auth } from '@/lib/auth';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { cronRuns, systemConfig } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { CronClient } from '@/components/admin/cron-client';
import { AdminNav } from '@/components/admin/users-client';

function isAdmin(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return adminEmail.split(',').map(e => e.trim().toLowerCase()).includes(email.toLowerCase());
}

const JOBS = [
  {
    name: 'daily-sync',
    label: 'Daily Content Sync',
    description: 'Syncs Twitter + LinkedIn posts for all active brands, captures engagement, and fuzzy-matches posted content back to drafts to close the performance loop.',
    schedule: '0 4 * * *',
    scheduleLabel: 'Daily at 4am UTC',
  },
  {
    name: 'consolidate-skills',
    label: 'Weekly Skill Synthesis',
    description: 'Synthesizes auto-learned writing rules from corrections, revisions, and interviews into a unified voice document per brand.',
    schedule: '0 0 * * 0',
    scheduleLabel: 'Sundays at midnight UTC',
  },
  {
    name: 'score-drafts',
    label: 'Draft Quality Scorer',
    description: 'Auto-scores all unscored drafts (hook, substance, authenticity, formatting) using AI. Runs every 6 hours and on-demand after each draft is saved.',
    schedule: '0 */6 * * *',
    scheduleLabel: 'Every 6 hours',
  },
];

export default async function AdminPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const jobData = await Promise.all(
    JOBS.map(async (job) => {
      const runs = await db
        .select()
        .from(cronRuns)
        .where(eq(cronRuns.jobName, job.name))
        .orderBy(desc(cronRuns.createdAt))
        .limit(10);

      const [configRow] = await db
        .select({ value: systemConfig.value })
        .from(systemConfig)
        .where(eq(systemConfig.key, `cron:${job.name}:enabled`));

      const enabled = !configRow || (configRow.value as { enabled: boolean }).enabled !== false;

      return {
        ...job,
        enabled,
        runs: runs.map(r => ({
          ...r,
          result: r.result as Record<string, unknown> | null,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }),
  );

  return (
    <div className="p-8 lg:p-10 w-full">
      <AdminNav active="cron" />
      <CronClient jobs={jobData} />
    </div>
  );
}
