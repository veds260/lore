import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { ownerExists } from '@/lib/setup/claim';
import {
  pollGithubUnlock, RelayError, startGithubUnlock, startXUnlock, unlockStatus, verifyXUnlock,
} from '@/lib/relay/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function allowed(): Promise<boolean> {
  if (!(await ownerExists())) return true;
  const session = await auth();
  return Boolean(session?.user);
}

function failure(err: unknown) {
  if (err instanceof RelayError) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 502;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  return NextResponse.json({ error: 'Could not reach the shared relay' }, { status: 502 });
}

export async function GET() {
  if (!(await allowed())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await unlockStatus());
  } catch (err) {
    return failure(err);
  }
}

export async function POST(req: Request) {
  if (!(await allowed())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; handle?: unknown };
  try {
    switch (body.action) {
      case 'x-start':
        return NextResponse.json(await startXUnlock(typeof body.handle === 'string' ? body.handle.slice(0, 40) : ''));
      case 'x-verify':
        return NextResponse.json(await verifyXUnlock());
      case 'github-start':
        return NextResponse.json(await startGithubUnlock());
      case 'github-poll':
        return NextResponse.json(await pollGithubUnlock());
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err) {
    return failure(err);
  }
}
