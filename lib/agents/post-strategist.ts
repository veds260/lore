import { loadVaultContext, selectVisualsForPost, formatVaultContextForPrompt } from '@/lib/vault/search';
import type { SelectedNotesContext, ScoredAsset } from '@/lib/vault/search';
import type { DraftSourceInput } from '@/lib/draft-sources';

// Binds vault retrieval into one object the prompt builder can consume. No LLM
// call here, the search and tag matching is deterministic.

export interface PostStrategy {
  context: SelectedNotesContext;
  visuals: ScoredAsset[];
  promptBlock: string;     // ready-to-inject context block
}

export async function planPost(opts: {
  userId: string;
  brandId: string;
  topic: string;
  noteLimit?: number;
  maxVisuals?: number;
  visualHint?: boolean;
}): Promise<PostStrategy> {
  const context = await loadVaultContext({
    userId: opts.userId,
    brandId: opts.brandId,
    topic: opts.topic,
    limit: opts.noteLimit ?? 6,
  });

  const visuals = await selectVisualsForPost({
    userId: opts.userId,
    brandId: opts.brandId,
    topic: opts.topic,
    max: opts.maxVisuals ?? 1,
    hintsRequested: opts.visualHint ?? false,
  });

  const promptBlock = formatVaultContextForPrompt(context);
  return { context, visuals, promptBlock };
}

export function buildDraftSourceInputs(strategy: PostStrategy): DraftSourceInput[] {
  const rows: DraftSourceInput[] = [];
  for (const s of strategy.context.selected) {
    rows.push({ noteId: s.note.id, reason: s.reason, relevanceScore: s.score });
  }
  for (const v of strategy.visuals) {
    rows.push({ assetId: v.asset.id, reason: v.reason, relevanceScore: v.score });
  }
  return rows;
}
