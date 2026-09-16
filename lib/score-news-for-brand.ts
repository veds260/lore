// Per-brand smart news scorer. Calls a single Flash judge to score each
// unscored news item against the brand's profile, returning a relevance +
// virality score and a suggested angle.
//
// This is intentionally NOT a hardcoded entity-list filter. The judge reads
// the brand's niche, pillars, and audience description and decides relevance
// per-brand. A "Sam Altman launches X" story scores high for an AI/founder
// brand and low for a fashion brand, without any keyword config.

import { db } from './db';
import { mainstreamNewsItems, brandNewsScores, brands } from './db/schema';
import { eq, and, sql, notInArray, gte, desc } from 'drizzle-orm';
import { callAI, parseJSON, MODEL_EXTRACT } from './ai';
import { SHORT_TEXT_BANS } from './craft-rules';
import { recordCost } from './credits';

interface ScoreResult {
  relevance_score: number;
  virality_score: number;
  suggested_angle?: string | null;
  named_figure?: string | null;
  hard_number?: string | null;
  skip_reason?: string | null;
}

interface BrandContext {
  id: string;
  userId: string;
  name: string;
  niche: string | null;
  voiceSummary: string | null;
  briefMd: string | null;
  contentPillars: string[];
}

// Score up to N latest unscored items for one brand. Returns count scored.
export async function scoreUnscoredNewsForBrand(brandId: string, opts: { maxItems?: number } = {}): Promise<{ scored: number; skipped: number }> {
  const max = opts.maxItems ?? 30;

  const [brand] = await db
    .select({
      id: brands.id,
      userId: brands.userId,
      name: brands.name,
      niche: brands.niche,
      voiceSummary: brands.voiceSummary,
      briefMd: brands.briefMd,
      contentPillars: brands.contentPillars,
    })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);

  if (!brand) return { scored: 0, skipped: 0 };

  // Find news items we haven't scored for THIS brand yet.
  const alreadyScored = await db
    .select({ newsItemId: brandNewsScores.newsItemId })
    .from(brandNewsScores)
    .where(eq(brandNewsScores.brandId, brandId));
  const scoredIds = alreadyScored.map(r => r.newsItemId);

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const items = await db
    .select({
      id: mainstreamNewsItems.id,
      source: mainstreamNewsItems.source,
      title: mainstreamNewsItems.title,
      summary: mainstreamNewsItems.summary,
      publishedAt: mainstreamNewsItems.publishedAt,
    })
    .from(mainstreamNewsItems)
    .where(
      and(
        gte(mainstreamNewsItems.fetchedAt, since),
        scoredIds.length > 0 ? notInArray(mainstreamNewsItems.id, scoredIds) : undefined,
      ),
    )
    .orderBy(desc(mainstreamNewsItems.publishedAt))
    .limit(max);

  if (items.length === 0) return { scored: 0, skipped: 0 };

  const brandCtx: BrandContext = {
    id: brand.id,
    userId: brand.userId,
    name: brand.name,
    niche: brand.niche,
    voiceSummary: brand.voiceSummary,
    briefMd: brand.briefMd,
    contentPillars: brand.contentPillars ?? [],
  };

  // Chunked concurrency: 5 at a time keeps us under OpenRouter rate limits and
  // Railway's resource ceiling, while still being ~6x faster than fully sequential.
  // Inserts happen as each chunk completes so partial progress survives if the
  // function is killed mid-run.
  const CHUNK_SIZE = 5;
  let scored = 0;
  let skipped = 0;

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.allSettled(chunk.map(async (item) => {
      const result = await scoreItem(item, brandCtx);
      if (!result) return { item, ok: false };
      const combined = result.relevance_score * 0.6 + result.virality_score * 0.4;
      try {
        await db.insert(brandNewsScores).values({
          brandId,
          newsItemId: item.id,
          relevanceScore: clamp(result.relevance_score, 0, 10),
          viralityScore: clamp(result.virality_score, 0, 10),
          combinedScore: combined,
          suggestedAngle: result.suggested_angle ?? null,
          skipReason: result.skip_reason ?? null,
        }).onConflictDoNothing({ target: [brandNewsScores.brandId, brandNewsScores.newsItemId] });
        recordCost(brand.userId, 'mainstream_ingest', { brandId, itemId: item.id }).catch(() => {});
        return { item, ok: true };
      } catch (err) {
        console.error('[score-news] insert failed:', err instanceof Error ? err.message : err);
        return { item, ok: false };
      }
    }));
    for (const r of chunkResults) {
      if (r.status === 'fulfilled' && r.value.ok) scored++;
      else skipped++;
    }
  }

  return { scored, skipped };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

