import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { drafts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { fetchDraftSourcesForDraft } from '@/lib/draft-sources';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (id.startsWith('demo-') || id.startsWith('temp-')) {
    return NextResponse.json({ sources: [] });
  }

  const [draft] = await db
    .select({ id: drafts.id, brandId: drafts.brandId })
    .from(drafts)
    .where(and(eq(drafts.id, id), eq(drafts.userId, session.user.id)))
    .limit(1);

  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });

  const sources = await fetchDraftSourcesForDraft({
    draftId: draft.id,
    userId: session.user.id,
    brandId: draft.brandId,
  });

  return NextResponse.json({ sources: sources ?? [] });
}
