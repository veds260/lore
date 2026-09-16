// Post-creation brand enrichment. Runs fire-and-forget when the user picks the
// "fill the form manually" onboarding path (no AI upload). Fills in the structured
// fields the upload path produces (expertise, credibility markers, writing tone,
// content themes) plus picks `selectedCategories` from Lore's fixed taxonomy.
//
// Safe to call on already-enriched brands: it only writes fields that are still empty.

import { eq } from 'drizzle-orm';
import { db } from './db';
import { brands } from './db/schema';
import { callAI, parseJSON, MODEL_EXTRACT } from './ai';
import { recordCost } from './credits';
import { modelAvailable } from '@/lib/providers';

// The fixed taxonomy used by Settings → Content Pillars. Must stay in sync with
// ALL_CATEGORIES in app/(app)/settings/settings-client.tsx.
const CATEGORY_IDS = [
  'build-in-public',
  'educational',
  'storytelling',
  'authority',
  'contrarian-take',
  'hot-take',
  'thought-leadership',
  'thesis-building',
  'case-study',
] as const;

type CategoryId = typeof CATEGORY_IDS[number];

interface EnrichInput {
  brandId: string;
  userId: string;
  name: string;
  whatYouDo: string;
  audience?: string;
  positioning?: string;
  recentWin: string;
  strongBelief: string;
  vibe?: string;
  inspirationHandles?: string[];
}

interface ExtractResult {
  expertise?: string[];
  credibilityMarkers?: string[];
  writingTone?: string[];
  contentThemes?: string[];
  niche?: string;
  selectedCategories?: CategoryId[];
}

// Heuristic fallback when AI is unavailable or fails. Always returns 3 sensible categories.
function fallbackCategoriesForVibe(vibe?: string): CategoryId[] {
  switch (vibe) {
    case 'direct':   return ['contrarian-take', 'hot-take', 'thought-leadership'];
    case 'story':    return ['storytelling', 'authority', 'build-in-public'];
    case 'educator': return ['educational', 'authority', 'thought-leadership'];
    default:         return ['build-in-public', 'educational', 'thought-leadership'];
  }
}

