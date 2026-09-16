import { NextRequest, NextResponse, after } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getActiveBrandId } from '@/lib/active-brand';
import { scoreUnscoredNewsForBrand } from '@/lib/score-news-for-brand';
import { z } from 'zod';

const Schema = z.object({
  mainstreamNewsEnabled: z.boolean(),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const brandId = await getActiveBrandId(session.user.id);
  if (!brandId) return NextResponse.json({ error: 'No active brand' }, { status: 404 });

  await db
    .update(brands)
    .set({ mainstreamNewsEnabled: parsed.data.mainstreamNewsEnabled, updatedAt: new Date() })
    .where(and(eq(brands.id, brandId), eq(brands.userId, session.user.id)));

  // When the toggle flips ON, kick off an immediate scoring pass so the user
  // sees news cards in their pulse within a minute or two, instead of waiting
  // up to 3 hours for the next cron. Runs in `after()` so the response returns
  // immediately and the scoring continues server-side.
  if (parsed.data.mainstreamNewsEnabled) {
    after(async () => {
      try {
        const result = await scoreUnscoredNewsForBrand(brandId, { maxItems: 30 });
        console.log(`[mainstream-news] initial scoring for brand ${brandId}:`, result);
      } catch (err) {
        console.error(`[mainstream-news] initial scoring failed for brand ${brandId}:`, err instanceof Error ? err.message : err);
      }
    });
  }

  return NextResponse.json({ ok: true, mainstreamNewsEnabled: parsed.data.mainstreamNewsEnabled });
}
