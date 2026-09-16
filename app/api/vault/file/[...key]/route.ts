import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { vaultAssets } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { readStoredFile } from '@/lib/vault/storage';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { key: parts } = await params;
  const storageKey = parts.join('/');
  if (!storageKey) return NextResponse.json({ error: 'No key' }, { status: 400 });

  // Authorize: the asset must belong to this user.
  const [asset] = await db.select({ mimeType: vaultAssets.mimeType, userId: vaultAssets.userId })
    .from(vaultAssets)
    .where(and(eq(vaultAssets.storageKey, storageKey), eq(vaultAssets.userId, session.user.id)))
    .limit(1);
  if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const buf = await readStoredFile(storageKey);
  if (!buf) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Use a Uint8Array view to satisfy the BodyInit type
  const body = new Uint8Array(buf);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': asset.mimeType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
