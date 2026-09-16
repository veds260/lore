import { callAI, parseJSON, MODEL_AGENT } from './ai';
import { GLOBAL_RULES_PROMPT } from './global-rules';
import { detectPatterns, formatHitsForFixer, burstinessScore } from './pattern-detector';
import { recordCost } from './credits';

// Structured judge prompt. Forces the model to grade the post on every
// dimension we care about and JUSTIFY each grade. No more <<<CLEAN>>> shortcut
// that lets the judge skim past rules. Either every dimension PASSes (with a
// brief reason) or the model writes a rewrite that fixes every FAIL.
//
// Switched to Haiku 4.5 (MODEL_AGENT) from Flash because Sonnet writes nuanced
// violations that Flash can't catch. Haiku is still fast (~1s) but follows
// the structured-output rubric reliably.
const JUDGE_PROMPT = `You are a strict writing quality judge for a content tool. The post below was generated for a specific creator and must match their voice + pass every quality rule.

You CANNOT skim. For each of the 8 dimensions below, output PASS or FAIL with a 1-sentence reason. Then aggregate: if ANY dimension is FAIL, set needs_rewrite=true and produce a rewrite that fixes every failure while keeping all verifiable facts intact.

## The 8 dimensions

1. **hook** — Does the first line tease a SPECIFIC claim or observation the rest of the post will deliver? FAIL if it restates the news headline, paraphrases the topic title as a thesis, opens with a question, or starts with "I".
   - FAIL: "Vitalik says AI-assisted formal verification could be the thing that..."
   - FAIL: "Formal verification could become cheap enough for any team, according to Vitalik Buterin."
   - FAIL: "Acme closed a $30M Series A yesterday."
   - PASS: "Most SaaS onboarding flows lose people before they ever see the product."

2. **voice** — Is the post written in the creator's voice (first-person, conversational, with specific personal anchors) or in detached third-person analyst voice? FAIL if there is NO first-person marker (I / we / my / our) AND no specific personal-experience anchor — analyst-deck posts always fail this.
   - FAIL: "Companies that learn to explain this clearly will have a much easier time hiring."
   - PASS: "I keep watching teams ship a 'simple' onboarding flow, lose half their signups in week one, and act surprised."

3. **closer** — Does the post end with a SPECIFIC takeaway (universal lesson someone outside the niche could apply, OR sharp operator-authority observation) or a vague forward-statement?
   - FAIL: "Teams that adopt X will win." / "The future is X." / "Companies that learn to explain this clearly will hire faster." / "Good onboarding is getting cheaper to build. The question is who moves first."
   - PASS: anything specific to a behaviour or a decision.

4. **niche** — If a brand niche is provided in the accelerator block below, count its mentions. Pass if ≤1 in the body. Fail if >1.

5. **fabrication** — Does the post invent unverifiable personal experience? Fail if "a friend has been using it for X weeks", "I watched [unnamed person] do X", "someone I know in [niche] uses it", "I spent the morning running it" or similar appears AND there's no way the model could know this from the topic input.

6. **rhythm** — For X/Twitter posts: blank lines between hook/body/closer (the post must contain \\n\\n at least once if it has 2+ sentences). For LinkedIn: spacious paragraphs with single-sentence-line density.

7. **consultant** — Does the post use banned consultant-deck phrasings? Fail if ANY of: "represents a significant", "remains [limited/real/relevant/important]", "as X transitions from Y to Z", "establish habits", "operate more efficiently", "significant workflow change", "connective tissue", "absorb that capability", "scrambling to retrofit", "stitching pieces together", "is positioning itself as", "is built for general", "shows nothing specific to", "genuinely useful/important/valuable", "fundamentally", "essentially", "moreover", "furthermore".

8. **hedges** — Does the post use news-channel hedges? Fail if ANY of: "reportedly", "according to reports/sources/[Named Person/Org]", "per the announcement / press release / reports", "the company stated", "as reported by", "in a statement". Direct statements only.

## Output format

Output EXACTLY this JSON object. No prose around it, no markdown fences, no preamble.

{
  "hook":        { "verdict": "PASS" | "FAIL", "reason": "1 sentence" },
  "voice":       { "verdict": "PASS" | "FAIL", "reason": "1 sentence" },
  "closer":      { "verdict": "PASS" | "FAIL", "reason": "1 sentence" },
  "niche":       { "verdict": "PASS" | "FAIL", "reason": "1 sentence" },
  "fabrication": { "verdict": "PASS" | "FAIL", "reason": "1 sentence" },
  "rhythm":      { "verdict": "PASS" | "FAIL", "reason": "1 sentence" },
  "consultant":  { "verdict": "PASS" | "FAIL", "reason": "1 sentence" },
  "hedges":      { "verdict": "PASS" | "FAIL", "reason": "1 sentence" },
  "needs_rewrite": true | false,
  "rewrite": "..." | null
}

needs_rewrite MUST be true if ANY dimension is FAIL.
rewrite MUST be a complete rewritten post when needs_rewrite is true. It MUST fix every failure without losing facts or platform structure.
rewrite MUST be null when needs_rewrite is false.

## Background rules (reference, all of these are also covered by the 8 dimensions above)

${GLOBAL_RULES_PROMPT}`;

