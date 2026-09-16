import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { cronRuns, users } from '@/lib/db/schema';
import { ritualEnabled } from '@/lib/briefs';
import { RITUAL_CATALOG, SYSTEM_JOBS } from '@/lib/rituals-catalog';

async function lastRuns(jobNames: string[]): Promise<Record<string, { status: string; at: string } | null>> {
  const rows = await db
    .select({
      jobName: cronRuns.jobName,
      status: cronRuns.status,
      createdAt: cronRuns.createdAt,
    })
    .from(cronRuns)
    .where(inArray(cronRuns.jobName, jobNames))
    .orderBy(desc(cronRuns.createdAt))
    .limit(200);

  const out: Record<string, { status: string; at: string } | null> = {};
  for (const name of jobNames) out[name] = null;
  for (const row of rows) {
    if (!out[row.jobName]) {
      out[row.jobName] = { status: row.status, at: row.createdAt.toISOString() };
    }
  }
  return out;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [user] = await db
    .select({ ritualSettings: users.ritualSettings, telegramChatId: users.telegramChatId })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const runs = await lastRuns([
    ...RITUAL_CATALOG.map(r => r.jobName),
    ...SYSTEM_JOBS.map(j => j.jobName),
  ]).catch(() => ({} as Record<string, { status: string; at: string } | null>));

  return NextResponse.json({
    telegramLinked: !!user?.telegramChatId,
    rituals: RITUAL_CATALOG.map(r => ({
      ...r,
      enabled: ritualEnabled(user?.ritualSettings, r.id),
      lastRun: runs[r.jobName] ?? null,
    })),
    systemJobs: SYSTEM_JOBS.map(j => ({
      ...j,
      lastRun: runs[j.jobName] ?? null,
    })),
  });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ritual = body?.ritual as string | undefined;
  const enabled = body?.enabled;
  if (!ritual || typeof enabled !== 'boolean' || !RITUAL_CATALOG.some(r => r.id === ritual)) {
    return NextResponse.json({ error: 'Invalid ritual' }, { status: 400 });
  }

  const [user] = await db
    .select({ ritualSettings: users.ritualSettings })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const next = { ...(user?.ritualSettings ?? {}), [ritual]: { enabled } };
  await db.update(users)
    .set({ ritualSettings: next, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));

  return NextResponse.json({ ok: true, ritual, enabled });
}
