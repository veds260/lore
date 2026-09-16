import { NextRequest, NextResponse, after } from 'next/server';
import { auth } from '@/lib/auth';
import { CRON_TRIGGER_HEADER } from '@/lib/cron-auth';
import { db } from '@/lib/db';
import { cronRuns, systemConfig } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

// Import cron handlers directly so we can invoke them in-process (no HTTP round
// trip). The Railway pod can't reliably fetch its own public URL from inside the
// container, `fetch failed` errors. In-process call sidesteps the issue entirely.
import { POST as dailySyncPOST } from '../../cron/daily-sync/route';
import { POST as consolidateSkillsPOST } from '../../cron/consolidate-skills/route';
import { POST as scoreDraftsPOST } from '../../cron/score-drafts/route';
import { POST as telegramDailyPOST } from '../../cron/telegram-daily/route';
import { POST as telegramPerformancePOST } from '../../cron/telegram-performance/route';
import { POST as fetchMainstreamNewsPOST } from '../../cron/fetch-mainstream-news/route';

const CRON_HANDLERS: Record<string, (req: NextRequest) => Promise<Response>> = {
  'daily-sync': dailySyncPOST,
  'consolidate-skills': consolidateSkillsPOST,
  'score-drafts': scoreDraftsPOST,
  'telegram-daily': telegramDailyPOST,
  'telegram-performance': telegramPerformancePOST,
  'fetch-mainstream-news': fetchMainstreamNewsPOST,
};

function isAdmin(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return adminEmail.split(",").map(e => e.trim().toLowerCase()).includes(email.toLowerCase());
}

const JOBS = [
  {
    name: 'daily-sync',
    label: 'Daily Content Sync',
    description: 'Syncs Twitter + LinkedIn posts for all active brands, captures engagement, and fuzzy-matches posted content back to drafts.',
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
    description: 'Auto-scores all unscored drafts using AI. Also fires automatically when a draft is saved.',
    schedule: '0 */6 * * *',
    scheduleLabel: 'Every 6 hours',
  },
  {
    name: 'telegram-daily',
    label: 'Telegram Daily Push',
    description: 'Sends 3 fresh idea suggestions to each connected user via Telegram bot, ready to draft with a single reply.',
    schedule: '0 3 * * *',
    scheduleLabel: 'Daily at 3am UTC',
  },
  {
    name: 'telegram-performance',
    label: 'Telegram Performance Pings',
    description: 'Notifies users about their high-performing posts and offers to draft follow-ups via Telegram.',
    schedule: '0 14 * * *',
    scheduleLabel: 'Daily at 2pm UTC',
  },
  {
    name: 'fetch-mainstream-news',
    label: 'Mainstream News Ingestion',
    description: 'Pulls fresh items from TechCrunch / Hacker News / TechMeme / The Verge, then runs the per-brand Flash judge to score each item for relevance and virality. Surfaces top items in the LinkedIn pulse for opted-in brands.',
    schedule: '0 */3 * * *',
    scheduleLabel: 'Every 3 hours',
  },
];

// GET /api/admin/cron: job list + recent run history
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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

      return { ...job, enabled, runs };
    }),
  );

  return NextResponse.json({ jobs: jobData });
}

// PATCH /api/admin/cron: enable/disable a job
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { job, enabled } = await req.json().catch(() => ({}));
  if (!job || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'job and enabled required' }, { status: 400 });
  }

  await db
    .insert(systemConfig)
    .values({ key: `cron:${job}:enabled`, value: { enabled }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: { value: { enabled }, updatedAt: new Date() },
    });

  return NextResponse.json({ ok: true, job, enabled });
}

// POST /api/admin/cron: manually trigger a job (fire-and-forget)
// Some jobs run for 60-200+ seconds (daily-sync regularly takes 90s). Waiting in
// this handler causes platform timeouts (~30s) → empty response body → "Unexpected
// end of JSON input" on the client. So we kick off the cron and return immediately;
// the cron writes its own row to cron_runs when it finishes, which the admin page
// will pick up on the next refresh.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { job } = await req.json().catch(() => ({}));
  if (!job) return NextResponse.json({ error: 'job required' }, { status: 400 });

  const known = JOBS.find(j => j.name === job);
  if (!known) return NextResponse.json({ error: 'Unknown job' }, { status: 404 });

  const handler = CRON_HANDLERS[job];
  if (!handler) return NextResponse.json({ error: 'Unknown job handler' }, { status: 404 });

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured. Set it to trigger jobs from the admin panel.' },
      { status: 503 },
    );
  }

  // Build a synthetic request carrying the cron secret so the cron route's auth
  // check passes. We invoke the handler in-process via after() so the response
  // returns to the user immediately and the cron keeps running on the server.
  const url = new URL(req.url);
  const internalReq = new NextRequest(`${url.protocol}//${url.host}/api/cron/${job}`, {
    method: 'POST',
    headers: {
      'x-cron-secret': cronSecret,
      [CRON_TRIGGER_HEADER]: 'manual',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  after(async () => {
    try {
      const res = await handler(internalReq);
      if (!res.ok) {
        console.error(`[admin/cron] ${job} handler returned HTTP ${res.status}`);
      }
    } catch (err) {
      console.error(`[admin/cron] ${job} handler threw:`, err instanceof Error ? err.message : err);
    }
  });

  return NextResponse.json({
    ok: true,
    triggered: true,
    job,
    message: 'Job started. Refresh in a few seconds to see the result.',
  });
}
