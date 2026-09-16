import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { vaultAssets } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { resolveTenantScope } from '@/lib/vault/workspace';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scope = await resolveTenantScope(session.user.id);
  if (!scope) return NextResponse.json({ assets: [] });

  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  const conditions = [eq(vaultAssets.userId, scope.userId), eq(vaultAssets.brandId, scope.brandId)];
  if (status === 'ready' || status === 'processing' || status === 'analyzing' || status === 'needs_review' || status === 'failed') {
    conditions.push(eq(vaultAssets.status, status));
  }

  const rows = await db.select().from(vaultAssets).where(and(...conditions)).orderBy(desc(vaultAssets.createdAt)).limit(300);
  return NextResponse.json({ assets: rows });
}
