import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { interviewSessions } from '@/lib/db/schema';
import type { GeneratedQuestion, QuestionAsked, SessionState } from '@/lib/db/schema';
import { auth } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const [session] = await db
    .select({
      id: interviewSessions.id,
      userId: interviewSessions.userId,
      status: interviewSessions.status,
      guestName: interviewSessions.guestName,
      startedAt: interviewSessions.startedAt,
      expiresAt: interviewSessions.expiresAt,
      generatedQuestions: interviewSessions.generatedQuestions,
      questionsAsked: interviewSessions.questionsAsked,
      sessionState: interviewSessions.sessionState,
      completedAt: interviewSessions.completedAt,
      synthesisStatus: interviewSessions.synthesisStatus,
    })
    .from(interviewSessions)
    .where(eq(interviewSessions.shareToken, token))
    .limit(1);

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (session.expiresAt && session.expiresAt < new Date()) {
    return NextResponse.json({ error: 'This interview link has expired.' }, { status: 410 });
  }

  // Check if the requesting user owns this session (skip name gate on client)
  const authSession = await auth();
  const isOwner = authSession?.user?.id === session.userId;

  const generated = (session.generatedQuestions as GeneratedQuestion[]) ?? [];
  const asked = (session.questionsAsked as QuestionAsked[]) ?? [];
  const state = (session.sessionState as SessionState) ?? { currentIndex: 0, followUpCount: 0 };

  const currentIndex = state.currentIndex;
  const currentQuestion = generated[currentIndex] ?? null;
  const isComplete = session.status === 'completed' || currentIndex >= generated.length;
  const isPaused = session.status === 'paused';

  // Send the full question text queue so the client can pre-fetch TTS audio one question ahead.
  // Only text is sent, no categories or metadata needed for pre-fetching.
  const questionsQueue = generated.map(q => q.question);

  return NextResponse.json({
    sessionId: session.id,
    status: session.status,
    guestName: session.guestName,
    isOwner,
    currentQuestion,
    currentIndex,
    totalQuestions: generated.length,
    answeredCount: asked.length,
    isComplete,
    isPaused,
    completedAt: session.completedAt,
    synthesisStatus: session.synthesisStatus,
    questionsQueue,
  });
}