// Run AI extraction over the user's freeform answers to derive structured fields.
// Falls back silently on any error, the caller has already saved the brand.
export async function enrichBrand(input: EnrichInput): Promise<void> {
  if (!(await modelAvailable())) {
    // No AI, at least drop the heuristic categories in so the value isn't empty
    await db.update(brands)
      .set({ selectedCategories: fallbackCategoriesForVibe(input.vibe), updatedAt: new Date() })
      .where(eq(brands.id, input.brandId));
    return;
  }

  const sourceText = [
    `Name: ${input.name}`,
    `What they do: ${input.whatYouDo}`,
    input.audience ? `Audience: ${input.audience}` : '',
    input.positioning ? `Positioning: ${input.positioning}` : '',
    `Recent win: ${input.recentWin}`,
    `Core belief: ${input.strongBelief}`,
    input.vibe ? `Writing vibe: ${input.vibe}` : '',
    input.inspirationHandles?.length ? `Inspiration accounts: ${input.inspirationHandles.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const prompt = `You're enriching a content creator's profile in a writing app called Lore. They filled out a manual onboarding form (didn't upload a bio). Extract structured fields you can confidently derive from what they wrote, and pick the 3 best content categories for them from a fixed taxonomy.

Use null for anything you can't confidently extract — never fabricate.

FIELDS:
- expertise: 3-6 specific topics they show depth in (string[] | null)
- credibilityMarkers: 2-4 fact-based authority signals (string[] | null)
- writingTone: 3-5 adjectives describing their style (string[] | null)
- contentThemes: 3-5 recurring topics they'd likely write about (string[] | null)
- niche: short phrase, like "B2B SaaS founders" or "Web3 community" (string | null)
- selectedCategories: pick the 3 BEST matches from this exact list (no other strings):
  ${CATEGORY_IDS.map(id => `  - "${id}"`).join('\n')}

How to pick categories:
- "build-in-public" = current work, live metrics, decisions
- "educational" = frameworks, how-tos, hard-won lessons
- "storytelling" = origin stories, failures, turning points
- "authority" = case studies, credentials, proven results
- "contrarian-take" = pushback against industry norms
- "hot-take" = bold specific opinions
- "thought-leadership" = predictions, values, big-picture views
- "thesis-building" = the central insight their whole work rests on
- "case-study" = data-backed before/after outcomes

USER'S ANSWERS:
---
${sourceText}
---

Return ONLY a JSON object with the fields above. No markdown fences, no explanation.`;

  try {
    const out = await callAI({ model: MODEL_EXTRACT, prompt, temperature: 0.2, maxTokens: 800 });
    // Telemetry: Flash call cost for enrichment
    recordCost(input.userId, 'brand_enrich', { brandId: input.brandId }).catch(() => {});
    const extracted = parseJSON<ExtractResult>(out);
    if (!extracted) {
      await db.update(brands)
        .set({ selectedCategories: fallbackCategoriesForVibe(input.vibe), updatedAt: new Date() })
        .where(eq(brands.id, input.brandId));
      return;
    }

    // Filter selectedCategories to known IDs only, guard against hallucinated values
    const validCategories = (extracted.selectedCategories ?? [])
      .filter((c): c is CategoryId => (CATEGORY_IDS as readonly string[]).includes(c))
      .slice(0, 5);
    const finalCategories = validCategories.length >= 3 ? validCategories : fallbackCategoriesForVibe(input.vibe);

    // Pull the current brand row so we can append-only, don't overwrite existing data
    const [current] = await db.select({
      niche: brands.niche,
      styleGuideMd: brands.styleGuideMd,
      contentPillars: brands.contentPillars,
    }).from(brands).where(eq(brands.id, input.brandId)).limit(1);

    if (!current) return;

    // Build append-only style guide additions
    const additions: string[] = [];
    if (extracted.expertise?.length) {
      additions.push(`## Areas of expertise\n${extracted.expertise.map(e => `- ${e}`).join('\n')}`);
    }
    if (extracted.credibilityMarkers?.length) {
      additions.push(`## Credibility\n${extracted.credibilityMarkers.map(c => `- ${c}`).join('\n')}`);
    }
    if (extracted.writingTone?.length) {
      additions.push(`## Tone\n${extracted.writingTone.join(', ')}`);
    }
    if (extracted.contentThemes?.length) {
      additions.push(`## Content themes\n${extracted.contentThemes.map(t => `- ${t}`).join('\n')}`);
    }

    const updates: Record<string, unknown> = {
      selectedCategories: finalCategories,
      updatedAt: new Date(),
    };

    // Only set niche if we don't have one yet (manual path always lands with niche='')
    if (extracted.niche && !current.niche) {
      updates.niche = extracted.niche;
    }

    // Append-only to styleGuideMd
    if (additions.length > 0) {
      const stamp = new Date().toISOString().slice(0, 10);
      updates.styleGuideMd = (current.styleGuideMd ?? '') + `\n\n## Auto-enriched ${stamp}\n${additions.join('\n\n')}`;
    }

    // contentPillars: only fill if currently empty
    if ((current.contentPillars ?? []).length === 0 && extracted.contentThemes?.length) {
      updates.contentPillars = extracted.contentThemes.slice(0, 5);
    }

    await db.update(brands).set(updates).where(eq(brands.id, input.brandId));
  } catch (err) {
    console.error(`[enrichBrand] failed for ${input.brandId}:`, err instanceof Error ? err.message : err);
    // Best-effort: still set heuristic categories so the value isn't empty
    try {
      await db.update(brands)
        .set({ selectedCategories: fallbackCategoriesForVibe(input.vibe), updatedAt: new Date() })
        .where(eq(brands.id, input.brandId));
    } catch {}
  }
}
