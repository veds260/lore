import { db } from '@/lib/db';
import { drafts, draftSources, vaultNotes, vaultAssets } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import {
  normalizeDraftSourceInputs,
  type DraftSourceInput,
  type DraftSourceRow,
} from '@/lib/draft-sources-normalize';

// Re-export the pure normalization helper + types so existing import sites
// (`@/lib/draft-sources`) keep working. The implementation lives in
// lib/draft-sources-normalize.ts so it can be unit-tested without the DB.
export { normalizeDraftSourceInputs };
export type { DraftSourceInput, DraftSourceRow };

// DB-bound helper: insert draft_sources after confirming each referenced note
// and asset actually belongs to the same user + brand. Anything that doesn't
// scope-match is silently dropped so a malicious payload can never link to
// another tenant's vault rows.
export async function recordDraftSources(opts: {
  draftId: string;
  userId: string;
  brandId: string;
  inputs: DraftSourceInput[];
  replaceExisting?: boolean;
}): Promise<{ inserted: number; dropped: number }> {
  const normalized = normalizeDraftSourceInputs(opts.inputs);

  if (opts.replaceExisting) {
    await db.delete(draftSources).where(eq(draftSources.draftId, opts.draftId));
  }

  if (normalized.length === 0) return { inserted: 0, dropped: 0 };

  const noteIds = normalized.map(r => r.noteId).filter((v): v is string => !!v);
  const assetIds = normalized.map(r => r.assetId).filter((v): v is string => !!v);

  const [ownedNotes, ownedAssets] = await Promise.all([
    noteIds.length
      ? db
          .select({ id: vaultNotes.id })
          .from(vaultNotes)
          .where(and(
            inArray(vaultNotes.id, noteIds),
            eq(vaultNotes.userId, opts.userId),
            eq(vaultNotes.brandId, opts.brandId),
          ))
      : Promise.resolve([] as Array<{ id: string }>),
    assetIds.length
      ? db
          .select({ id: vaultAssets.id })
          .from(vaultAssets)
          .where(and(
            inArray(vaultAssets.id, assetIds),
            eq(vaultAssets.userId, opts.userId),
            eq(vaultAssets.brandId, opts.brandId),
          ))
      : Promise.resolve([] as Array<{ id: string }>),
  ]);

  const noteOk = new Set(ownedNotes.map(n => n.id));
  const assetOk = new Set(ownedAssets.map(a => a.id));

  const rows = normalized.filter(r =>
    (r.noteId ? noteOk.has(r.noteId) : false) ||
    (r.assetId ? assetOk.has(r.assetId) : false),
  );

  if (rows.length === 0) return { inserted: 0, dropped: normalized.length };

  await db.insert(draftSources).values(rows.map(r => ({
    draftId: opts.draftId,
    noteId: r.noteId ?? null,
    assetId: r.assetId ?? null,
    reason: r.reason,
    relevanceScore: r.relevanceScore,
  })));

  // Best-effort: mark the linked assets as used so the visual rotation knows
  // they were just attached. Only the asset IDs that already passed the
  // userId + brandId scope check above are touched.
  const linkedAssetIds = rows.map(r => r.assetId).filter((v): v is string => !!v);
  if (linkedAssetIds.length > 0) {
    await markAssetsUsed({
      assetIds: linkedAssetIds,
      userId: opts.userId,
      brandId: opts.brandId,
    }).catch(() => {});
  }

  return { inserted: rows.length, dropped: normalized.length - rows.length };
}

// Best-effort usage stamp for vault assets attached to a draft. Sets
// lastUsedAt for the current time. The WHERE clause re-applies the
// userId + brandId scope so an asset is never touched outside its tenant,
// even if a caller passes an ID it didn't scope-check first.
// Note: vault_assets has no usedCount column, so only lastUsedAt is updated.
export async function markAssetsUsed(opts: {
  assetIds: string[];
  userId: string;
  brandId: string;
}): Promise<void> {
  const ids = Array.from(new Set(opts.assetIds.filter(Boolean)));
  if (ids.length === 0) return;

  await db
    .update(vaultAssets)
    .set({ lastUsedAt: new Date() })
    .where(and(
      inArray(vaultAssets.id, ids),
      eq(vaultAssets.userId, opts.userId),
      eq(vaultAssets.brandId, opts.brandId),
    ));
}

export interface DraftSourceRecord {
  id: string;
  kind: 'note' | 'asset';
  title: string;
  subtitle: string | null;
  reason: string | null;
  relevanceScore: number | null;
  noteType?: string | null;
  assetUrl?: string | null;
  thumbnailUrl?: string | null;
}

// Returns the sources used in a draft, verifying the draft belongs to the
// caller and to the active brand before any join is even attempted. Returns
// null when the draft is not found / not owned so the route can 404.
export async function fetchDraftSourcesForDraft(opts: {
  draftId: string;
  userId: string;
  brandId: string;
}): Promise<DraftSourceRecord[] | null> {
  const [owned] = await db
    .select({ id: drafts.id })
    .from(drafts)
    .where(and(
      eq(drafts.id, opts.draftId),
      eq(drafts.userId, opts.userId),
      eq(drafts.brandId, opts.brandId),
    ))
    .limit(1);
  if (!owned) return null;

  const noteRows = await db
    .select({
      id: draftSources.id,
      reason: draftSources.reason,
      relevanceScore: draftSources.relevanceScore,
      noteId: vaultNotes.id,
      title: vaultNotes.title,
      summary: vaultNotes.summary,
      type: vaultNotes.type,
    })
    .from(draftSources)
    .innerJoin(vaultNotes, eq(draftSources.noteId, vaultNotes.id))
    .where(and(
      eq(draftSources.draftId, opts.draftId),
      eq(vaultNotes.userId, opts.userId),
      eq(vaultNotes.brandId, opts.brandId),
    ));

  const assetRows = await db
    .select({
      id: draftSources.id,
      reason: draftSources.reason,
      relevanceScore: draftSources.relevanceScore,
      assetId: vaultAssets.id,
      filename: vaultAssets.originalFilename,
      caption: vaultAssets.captionSummary,
      fileUrl: vaultAssets.fileUrl,
      thumbnailUrl: vaultAssets.thumbnailUrl,
    })
    .from(draftSources)
    .innerJoin(vaultAssets, eq(draftSources.assetId, vaultAssets.id))
    .where(and(
      eq(draftSources.draftId, opts.draftId),
      eq(vaultAssets.userId, opts.userId),
      eq(vaultAssets.brandId, opts.brandId),
    ));

  const out: DraftSourceRecord[] = [];
  for (const r of noteRows) {
    out.push({
      id: r.id,
      kind: 'note',
      title: r.title,
      subtitle: r.summary,
      reason: r.reason,
      relevanceScore: r.relevanceScore,
      noteType: r.type,
    });
  }
  for (const r of assetRows) {
    out.push({
      id: r.id,
      kind: 'asset',
      title: r.filename,
      subtitle: r.caption,
      reason: r.reason,
      relevanceScore: r.relevanceScore,
      assetUrl: r.fileUrl,
      thumbnailUrl: r.thumbnailUrl,
    });
  }
  return out;
}
