import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { interviewSessions, interviewMessages } from '@/lib/db/schema';
import type { GeneratedQuestion, QuestionAsked, SessionState } from '@/lib/db/schema';
import { shouldFollowUp, generateFollowUp, synthesizeInterview, buildTranscriptMarkdown } from '@/lib/interview-engine';
import { z } from 'zod';

const RespondSchema = z.object({
  answer: z.string().min(1).max(5000),
  guestName: z.string().max(100).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = RespondSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const [session] = await db
    .select({
      id: interviewSessions.id,
      userId: interviewSessions.userId,
      status: interviewSessions.status,
      expiresAt: interviewSessions.expiresAt,
      generatedQuestions: interviewSessions.generatedQuestions,
      questionsAsked: interviewSessions.questionsAsked,
      sessionState: interviewSessions.sessionState,
      guestName: interviewSessions.guestName,
    })
    .from(interviewSessions)
    .where(eq(interviewSessions.shareToken, token))
    .limit(1);

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const authSession = await auth();
  // If an authenticated user is making this request, they must own the session
  if (authSession?.user?.id && authSession.user.id !== session.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (session.status === 'completed') return NextResponse.json({ error: 'Interview already complete' }, { status: 409 });
  // Re-activate a paused session on first answer after resuming
  if (session.status === 'paused') {
    await db.update(interviewSessions)
      .set({ status: 'active', pausedAt: null })
      .where(eq(interviewSessions.id, session.id));
  }
  if (session.expiresAt && session.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Interview link expired' }, { status: 410 });
  }

  const generated = (session.generatedQuestions as GeneratedQuestion[]) ?? [];
  const asked = (session.questionsAsked as QuestionAsked[]) ?? [];
  const state = (session.sessionState as SessionState) ?? { currentIndex: 0, followUpCount: 0 };

  const currentIndex = state.currentIndex;
  const currentQuestion = generated[currentIndex];
  if (!currentQuestion) return NextResponse.json({ error: 'No more questions' }, { status: 409 });

  const { answer, guestName } = parsed.data;
  const now = new Date().toISOString();

  // Save the answer
  const newAsked: QuestionAsked = {
    question: currentQuestion.question,
    answer,
    category: currentQuestion.category,
    isFollowUp: false,
    timestamp: now,
  };
  asked.push(newAsked);

  // Save to messages table
  await db.insert(interviewMessages).values([
    { sessionId: session.id, role: 'interviewer', content: currentQuestion.question, questionIndex: currentIndex, isFollowUp: false },
    { sessionId: session.id, role: 'user', content: answer, questionIndex: currentIndex, isFollowUp: false },
  ]);

  const isCurrentFollowUp = currentQuestion.extractionGoal === 'Follow-up for deeper detail';
  // Correct isFollowUp flag on the recorded answer
  newAsked.isFollowUp = isCurrentFollowUp;

  // Advance to next main question first
  const nextIndex = currentIndex + 1;
  const nextQuestion = generated[nextIndex] ?? null;
  const isComplete = nextIndex >= generated.length;

  // Optionally generate a deferred follow-up.
  // Rules: not on follow-up questions themselves, not on the last question (nowhere to defer),
  // and only when shouldFollowUp approves.
  let pendingFollowUp: string | null = null;
  if (!isCurrentFollowUp && !isComplete && shouldFollowUp(answer, state.followUpCount)) {
    try {
      pendingFollowUp = await generateFollowUp(currentQuestion.question, answer, currentQuestion.category);
    } catch (err) {
      console.warn(`[interview] Follow-up generation skipped for session ${session.id}:`, err instanceof Error ? err.message : err);
    }
  }

  let nextState: SessionState;

  if (pendingFollowUp) {
    // Splice the follow-up one position after the next main question so the client can
    // pre-fetch its audio while the user is answering the main next question.
    // e.g. current=Q3, nextMain=Q4, followUp inserts at Q5's slot → client pre-fetches during Q4.
    const followUpEntry: GeneratedQuestion = {
      question: pendingFollowUp,
      category: currentQuestion.category,
      extractionGoal: 'Follow-up for deeper detail',
      templateId: undefined,
    };
    generated.splice(nextIndex + 1, 0, followUpEntry);

    await db.insert(interviewMessages).values({
      sessionId: session.id, role: 'interviewer', content: pendingFollowUp, questionIndex: currentIndex, isFollowUp: true,
    });

    // Increment followUpCount so the question after the follow-up doesn't trigger another one
    nextState = { currentIndex: nextIndex, followUpCount: state.followUpCount + 1 };
  } else {
    nextState = { currentIndex: nextIndex, followUpCount: 0 };
  }

  const updates: Partial<typeof interviewSessions.$inferInsert> = {
    questionsAsked: asked,
    sessionState: nextState,
    guestName: guestName ?? session.guestName ?? null,
    ...(pendingFollowUp ? { generatedQuestions: generated } : {}),
  };

  if (isComplete) {
    updates.status = 'completed';
    updates.completedAt = new Date();
    updates.transcriptMarkdown = buildTranscriptMarkdown(asked);
  }

  await db.update(interviewSessions).set(updates).where(eq(interviewSessions.id, session.id));

  if (isComplete) {
    synthesizeInterview(session.id).catch(e =>
      console.error(`[synthesis] Failed for session ${session.id}:`, e instanceof Error ? e.message : e)
    );
  }

  return NextResponse.json({
    nextQuestion: nextQuestion
      ? { ...nextQuestion, isFollowUp: nextQuestion.extractionGoal === 'Follow-up for deeper detail' }
      : null,
    currentIndex: nextIndex,
    totalQuestions: generated.length,
    isComplete,
    ...(pendingFollowUp ? { pendingFollowUp } : {}),
  });
}
