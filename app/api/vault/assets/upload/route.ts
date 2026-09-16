import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { vaultAssets } from '@/lib/db/schema';
import { resolveTenantScope } from '@/lib/vault/workspace';
import { storeFile } from '@/lib/vault/storage';
import { processAsset } from '@/lib/agents/visual-librarian';

export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024;       // 8 MB per file
const MAX_FILES = 30;                    // per upload batch
const ALLOWED = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'];

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scope = await resolveTenantScope(session.user.id);
  if (!scope) return NextResponse.json({ error: 'No active brand' }, { status: 400 });

  let form: FormData;
  try { form = await req.formData(); } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const files = form.getAll('files');
  if (!files.length) return NextResponse.json({ error: 'No files' }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `Max ${MAX_FILES} files per upload` }, { status: 400 });

  const uploadSource = (form.get('source') as string) || 'upload';

  const results: Array<{ id: string; filename: string; fileUrl: string; status: string }> = [];
  for (const f of files) {
    if (!(f instanceof File)) continue;
    if (!ALLOWED.includes(f.type)) {
      // Skip silently, better UX than failing the whole batch
      continue;
    }
    if (f.size > MAX_BYTES) continue;
    const buffer = Buffer.from(await f.arrayBuffer());
    const { storageKey, fileUrl, fileSize } = await storeFile({ brandId: scope.brandId, buffer, filename: f.name || 'upload' });

    const [row] = await db.insert(vaultAssets).values({
      userId: scope.userId,
      brandId: scope.brandId,
      originalFilename: f.name || 'upload',
      storageKey,
      fileUrl,
      mimeType: f.type,
      fileSize,
      status: 'processing',
      uploadSource,
    }).returning({ id: vaultAssets.id });

    // Fire-and-forget tagging. The UI will refetch and see the ready/needs_review status.
    processAsset({ userId: scope.userId, brandId: scope.brandId, assetId: row.id }).catch(() => {});
    results.push({ id: row.id, filename: f.name || 'upload', fileUrl, status: 'processing' });
  }

  return NextResponse.json({ uploaded: results.length, assets: results });
}
