import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { interviewSessions } from '@/lib/db/schema';
import type { QuestionAsked } from '@/lib/db/schema';
import { buildTranscriptMarkdown, synthesizeInterview } from '@/lib/interview-engine';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const [session] = await db
    .select({
      id: interviewSessions.id,
      userId: interviewSessions.userId,
      status: interviewSessions.status,
      questionsAsked: interviewSessions.questionsAsked,
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

  if (session.status === 'completed') return NextResponse.json({ ok: true });

  const asked = (session.questionsAsked as QuestionAsked[]) ?? [];

  await db.update(interviewSessions)
    .set({
      status: 'completed',
      completedAt: new Date(),
      transcriptMarkdown: buildTranscriptMarkdown(asked),
    })
    .where(eq(interviewSessions.id, session.id));

  synthesizeInterview(session.id).catch(e =>
    console.error(`[synthesis] Failed for session ${session.id}:`, e instanceof Error ? e.message : e)
  );

  return NextResponse.json({ ok: true });
}
