import { db } from '@/lib/db';
import { vaultAssets, vaultNotes } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { upsertVaultNote } from './notes';

type Asset = typeof vaultAssets.$inferSelect;

// Cheap heuristic tagger: derives starter tags from the filename + mime type.
// Real vision tagging can be plugged into lib/agents/visual-librarian.ts later;
// this needs no external API key.
export function heuristicTagsFromFilename(filename: string, mimeType: string): {
  tags: string[];
  visualStyle: string;
  status: 'ready' | 'needs_review';
} {
  const base = filename.toLowerCase();
  const tags = new Set<string>();
  let visualStyle = 'photo';

  const matches: Array<[RegExp, string, string?]> = [
    [/screenshot|screen-shot|screen_shot|screencap/, 'screenshot', 'screenshot'],
    [/chart|graph|plot/, 'chart', 'chart'],
    [/diagram|flow|whiteboard/, 'diagram', 'diagram'],
    [/meme/, 'meme', 'meme'],
    [/logo|brandmark|brand-asset|wordmark/, 'brand', 'brand-asset'],
    [/headshot|profile|avatar|portrait/, 'portrait', 'photo'],
    [/team|group|together/, 'team', 'photo'],
    [/desk|workspace|laptop|monitor|setup/, 'workspace', 'photo'],
    [/whiteboard|sketch/, 'sketch', 'diagram'],
    [/dashboard|metric|stat/, 'dashboard', 'screenshot'],
    [/quote/, 'quote', 'graphic'],
  ];

  for (const [re, tag, style] of matches) {
    if (re.test(base)) {
      tags.add(tag);
      if (style) visualStyle = style;
    }
  }
  if (mimeType.startsWith('image/')) tags.add('image');

  // If no informative tag emerged, mark needs_review so the user knows to add
  // their own. Otherwise it's safe to mark ready.
  const status: 'ready' | 'needs_review' = tags.size <= 1 ? 'needs_review' : 'ready';

  return { tags: [...tags], visualStyle, status };
}

// Persist a visual note that mirrors a freshly-uploaded asset.
export async function createVisualNoteForAsset(opts: {
  userId: string;
  brandId: string;
  asset: Asset;
}): Promise<string> {
  const { asset } = opts;
  const noteId = await upsertVaultNote({
    userId: opts.userId,
    brandId: opts.brandId,
    path: `50-visuals/images/${asset.id}.md`,
    title: asset.originalFilename,
    type: 'visual',
    tags: asset.tags ?? [],
    topics: asset.topics ?? [],
    summary: asset.captionSummary ?? `Uploaded asset ${asset.originalFilename}`,
    body: [
      `# ${asset.originalFilename}`,
      '',
      asset.captionSummary ?? '',
      '',
      '## Best use',
      asset.usableFor?.length ? asset.usableFor.map(u => `- ${u}`).join('\n') : '_Add cases this image fits best._',
    ].join('\n'),
    source: 'upload',
    status: asset.status === 'needs_review' ? 'needs_review' : 'active',
    frontmatter: {
      asset_id: asset.id,
      file_url: asset.fileUrl,
      mime_type: asset.mimeType,
      visual_style: asset.visualStyle ?? null,
      sensitivity: asset.sensitivity,
      width: asset.width ?? null,
      height: asset.height ?? null,
    },
    sourceRefType: 'asset',
    sourceRefId: asset.id,
  });
  // Backlink: asset.noteId
  await db.update(vaultAssets)
    .set({ noteId, updatedAt: new Date() })
    .where(eq(vaultAssets.id, asset.id));
  return noteId;
}

// Bump lastUsedAt so the visual selector can avoid repeats.
export async function markAssetUsed(assetId: string): Promise<void> {
  await db.update(vaultAssets)
    .set({ lastUsedAt: new Date() })
    .where(eq(vaultAssets.id, assetId));
  // touch to silence unused-import warning
  void and; void sql; void vaultNotes;
}
