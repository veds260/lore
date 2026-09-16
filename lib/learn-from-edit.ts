import { db } from '@/lib/db';
import { skills } from '@/lib/db/schema';
import { callAI, parseJSON, MODEL_EXTRACT } from '@/lib/ai';
import { encryptSkillBody } from '@/lib/skills-crypto';

const VALID_KINDS = ['hook_formula', 'structure_template', 'voice_rule', 'format_rule', 'avoidance_rule'] as const;
type SkillKind = typeof VALID_KINDS[number];

export interface LearnFromEditResult {
  learned: boolean;
  reason?: string;
  name?: string;
  kind?: SkillKind;
  body?: string;
}

// Self-learning loop for the dashboard: when a writer edits a generated draft before shipping,
// the diff shows what the brand's voice actually wants. Extracts the single most reusable rule
// from (generated → shipped) and stores it as an active skill. The skill applies on the next
// generation (pass-3 delta) and the weekly consolidate cron folds it into the voice document.
// Mirrors the session /api/skills/learn logic but takes an explicit brandId/userId (no
// active-brand cookie), for connector callers.
export async function learnFromEdit(opts: {
  brandId: string;
  userId: string;
  original: string;
  revised: string;
  platform?: string;
}): Promise<LearnFromEditResult> {
  const original = (opts.original || '').trim();
  const revised = (opts.revised || '').trim();
  if (!original || !revised) return { learned: false, reason: 'missing text' };
  if (original === revised) return { learned: false, reason: 'no change' };
  if (!process.env.OPENROUTER_API_KEY) return { learned: false, reason: 'no model key' };

  const platformLabel = opts.platform === 'linkedin' ? 'LinkedIn' : 'X (Twitter)';
  const prompt = `A writer took an AI-generated ${platformLabel} draft and edited it before shipping it.

## Generated draft (what the AI produced)
${original}

## Shipped version (what the writer actually published)
${revised}

Compare them and extract the SINGLE most specific, reusable writing rule this edit demonstrates — what the writer consistently wants that the AI missed. This rule applies to ALL future posts for this creator (Twitter, LinkedIn, every touchpoint), so phrase it platform-agnostically.

Rules for extraction:
- Be concrete: state what to do AND what to avoid, in 1-2 sentences.
- Bias toward EXTRACTING. Even small edits usually teach something (tone, structure, vocabulary, length, capitalization, what to cut).
- Return null ONLY for purely typographical fixes (a typo, a comma) or a reword with no learnable pattern.
- No empty platitudes ("be clearer"). Extract the specific application.

Good rules:
- "Write in all lowercase — never auto-capitalize sentence starts."
- "Cut the closing takeaway line; end on the last concrete beat."
- "Replace abstract 'the people who win' framing with a first-person story ('i did X')."

Return ONLY a JSON object, or the literal text null if no clear rule:
{"name":"5-8 word rule name","kind":"hook_formula"|"structure_template"|"voice_rule"|"format_rule"|"avoidance_rule","body":"the rule in 1-2 sentences, concrete and platform-agnostic"}`;

  let text: string;
  try {
    text = await callAI({ model: MODEL_EXTRACT, prompt, temperature: 0.3, maxTokens: 400 });
  } catch (e) {
    return { learned: false, reason: e instanceof Error ? e.message : 'model error' };
  }
  if (text.trim() === 'null' || !text.includes('{')) return { learned: false, reason: 'no rule' };

  const parsed = parseJSON<{ name?: string; kind?: string; body?: string }>(text);
  if (!parsed?.name || !parsed?.body) return { learned: false, reason: 'unparseable' };
  const kind: SkillKind = VALID_KINDS.includes(parsed.kind as SkillKind) ? (parsed.kind as SkillKind) : 'voice_rule';

  try {
    await db.insert(skills).values({
      brandId: opts.brandId,
      userId: opts.userId,
      scope: 'brand',
      name: parsed.name,
      kind,
      body: encryptSkillBody(parsed.body),
      status: 'active',
      confidence: 0.7,
      source: 'auto',
      evidence: { original, revised, instruction: 'dashboard edit' },
    });
  } catch (e) {
    return { learned: false, reason: e instanceof Error ? e.message : 'insert failed' };
  }

  return { learned: true, name: parsed.name, kind, body: parsed.body };
}
