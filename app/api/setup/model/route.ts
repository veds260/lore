import { NextResponse } from 'next/server';
import { setupAccess } from '@/lib/setup/claim';
import { backendOptions, saveBackendChoice, testModel, type BackendChoice } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VERIFIED = 'model_verified';

async function allowed(): Promise<boolean> {
  const access = await setupAccess();
  return access === 'open' || access === 'owner';
}

async function readVerified(): Promise<string | null> {
  try {
    const { db } = await import('@/lib/db');
    const { instanceSettings } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select({ value: instanceSettings.value }).from(instanceSettings).where(eq(instanceSettings.key, VERIFIED)).limit(1);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function writeVerified(value: string | null): Promise<void> {
  const { db } = await import('@/lib/db');
  const { instanceSettings } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  if (value === null) {
    await db.delete(instanceSettings).where(eq(instanceSettings.key, VERIFIED));
    return;
  }
  const now = new Date();
  await db.insert(instanceSettings).values({ key: VERIFIED, value, updatedAt: now })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value, updatedAt: now } });
}

export async function GET() {
  if (!(await allowed())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { options, active, pinned } = await backendOptions();
  const verified = active !== null && (await readVerified()) === active;
  return NextResponse.json({ options, active, pinned, verified });
}

export async function POST(req: Request) {
  if (!(await allowed())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; backend?: unknown };

  if (body.action === 'use') {
    const backend = body.backend;
    if (backend !== 'claude' && backend !== 'codex' && backend !== 'api') {
      return NextResponse.json({ error: 'Unknown model' }, { status: 400 });
    }
    await saveBackendChoice(backend as BackendChoice);
    await writeVerified(null);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'test') {
    const result = await testModel();
    const { active } = await backendOptions();
    await writeVerified(result.ok && active ? active : null);
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
