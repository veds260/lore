import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Label only, never auth. Lets the admin panel mark its in-process runs so
// cron_runs rows say where the run came from.
export const CRON_TRIGGER_HEADER = 'x-cron-trigger';

export function cronTriggeredBy(req: NextRequest): 'manual' | 'schedule' {
  return req.headers.get(CRON_TRIGGER_HEADER) === 'manual' ? 'manual' : 'schedule';
}

// Shared auth for every /api/cron route. Fails closed when CRON_SECRET is unset.
// Returns null when the caller is authorised, otherwise the response to send.
export function assertCronRequest(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured' },
      { status: 503 },
    );
  }

  const presented = req.headers.get('x-cron-secret') ?? '';
  if (!presented || !safeEqual(presented, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
