import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { interviewSessions, interviewMessages } from '@/lib/db/schema';
import type { GeneratedQuestion, QuestionAsked, SessionState } from '@/lib/db/schema';
import { buildTranscriptMarkdown, synthesizeInterview, generateReplacementQuestion } from '@/lib/interview-engine';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const [session] = await db
    .select({
      id: interviewSessions.id,
      userId: interviewSessions.userId,
      brandId: interviewSessions.brandId,
      status: interviewSessions.status,
      expiresAt: interviewSessions.expiresAt,
      generatedQuestions: interviewSessions.generatedQuestions,
      questionsAsked: interviewSessions.questionsAsked,
      sessionState: interviewSessions.sessionState,
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
  if (session.expiresAt && session.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Interview link expired' }, { status: 410 });
  }

  const MAX_SKIPS = 3;

  const generated = (session.generatedQuestions as GeneratedQuestion[]) ?? [];
  const asked = (session.questionsAsked as QuestionAsked[]) ?? [];
  const state = (session.sessionState as SessionState) ?? { currentIndex: 0, followUpCount: 0 };

  const currentIndex = state.currentIndex;
  const currentQuestion = generated[currentIndex];
  if (!currentQuestion) return NextResponse.json({ error: 'No more questions' }, { status: 409 });

  const priorSkips = asked.filter(a => a.answer === '[skipped]').length;
  if (priorSkips >= MAX_SKIPS) {
    return NextResponse.json({ error: 'Skip limit reached', type: 'skip_limit', skipsUsed: priorSkips, maxSkips: MAX_SKIPS }, { status: 429 });
  }

  // Record the skip
  asked.push({
    question: currentQuestion.question,
    answer: '[skipped]',
    category: currentQuestion.category,
    isFollowUp: false,
    timestamp: new Date().toISOString(),
  });

  await db.insert(interviewMessages).values({
    sessionId: session.id,
    role: 'interviewer',
    content: currentQuestion.question,
    questionIndex: currentIndex,
    isFollowUp: false,
  });

  const nextIndex = currentIndex + 1;
  const nextState: SessionState = { currentIndex: nextIndex, followUpCount: 0 };
  const isComplete = nextIndex >= generated.length;

  const updates: Partial<typeof interviewSessions.$inferInsert> = {
    questionsAsked: asked,
    sessionState: nextState,
  };

  if (isComplete) {
    updates.status = 'completed';
    updates.completedAt = new Date();
    updates.transcriptMarkdown = buildTranscriptMarkdown(asked);
  }

  await db.update(interviewSessions).set(updates).where(eq(interviewSessions.id, session.id));

  if (isComplete) {
    synthesizeInterview(session.id).catch(() => {});
    return NextResponse.json({ isComplete: true, currentIndex: nextIndex, totalQuestions: generated.length });
  }

  // Fire replacement question generation async, appends to queue so later questions cover what was skipped
  const skipCount = asked.filter(a => a.answer === '[skipped]').length;
  if (session.brandId && skipCount >= 1) {
    const usedTemplateIds = generated.map(q => q.templateId);
    generateReplacementQuestion(session.brandId, session.userId, usedTemplateIds)
      .then(async replacement => {
        if (!replacement) return;
        const fresh = await db.select({ generatedQuestions: interviewSessions.generatedQuestions })
          .from(interviewSessions).where(eq(interviewSessions.id, session.id)).limit(1);
        const latest = (fresh[0]?.generatedQuestions as GeneratedQuestion[]) ?? generated;
        await db.update(interviewSessions)
          .set({ generatedQuestions: [...latest, replacement] })
          .where(eq(interviewSessions.id, session.id));
      })
      .catch(() => {});
  }

  const newSkipCount = priorSkips + 1;
  return NextResponse.json({
    nextQuestion: generated[nextIndex] ?? null,
    currentIndex: nextIndex,
    totalQuestions: generated.length + (session.brandId ? 1 : 0), // hint: replacement coming
    isComplete: false,
    skipsUsed: newSkipCount,
    maxSkips: MAX_SKIPS,
  });
}
