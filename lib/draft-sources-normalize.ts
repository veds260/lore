// Pure draft-source normalization.
//
// Split out from lib/draft-sources.ts (which pulls in the DB) so this logic can
// be unit-tested with node:test in isolation: no DB, no `@/` imports.
// lib/draft-sources.ts re-exports these so existing import paths keep working.

export interface DraftSourceInput {
  noteId?: string | null;
  assetId?: string | null;
  reason?: string | null;
  relevanceScore?: number | null;
}

export interface DraftSourceRow {
  noteId: string | null;
  assetId: string | null;
  reason: string | null;
  relevanceScore: number | null;
}

// Validate shape, dedupe (noteId, assetId) pairs, and drop rows that reference
// neither a note nor an asset (or both). Returns rows ready to scope-check
// before insertion. Kept pure so it's covered by node:test without a DB.
export function normalizeDraftSourceInputs(
  inputs: unknown,
  opts: { maxRows?: number } = {},
): DraftSourceRow[] {
  if (!Array.isArray(inputs)) return [];
  const maxRows = opts.maxRows ?? 24;

  const seen = new Set<string>();
  const rows: DraftSourceRow[] = [];

  for (const raw of inputs) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;

    const noteId = typeof obj.noteId === 'string' && obj.noteId.length > 0 ? obj.noteId : null;
    const assetId = typeof obj.assetId === 'string' && obj.assetId.length > 0 ? obj.assetId : null;
    if (!noteId && !assetId) continue;
    if (noteId && assetId) continue; // a row references one or the other, not both

    const key = `${noteId ?? ''}::${assetId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const reason = typeof obj.reason === 'string' ? obj.reason.slice(0, 240) : null;
    const relRaw = typeof obj.relevanceScore === 'number' ? obj.relevanceScore : null;
    const relevanceScore =
      relRaw !== null && Number.isFinite(relRaw) ? Math.max(0, Math.min(100, relRaw)) : null;

    rows.push({ noteId, assetId, reason, relevanceScore });
    if (rows.length >= maxRows) break;
  }

  return rows;
}
