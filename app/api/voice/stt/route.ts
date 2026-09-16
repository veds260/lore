import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { interviewSessions } from '@/lib/db/schema';
import type { GeneratedQuestion } from '@/lib/db/schema';

// Groq Whisper STT
// Model: whisper-large-v3-turbo, $0.04/audio hour (≈ $0.00067/min)
// OpenAI-compatible endpoint
const GROQ_STT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const STT_MODEL = 'whisper-large-v3-turbo';

// Hard limits
// 20 min of webm/opus at 32–64kbps ≈ 5–10MB. Cap at 24MB (just under Groq's 25MB limit).
const MAX_FILE_BYTES = 24 * 1024 * 1024;
// Max turns: 9 base + 3 replacement (3-skip limit) + up to 9 follow-ups = 21 question presentations
// Allow ~1.4 retries average → 30
const MAX_STT_CALLS_PER_SESSION = 30;

// In-memory call counter per session (same rationale as TTS counter)
const sttCallCounts = new Map<string, number>();

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'STT not configured' }, { status: 503 });

  // Session token must be in the X-Session-Token header
  const sessionToken = req.headers.get('x-session-token');
  if (!sessionToken) return NextResponse.json({ error: 'Missing session token' }, { status: 401 });

  // Validate session
  const [session] = await db
    .select({
      id: interviewSessions.id,
      status: interviewSessions.status,
      expiresAt: interviewSessions.expiresAt,
      generatedQuestions: interviewSessions.generatedQuestions,
      userId: interviewSessions.userId,
    })
    .from(interviewSessions)
    .where(eq(interviewSessions.shareToken, sessionToken))
    .limit(1);

  if (!session) return NextResponse.json({ error: 'Invalid session' }, { status: 403 });
  if (session.status === 'completed') return NextResponse.json({ error: 'Session already complete' }, { status: 409 });
  if (session.expiresAt && session.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Session expired' }, { status: 410 });
  }

  // Per-session call cap
  const count = (sttCallCounts.get(session.id) ?? 0) + 1;
  if (count > MAX_STT_CALLS_PER_SESSION) {
    return NextResponse.json({ error: 'STT limit reached for this session' }, { status: 429 });
  }
  sttCallCounts.set(session.id, count);

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const audioFile = formData.get('audio');
  if (!audioFile || !(audioFile instanceof Blob)) {
    return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
  }

  // Hard file size cap: 5MB covers ~5 min of webm/opus
  // This is the primary server-side guard against "mic open for hours"
  if (audioFile.size > MAX_FILE_BYTES) {
    return NextResponse.json({
      error: 'Recording file too large. Maximum is 20 minutes per answer.',
      code: 'file_too_large',
    }, { status: 413 });
  }

  const groqForm = new FormData();
  groqForm.append('file', audioFile, 'recording.webm');
  groqForm.append('model', STT_MODEL);
  groqForm.append('response_format', 'json');
  groqForm.append('language', 'en');

  const res = await fetch(GROQ_STT_ENDPOINT, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: groqForm,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`Groq STT error [${res.status}]:`, err);
    return NextResponse.json({ error: 'Transcription failed' }, { status: 502 });
  }

  const data = await res.json() as { text: string };
  return NextResponse.json({ transcript: data.text?.trim() ?? '' });
}
