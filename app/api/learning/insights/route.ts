import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getActiveBrandId } from '@/lib/active-brand';
import { getInsightsForBrand } from '@/lib/learning-insights';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const brandId = await getActiveBrandId(session.user.id);
  if (!brandId) return NextResponse.json({ error: 'No brand' }, { status: 404 });

  const data = await getInsightsForBrand(brandId);
  if (!data) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  return NextResponse.json(data);
}
