import { NextResponse } from 'next/server';

export async function GET() {
  if (!process.env.FISH_AUDIO_API_KEY) {
    return NextResponse.json({ available: false }, { status: 503 });
  }
  return NextResponse.json({ available: true });
}
