import { NextResponse } from 'next/server';
import { activeRelayKey } from '@/lib/relay/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!process.env.FISH_AUDIO_API_KEY && !(await activeRelayKey())) {
    return NextResponse.json({ available: false }, { status: 503 });
  }
  return NextResponse.json({ available: true });
}
