import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { interviewSessions } from '@/lib/db/schema';
import type { SessionState } from '@/lib/db/schema';
import { z } from 'zod';

// Fish Audio TTS
// Model: s2-pro, $15.00 / 1M UTF-8 bytes (~$0.0018 per interview question)
// Rate limits: Starter tier (< $100 cumulative spend) = 5 concurrent requests
const TTS_ENDPOINT = 'https://api.fish.audio/v1/tts';
const TTS_MODEL = 's2-pro';
const FALLBACK_VOICE_ID = '933563129e564b19a115bedd57b7406a'; // Sarah, conversational EN female

// Per-session TTS call cap: (9 base + 3 replacement) questions × 3 replays max = 36
// 3-skip limit means at most 3 replacement questions can be added per session
const MAX_TTS_CALLS_PER_SESSION = 36;

const Schema = z.object({
  text: z.string().min(1).max(1000),
  sessionToken: z.string().min(10),
});

// In-memory per-session call counter (resets on server restart, good enough for rate limiting)
// For multi-instance deploys, this naturally resets, harmless since the cap is generous
const ttsCallCounts = new Map<string, number>();

export async function POST(req: NextRequest) {
  const apiKey = process.env.FISH_AUDIO_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'TTS not configured' }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const { text, sessionToken } = parsed.data;

  // Validate session token, reject if not a real active/completed session
  const [session] = await db
    .select({
      id: interviewSessions.id,
      status: interviewSessions.status,
      expiresAt: interviewSessions.expiresAt,
      userId: interviewSessions.userId,
    })
    .from(interviewSessions)
    .where(eq(interviewSessions.shareToken, sessionToken))
    .limit(1);

  if (!session) return NextResponse.json({ error: 'Invalid session' }, { status: 403 });
  if (session.expiresAt && session.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Session expired' }, { status: 410 });
  }

  // Per-session call cap
  const count = (ttsCallCounts.get(session.id) ?? 0) + 1;
  if (count > MAX_TTS_CALLS_PER_SESSION) {
    return NextResponse.json({ error: 'TTS limit reached for this session' }, { status: 429 });
  }
  ttsCallCounts.set(session.id, count);

  const voiceId = process.env.FISH_AUDIO_VOICE_ID ?? FALLBACK_VOICE_ID;

  const res = await fetch(TTS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      reference_id: voiceId,
      model: TTS_MODEL,
      format: 'mp3',
      mp3_bitrate: 128,
      latency: 'balanced',
      prosody: { speed: 1.15 },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`Fish Audio TTS error [${res.status}]:`, err);
    return NextResponse.json({ error: 'TTS failed' }, { status: 502 });
  }

  const audioBuffer = await res.arrayBuffer();
  return new NextResponse(audioBuffer, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
      'Content-Length': audioBuffer.byteLength.toString(),
    },
  });
}
