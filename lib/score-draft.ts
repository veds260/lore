import { callAI, parseJSON, MODEL_EXTRACT } from './ai';
import { detectPatterns, burstinessScore } from './pattern-detector';

export interface DraftScores {
  quality: number;
  hook: number;
  substance: number;
  authenticity: number;
  formatting: number;
}

export async function scoreDraft(content: string): Promise<DraftScores | null> {
  const prompt = `Score this social media post on 5 dimensions. Be honest and critical — low scores are fine.

## Post
${content.slice(0, 1200)}

## Scoring (1–10 each)
- hook: Does the opening line stop the scroll? Strong name/scenario/contrast?
- substance: Real specific insight, data, or example — not vague or generic?
- authenticity: Sounds like a real human — no AI clichés, hollow phrases, buzzwords?
- formatting: Clean structure, good line breaks, platform-appropriate length?
- quality: Overall — would this perform well?

Return ONLY valid JSON, no other text:
{"quality":7,"hook":8,"substance":6,"authenticity":7,"formatting":8}`;

  try {
    // maxTokens was 60, too tight. Flash occasionally wraps in fences or adds whitespace
    // and the JSON gets truncated mid-output. 200 is safe headroom for a 5-key object.
    const text = await callAI({ model: MODEL_EXTRACT, prompt, temperature: 0.2, maxTokens: 200 });
    const parsed = parseJSON<Record<string, number>>(text);
    if (!parsed) {
      console.warn('[scoreDraft] parseJSON failed. Raw model output:', text.slice(0, 200));
      return null;
    }

    const clamp = (n: unknown): number | null =>
      typeof n === 'number' && !isNaN(n) ? Math.max(1, Math.min(10, Math.round(n))) : null;

    const quality = clamp(parsed.quality);
    const hook = clamp(parsed.hook);
    const substance = clamp(parsed.substance);
    let authenticity = clamp(parsed.authenticity);
    const formatting = clamp(parsed.formatting);

    if (quality == null || hook == null || substance == null || authenticity == null || formatting == null) {
      console.warn('[scoreDraft] missing score keys. parsed:', JSON.stringify(parsed));
      return null;
    }

    // Regex-layer adjustments to authenticity:
    //   -1 per Tier-1 hit (hard ban: em dash, AI lexical, ghostwriter buzz, etc.)
    //   -0.5 per Tier-2 hit (soft warn: fake-precision numbers, soft fillers)
    //   Cap at 5 if burstiness < 0.3 (uniform sentence lengths = robotic)
    const hits = detectPatterns(content);
    const tier1 = hits.filter(h => h.tier === 1).length;
    const tier2 = hits.filter(h => h.tier === 2).length;
    authenticity = Math.max(1, authenticity - tier1 - Math.round(tier2 * 0.5));

    if (burstinessScore(content) < 0.3) {
      authenticity = Math.min(authenticity, 5);
    }

    return { quality, hook, substance, authenticity, formatting };
  } catch (err) {
    console.error('[scoreDraft] threw:', err instanceof Error ? err.message : err);
    return null;
  }
}
