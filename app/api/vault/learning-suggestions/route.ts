import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { drafts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { appendTenantLearningObservation, resolveTenantScope } from '@/lib/vault/workspace';
import type { LearningSuggestion } from '@/lib/learning/edit-preferences';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scope = await resolveTenantScope(session.user.id);
  if (!scope) return NextResponse.json({ error: 'No active brand' }, { status: 400 });

  const body = await req.json().catch(() => ({})) as {
    draftId?: string | null;
    suggestion?: Partial<LearningSuggestion> | null;
  };

  const suggestion = body.suggestion;
  const observation = typeof suggestion?.observation === 'string' ? suggestion.observation.trim() : '';
  if (!observation) return NextResponse.json({ error: 'suggestion.observation required' }, { status: 400 });

  let sourceEvent = 'revision';
  if (body.draftId) {
    const [owned] = await db
      .select({ id: drafts.id })
      .from(drafts)
      .where(and(
        eq(drafts.id, body.draftId),
        eq(drafts.userId, scope.userId),
        eq(drafts.brandId, scope.brandId),
      ))
      .limit(1);
    if (!owned) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    sourceEvent = `draft:${owned.id}`;
  }

  const title = typeof suggestion?.title === 'string' && suggestion.title.trim()
    ? suggestion.title.trim()
    : 'Saved edit preference';
  const reason = typeof suggestion?.reason === 'string' ? suggestion.reason : 'edit-feedback';
  const confidence = typeof suggestion?.confidence === 'number' ? suggestion.confidence : null;
  const fullObservation = [
    title,
    observation,
    confidence !== null ? `Confidence: ${Math.round(confidence * 100)}%` : null,
    `Source: ${reason}`,
  ].filter(Boolean).join('\n\n');

  const noteId = await appendTenantLearningObservation(scope, fullObservation, sourceEvent);
  return NextResponse.json({ ok: true, noteId });
}
