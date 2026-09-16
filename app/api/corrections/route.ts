import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { corrections } from '@/lib/db/schema';

import { mirrorSelfLearningIntoVault } from '@/lib/vault/sync';
import { getActiveBrandId } from '@/lib/active-brand';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  const context = typeof body?.context === 'string' ? body.context.trim() : null;

  if (!note) return NextResponse.json({ error: 'note is required' }, { status: 400 });

  // Cookie-backed active brand, not "newest active brand". The latter wrote
  // corrections to the wrong brand on multi-brand (agency) accounts.
  const activeBrandId = await getActiveBrandId(session.user.id);
  if (!activeBrandId) return NextResponse.json({ error: 'No brand found' }, { status: 404 });
  const brand = { id: activeBrandId };

  const [inserted] = await db
    .insert(corrections)
    .values({ brandId: brand.id, note, context: context || null })
    .returning({ id: corrections.id });

  // Best-effort: mirror the new correction into the tenant vault so the Vault
  // reflects learning without a manual sync. Tenant scope is enforced inside
  // the helper. A failure here must never break the correction request.
  await mirrorSelfLearningIntoVault({ userId: session.user.id, brandId: brand.id }).catch(() => {});

  // Fire-and-forget: re-synthesize voice doc with new correction
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? '';
  if (appUrl) {
    fetch(`${appUrl}/api/cron/consolidate-skills`, {
      method: 'POST',
      headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '', 'Content-Type': 'application/json' },
      // Scope re-synthesis to this brand. An empty body re-ran EVERY brand.
      body: JSON.stringify({ brandId: brand.id }),
    }).catch(() => {});
  }

  return NextResponse.json({ id: inserted.id }, { status: 201 });
}
