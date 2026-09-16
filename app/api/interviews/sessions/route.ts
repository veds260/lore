import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { interviewSessions, brands, drafts } from '@/lib/db/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import type { QuestionAsked } from '@/lib/db/schema';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.userId, userId))
    .limit(1);

  if (!brand) return NextResponse.json({ sessions: [] });

  const rows = await db
    .select({
      id: interviewSessions.id,
      status: interviewSessions.status,
      startedAt: interviewSessions.startedAt,
      completedAt: interviewSessions.completedAt,
      transcriptMarkdown: interviewSessions.transcriptMarkdown,
      questionsAsked: interviewSessions.questionsAsked,
      shareToken: interviewSessions.shareToken,
    })
    .from(interviewSessions)
    .where(and(
      eq(interviewSessions.userId, userId),
      eq(interviewSessions.brandId, brand.id),
    ))
    .orderBy(desc(interviewSessions.startedAt))
    .limit(20);

  // Count ideas extracted per session
  const sessionIds = rows.map(r => r.id);
  const ideaCounts = sessionIds.length > 0
    ? await db
        .select({ cnt: count() })
        .from(drafts)
        .where(and(
          eq(drafts.brandId, brand.id),
          eq(drafts.status, 'idea'),
        ))
    : [];
  const totalIdeas = ideaCounts[0]?.cnt ?? 0;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  const sessions = rows.map((r, i) => {
    const qa = (r.questionsAsked as QuestionAsked[]) ?? [];
    const answeredCount = qa.filter(q => q.answer && q.answer !== '[skipped]').length;
    return {
      id: r.id,
      status: r.status,
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      answeredCount,
      // Distribute idea count across completed sessions (first session gets all for now)
      ideasExtracted: r.status === 'completed' && i === 0 ? Number(totalIdeas) : null,
      transcript: r.transcriptMarkdown ?? null,
      shareUrl: r.shareToken ? `${appUrl}/interview/${r.shareToken}` : null,
    };
  });

  return NextResponse.json({ sessions });
}
