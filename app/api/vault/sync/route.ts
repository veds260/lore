import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getActiveBrandId } from '@/lib/active-brand';
import { mirrorSelfLearningIntoVault } from '@/lib/vault/sync';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const brandId = await getActiveBrandId(session.user.id);
  if (!brandId) return NextResponse.json({ error: 'No active brand' }, { status: 400 });

  const result = await mirrorSelfLearningIntoVault({ userId: session.user.id, brandId });
  return NextResponse.json({ ok: true, ...result });
}
