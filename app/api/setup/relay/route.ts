import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { ownerExists } from '@/lib/setup/claim';
import { connectRelay, relayBalance, RelayError } from '@/lib/relay/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Same gate as /setup: open while the instance has no owner, then owner session only.
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
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'Could not reach the shared relay' },
    { status: 502 },
  );
}

export async function POST() {
  if (!(await allowed())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { credits } = await connectRelay();
    return NextResponse.json({ credits });
  } catch (err) {
    return failure(err);
  }
}

export async function GET() {
  if (!(await allowed())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const balance = await relayBalance();
    return NextResponse.json({ connected: Boolean(balance), balance });
  } catch (err) {
    return failure(err);
  }
}