async function scoreItem(
  item: { id: string; source: string; title: string; summary: string | null; publishedAt: Date | null },
  brand: BrandContext,
): Promise<ScoreResult | null> {
  const ageHours = item.publishedAt ? Math.max(0, (Date.now() - item.publishedAt.getTime()) / 3.6e6) : 168;
  const brief = brand.briefMd?.slice(0, 1200) ?? '(no brief)';
  const pillars = brand.contentPillars.length > 0 ? brand.contentPillars.join(', ') : '(none set)';

  const prompt = `You are a news-curation judge for a content creator's LinkedIn workflow. Score whether THIS specific news item is worth surfacing to THIS specific brand.

## Brand context
Name: ${brand.name}
Niche: ${brand.niche ?? '(unknown)'}
Voice summary: ${brand.voiceSummary ?? '(none)'}
Content pillars: ${pillars}
Brief: ${brief}

## News item
Source: ${item.source}
Title: ${item.title}
${item.summary ? `Summary: ${item.summary.slice(0, 800)}` : ''}
Age: ${ageHours.toFixed(0)} hours old

## Your job
Score on two axes (0-10 integers):

1. relevance_score — how good a fit is this item for THIS brand specifically? Consider:
   - Does it touch their niche, pillars, or audience interests?
   - Would their audience care if the brand reacted to this?
   - Can the brand realistically have an interesting take on this?

2. virality_score — universal appeal of the item itself. Consider:
   - Is there a named famous figure (e.g. Sam Altman, Elon, OpenAI, Anthropic, big VCs, named founders)?
   - Is there a hard number, benchmark, dollar amount, or quantifiable result?
   - Is it recent (the fresher, the higher)?
   - Is it about a launch, raise, acquisition, fire, shutdown, or other concrete event?

Avoid: politics (US/UK/etc.), sports/entertainment unless directly culture-relevant, routine product releases with no named figure/number, items older than 10 days.

Also output:
- named_figure: the most important named person/company in the headline, or null
- hard_number: the key number, benchmark, or dollar figure, or null
- suggested_angle: ONE short sentence (under 25 words) suggesting how this brand could uniquely take on this story. Null if no good angle exists.
- skip_reason: if the item should be skipped entirely (politics, sports, off-brand), one short phrase. Null otherwise.

${SHORT_TEXT_BANS}

Return ONLY this JSON, no other text:
{"relevance_score": 0-10, "virality_score": 0-10, "named_figure": "..." | null, "hard_number": "..." | null, "suggested_angle": "..." | null, "skip_reason": "..." | null}`;

  try {
    const text = await callAI({ model: MODEL_EXTRACT, prompt, temperature: 0.1, maxTokens: 250 });
    const parsed = parseJSON<ScoreResult>(text);
    if (!parsed) return null;
    if (typeof parsed.relevance_score !== 'number' || typeof parsed.virality_score !== 'number') return null;
    return parsed;
  } catch (err) {
    console.error('[score-news] AI call failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// Get top N already-scored news items for a brand, ranked by combined score.
// Used by /api/trends to surface in the pulse.
export async function getTopScoredNewsForBrand(brandId: string, limit = 5, minScore = 4): Promise<Array<{
  itemId: string;
  source: string;
  title: string;
  summary: string | null;
  url: string;
  publishedAt: Date | null;
  relevanceScore: number;
  viralityScore: number;
  combinedScore: number;
  suggestedAngle: string | null;
}>> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      itemId: mainstreamNewsItems.id,
      source: mainstreamNewsItems.source,
      title: mainstreamNewsItems.title,
      summary: mainstreamNewsItems.summary,
      url: mainstreamNewsItems.url,
      publishedAt: mainstreamNewsItems.publishedAt,
      relevanceScore: brandNewsScores.relevanceScore,
      viralityScore: brandNewsScores.viralityScore,
      combinedScore: brandNewsScores.combinedScore,
      suggestedAngle: brandNewsScores.suggestedAngle,
    })
    .from(brandNewsScores)
    .innerJoin(mainstreamNewsItems, eq(mainstreamNewsItems.id, brandNewsScores.newsItemId))
    .where(
      and(
        eq(brandNewsScores.brandId, brandId),
        gte(mainstreamNewsItems.fetchedAt, since),
        sql`${brandNewsScores.combinedScore} >= ${minScore}`,
        sql`${brandNewsScores.skipReason} IS NULL`,
      ),
    )
    .orderBy(desc(brandNewsScores.combinedScore), desc(mainstreamNewsItems.publishedAt))
    .limit(limit);

  return rows;
}