interface DimensionVerdict {
  verdict?: 'PASS' | 'FAIL';
  reason?: string;
}

interface JudgeResult {
  hook?: DimensionVerdict;
  voice?: DimensionVerdict;
  closer?: DimensionVerdict;
  niche?: DimensionVerdict;
  fabrication?: DimensionVerdict;
  rhythm?: DimensionVerdict;
  consultant?: DimensionVerdict;
  hedges?: DimensionVerdict;
  needs_rewrite?: boolean;
  rewrite?: string | null;
}

// Count occurrences of a brand niche phrase in the body (case-insensitive, also
// catches plural/possessive forms). Used by the judge prompt to flag niche-stamping.
function countNicheMentions(text: string, niche: string): number {
  const clean = niche.trim();
  if (!clean) return 0;
  // Escape regex special characters, then allow optional trailing s/'s for plural/possessive.
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`\\b${escaped}(?:s|['']s)?\\b`, 'gi');
  return (text.match(rx) ?? []).length;
}

export async function applyRulesFix(
  post: string,
  opts?: { userId?: string; niche?: string | null; isNewsReaction?: boolean },
): Promise<string> {
  if (!post.trim()) return post;
  try {
    // Regex + multi-sentence scan still runs first; hits become accelerator
    // hints in the prompt so the judge knows exactly what to look at. The LLM
    // ALWAYS runs now: regex is a signal-booster, not the gate.
    const hits = detectPatterns(post);
    const hitsBlock = formatHitsForFixer(hits);
    const burst = burstinessScore(post);
    const burstNote = burst < 0.4
      ? `\n## Quality signal — burstiness ${burst.toFixed(2)}\nSentence-length variance is low (healthy is ~0.5+). The post is likely uniform in pacing. Pay extra attention to merging/varying sentences.`
      : '';

    // Niche-stamping accelerator: count brand niche mentions and feed the
    // exact number to the judge. Cannot be missed when the count is in the prompt.
    let nicheBlock = '';
    if (opts?.niche) {
      const count = countNicheMentions(post, opts.niche);
      nicheBlock = `\n## Niche-stamping accelerator\nBrand niche: "${opts.niche}". Detected mentions in the post: ${count}. The niche dimension PASSes if ≤1, FAILs if >1.`;
    }

    // News-reaction context: tells the judge what to expect on top of the dimensions.
    const newsBlock = opts?.isNewsReaction
      ? `\n## News reaction context\nThis post was generated as a reaction to a news item or public statement. Be EXTRA strict on the hook dimension — bare headline recap is the most common failure mode here. Also strict on hedges (reportedly / according to) and fabrication (invented personal experience with brand-new news).`
      : '';

    const out = await callAI({
      model: MODEL_AGENT, // Haiku 4.5, smarter than Flash on structured rule-following
      prompt: `${JUDGE_PROMPT}${hitsBlock}${burstNote}${nicheBlock}${newsBlock}\n\n## Post to judge\n${post}\n\n## Your structured verdict\nReturn ONLY the JSON object specified above.`,
      temperature: 0.1,
      maxTokens: 2500,
    });

    // Telemetry
    if (opts?.userId) {
      recordCost(opts.userId, 'rules_judge', { hits: hits.length, burstiness: burst }).catch(() => {});
    }

    const result = parseJSON<JudgeResult>(out);
    if (!result) {
      // Judge output didn't parse, fall back to original. Safer than gambling
      // on partial output.
      console.warn('[rules-fixer] judge JSON parse failed, keeping original');
      return post;
    }

    // No rewrite needed and verdicts say clean → return original.
    if (!result.needs_rewrite) return post;

    // Rewrite path: sanity check the output before substituting.
    const rewrite = (result.rewrite ?? '').trim();
    if (!rewrite) {
      console.warn('[rules-fixer] judge said needs_rewrite=true but rewrite was empty, keeping original');
      return post;
    }
    if (rewrite.length < post.length * 0.4) {
      console.warn('[rules-fixer] rewrite too short, keeping original');
      return post;
    }

    return rewrite;
  } catch (err) {
    console.error('[rules-fixer] judge failed, returning original:', err);
    return post; // non-fatal, return original if fixer fails
  }
}
