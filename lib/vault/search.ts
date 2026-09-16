import { db } from '@/lib/db';
import { vaultNotes, vaultAssets } from '@/lib/db/schema';
import { and, eq, ne, desc } from 'drizzle-orm';

type Note = typeof vaultNotes.$inferSelect;
type Asset = typeof vaultAssets.$inferSelect;

export interface ScoredNote {
  note: Note;
  score: number;
  reason: string;
}

export interface ScoredAsset {
  asset: Asset;
  score: number;
  reason: string;
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

const STOPWORDS = new Set([
  'the','and','for','that','this','with','from','have','will','what','about','your','they','our','are','was','were','can','but','out','into','more','very','just','than','some','one','any','its','his','her','their','also','only','been','because','then','when','how','who','why','where','which','these','those','here','there',
]);

const POSITIVE_VISUAL_HINTS = [
  'image','picture','photo','screenshot','chart','diagram','meme','graphic','visual','illustration',
];

// Light keyword/tag scoring against the topic text.
function scoreOverlap(needle: string[], pool: string[] | null | undefined): number {
  if (!pool?.length) return 0;
  let s = 0;
  const haystack = new Set(pool.map(t => t.toLowerCase()));
  for (const tok of needle) {
    if (haystack.has(tok)) s += 1.0;
  }
  // partial: substring match in any tag
  for (const tok of needle) {
    for (const tag of haystack) {
      if (tag.includes(tok) || tok.includes(tag)) {
        if (tag !== tok) s += 0.3;
      }
    }
  }
  return s;
}

function scoreText(needle: string[], text: string | null | undefined): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let s = 0;
  for (const tok of needle) {
    if (lower.includes(tok)) s += 0.5;
  }
  return s;
}

function matchesBlockedUse(tokens: string[], topic: string, blocked: string[] | null | undefined): boolean {
  if (!blocked?.length) return false;
  const topicLower = topic.toLowerCase();
  for (const raw of blocked) {
    const value = raw.trim().toLowerCase();
    if (!value) continue;
    if (topicLower.includes(value)) return true;
    const blockedTokens = tokenize(value);
    if (blockedTokens.some(tok => tokens.includes(tok))) return true;
  }
  return false;
}

export interface SelectedNotesContext {
  globalRules: Note[];    // shared Lore rules, safe to apply to every tenant
  rules: Note[];          // tenant-specific rules, same tenant only
  selected: ScoredNote[];  // top-N relevant tenant notes
}

// Pulls vault context for a post-generation pass.
// - Always loads tenant "rule" notes (active).
// - Searches other notes by tag/topic/summary text overlap with the topic.
export async function loadVaultContext(opts: {
  userId: string;
  brandId: string;
  topic: string;
  limit?: number;
}): Promise<SelectedNotesContext> {
  const { userId, brandId, topic, limit = 6 } = opts;

  // Global rules are shared platform knowledge. Tenant rows are filtered by both
  // user and brand so local memory never flows sideways into another tenant.
  const [globalRules, rows] = await Promise.all([
    db
      .select()
      .from(vaultNotes)
      .where(and(
        eq(vaultNotes.scope, 'global'),
        eq(vaultNotes.type, 'rule'),
        eq(vaultNotes.status, 'active'),
      ))
      .orderBy(desc(vaultNotes.updatedAt))
      .limit(80),
    db
      .select()
      .from(vaultNotes)
      .where(and(
        eq(vaultNotes.scope, 'tenant'),
        eq(vaultNotes.userId, userId),
        eq(vaultNotes.brandId, brandId),
        eq(vaultNotes.status, 'active'),
      ))
      .orderBy(desc(vaultNotes.updatedAt)),
  ]);

  const rules = rows.filter(r => r.type === 'rule');
  const candidates = rows.filter(r => r.type !== 'rule' && r.type !== 'visual');

  const tokens = tokenize(topic);
  const scored: ScoredNote[] = candidates.map(note => {
    const tagScore = scoreOverlap(tokens, note.tags);
    const topicScore = scoreOverlap(tokens, note.topics);
    const titleScore = scoreText(tokens, note.title) * 1.2;
    const summaryScore = scoreText(tokens, note.summary) * 0.8;
    const bodyScore = scoreText(tokens, note.body) * 0.3;
    const score = tagScore * 2 + topicScore * 1.5 + titleScore + summaryScore + bodyScore;
    const reason = [
      tagScore > 0 ? `tag-match` : null,
      topicScore > 0 ? `topic-match` : null,
      titleScore > 0 ? `title-keyword` : null,
    ].filter(Boolean).join(', ') || 'recent';
    return { note, score, reason };
  });

  scored.sort((a, b) => b.score - a.score || +b.note.updatedAt - +a.note.updatedAt);

  // If nothing scored, fall back to recency so the agent at least sees the
  // newest stories/proofs/ideas the brand has.
  const top = scored.filter(s => s.score > 0).slice(0, limit);
  if (top.length === 0) {
    return {
      globalRules,
      rules,
      selected: candidates.slice(0, limit).map(note => ({ note, score: 0, reason: 'recency-fallback' })),
    };
  }
  return { globalRules, rules, selected: top };
}

// Pick 0-N visual assets for a post topic. Deterministic tag scoring.
export async function selectVisualsForPost(opts: {
  userId: string;
  brandId: string;
  topic: string;
  max?: number;
  hintsRequested?: boolean;  // user asked for a visual
}): Promise<ScoredAsset[]> {
  const { userId, brandId, topic, max = 1, hintsRequested = false } = opts;

  const rows = await db
    .select()
    .from(vaultAssets)
    .where(and(
      eq(vaultAssets.userId, userId),
      eq(vaultAssets.brandId, brandId),
      eq(vaultAssets.status, 'ready'),
      eq(vaultAssets.sensitivity, 'safe'),
      ne(vaultAssets.sensitivity, 'needs_review'),
    ))
    .orderBy(desc(vaultAssets.createdAt))
    .limit(120);

  if (!rows.length) return [];

  const tokens = tokenize(topic);
  const topicWantsVisual = hintsRequested
    || POSITIVE_VISUAL_HINTS.some(h => topic.toLowerCase().includes(h));

  const scored = rows
    .filter(asset => !matchesBlockedUse(tokens, topic, asset.doNotUseFor))
    .map(asset => {
    const tagScore = scoreOverlap(tokens, asset.tags);
    const topicScore = scoreOverlap(tokens, asset.topics);
    const usableScore = scoreOverlap(tokens, asset.usableFor);
    const captionScore = scoreText(tokens, asset.captionSummary) * 0.6;
    const styleBonus = asset.visualStyle ? 0.2 : 0;
    const score = tagScore * 2 + topicScore * 1.5 + usableScore + captionScore + styleBonus;
    return {
      asset,
      score,
      reason: [
        tagScore > 0 ? 'tag-match' : null,
        topicScore > 0 ? 'topic-match' : null,
        usableScore > 0 ? 'usable-for-match' : null,
      ].filter(Boolean).join(', ') || 'available',
    };
    });

  scored.sort((a, b) => b.score - a.score);

  // Threshold: require a positive score unless the user explicitly asked for a visual.
  // Filter out images used in the last 14 days to avoid repeat fatigue.
  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const filtered = scored.filter(s => {
    if (s.score <= 0 && !topicWantsVisual) return false;
    if (s.asset.lastUsedAt && +new Date(s.asset.lastUsedAt) > fourteenDaysAgo) return false;
    return true;
  });

  return filtered.slice(0, max);
}

// Build a compact "Sources Lore pulled from" string for prompt injection.
export function formatVaultContextForPrompt(ctx: SelectedNotesContext): string {
  const parts: string[] = [];

  if (ctx.globalRules.length > 0) {
    const globalLines = ctx.globalRules.map(r => {
      const summary = r.summary ?? r.body?.split('\n').filter(Boolean).slice(0, 2).join(' ') ?? r.title;
      return `- ${r.title}: ${summary.slice(0, 220).replace(/\n/g, ' ')}`;
    }).join('\n');
    parts.push(`## Global Lore rules — shared platform rules, safe for every tenant\n${globalLines}`);
  }

  if (ctx.rules.length > 0) {
    const rulesLines = ctx.rules.map(r => {
      const summary = r.summary ?? r.body?.split('\n').filter(Boolean).slice(0, 2).join(' ') ?? r.title;
      return `- ${r.title}: ${summary.slice(0, 220).replace(/\n/g, ' ')}`;
    }).join('\n');
    parts.push(`## Tenant vault rules — apply alongside global rules\n${rulesLines}`);
  }

  if (ctx.selected.length > 0) {
    const lines = ctx.selected.map(({ note, reason }) => {
      const head = `### [${note.type}] ${note.title}`;
      const tagLine = note.tags?.length ? `tags: ${note.tags.slice(0, 6).join(', ')}` : '';
      const summary = note.summary ?? note.body?.slice(0, 300) ?? '';
      return [head, tagLine, summary.trim(), `(matched via ${reason})`]
        .filter(Boolean)
        .join('\n');
    }).join('\n\n');
    parts.push(`## Vault notes Lore pulled from\nThese are the source notes that match this topic. Cite specifics from them. Do not invent details that are not in these notes.\n\n${lines}`);
  }

  return parts.join('\n\n');
}
