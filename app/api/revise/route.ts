import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { brands, skills } from '@/lib/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getActiveBrandId } from '@/lib/active-brand';
import { GLOBAL_RULES_PROMPT, STRUCTURAL_RULES } from '@/lib/global-rules';
import { buildCraftRules, looksLikeNewsReaction } from '@/lib/craft-rules';
import { loadVoiceContext, formatVoiceSection } from '@/lib/voice-context';
import { callAI, MODEL_CREATIVE } from '@/lib/ai';
import { applyRulesFix } from '@/lib/rules-fixer';
import { checkDailyLimit } from '@/lib/credits';
import { decryptSkillBody } from '@/lib/skills-crypto';
import { detectEditPreference } from '@/lib/learning/edit-preferences';

// Detect the structural fingerprint of a post so the revise prompt can tell the
// model to preserve it. Each detected beat becomes a hard preservation rule.
function detectStructure(content: string): string[] {
  const beats: string[] = [];

  // Numbered lists: both "1. " and "1/ " styles
  const numberedDot = (content.match(/(^|\n)\s*\d+\.\s+\S/g) ?? []).length;
  const numberedSlash = (content.match(/(^|\n)\s*\d+\/\s+\S/g) ?? []).length;
  if (numberedDot >= 2) {
    beats.push(`NUMBERED LIST (dot style): the post has ${numberedDot} points formatted as "1. ... 2. ... 3. ...". Keep the SAME COUNT and the SAME dot-style numbering.`);
  }
  if (numberedSlash >= 2) {
    beats.push(`NUMBERED LIST (slash style): the post has ${numberedSlash} points formatted as "1/ ... 2/ ... 3/ ...". Keep the SAME COUNT and the SAME slash-style numbering.`);
  }

  // Arrow bullets
  if (/(^|\n)\s*→\s+\S/.test(content)) {
    beats.push(`ARROW BULLETS: the post uses → for vertical lists. Keep the arrow bullets exactly where they appear, same number of arrow lines.`);
  }

  // Unicode bold section headers (Mathematical Sans-Serif Bold range)
  if (/[\u{1D5D4}-\u{1D607}\u{1D7CE}-\u{1D7FF}]/u.test(content)) {
    beats.push(`UNICODE BOLD HEADERS: the post uses Unicode-bold characters (𝗯𝗼𝗹𝗱) for section headers. Keep the same headers in the same positions.`);
  }

  // Recognizable pivot phrases: the seams between hook and body
  const pivotPatterns = [
    /Three things stand out:/i,
    /Here['']?s what I['']?m seeing:/i,
    /Here['']?s how to make the shift:/i,
    /Here['']?s the playbook:/i,
    /Here['']?s how it broke down:/i,
    /Here['']?s how it works:/i,
    /The playbook:/i,
    /Most people miss this:/i,
  ];
  for (const re of pivotPatterns) {
    const m = content.match(re);
    if (m) {
      beats.push(`PIVOT PHRASE: the post uses "${m[0]}" as a section pivot. Keep this exact phrase in the same position.`);
      break;
    }
  }

  // Tight single-sentence-per-line LinkedIn density (common in templates)
  const singleSentenceLines = content.split('\n').filter(l => {
    const t = l.trim();
    return t.length > 0 && t.length < 180 && /[.!?]$/.test(t);
  }).length;
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;
  if (paragraphs >= 5 && singleSentenceLines >= 4) {
    beats.push(`SINGLE-SENTENCE PARAGRAPHS: the post uses one sentence per paragraph with blank lines between (LinkedIn density). Keep this rhythm — do not collapse multiple sentences into one paragraph.`);
  }

  return beats;
}

function enforceTwitterBreaks(text: string): string {
  if (!text || text.includes('\n\n')) return text;
  if ((text.match(/\n/g) ?? []).length >= 2) return text.replace(/\n/g, '\n\n');
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  if (!sentences || sentences.length < 2) return text;
  const trimmed = sentences.map(s => s.trim()).filter(Boolean);
  if (trimmed.length === 2) return trimmed.join('\n\n');
  const hook = trimmed[0];
  const closer = trimmed[trimmed.length - 1];
  const body = trimmed.slice(1, -1).join(' ');
  return [hook, body, closer].filter(Boolean).join('\n\n');
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;

  // ── Daily hard cap check ─────────────────────────────────────────────────────
  const dailyCheck = await checkDailyLimit(userId, 'revise');
  if (!dailyCheck.allowed) {
    return NextResponse.json(
      { error: 'Daily limit reached', used: dailyCheck.used, limit: dailyCheck.limit, type: 'daily_limit_reached' },
      { status: 429 },
    );
  }

  const { content, instruction, platform, originalContent } = await req.json().catch(() => ({}));
  if (!content?.trim() || !instruction?.trim()) {
    return NextResponse.json({ error: 'content and instruction are required' }, { status: 400 });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not set' }, { status: 500 });
  }

  const activeBrandId = await getActiveBrandId(userId);
  const [brand] = activeBrandId ? await db
    .select({ name: brands.name, id: brands.id, niche: brands.niche })
    .from(brands)
    .where(eq(brands.id, activeBrandId))
    .limit(1) : [];

  // Build 3-pass voice context: pass2 = synthesized voiceDocument, pass3 = unabsorbed delta
  const voiceCtx = brand?.id ? await loadVoiceContext(brand.id) : { pass2: '', pass3: '' };
  const voiceSection = [formatVoiceSection(voiceCtx), GLOBAL_RULES_PROMPT].filter(Boolean).join('\n\n');

  // Fire-and-forget: mark active skills as applied so confidence decay doesn't penalise used skills
  if (brand?.id) {
    db.update(skills)
      .set({
        lastAppliedAt: new Date(),
        timesApplied: sql`COALESCE(${skills.timesApplied}, 0) + 1`,
      })
      .where(and(eq(skills.brandId, brand.id), eq(skills.status, 'active')))
      .catch(() => {}); // non-fatal
  }

  const platformLabel = platform === 'linkedin' ? 'LinkedIn' : 'X (Twitter)';

  // Detect the structural fingerprint of the original post so the revision
  // preserves the template shape instead of collapsing back to free-form prose.
  const structuralBeats = detectStructure(content);
  const preservationBlock = structuralBeats.length > 0
    ? `\n## Structural pattern to PRESERVE\nThe original post follows a specific structural template. Your revision MUST keep the same structure — only modify the words/angle the user asked about. Do NOT collapse a numbered list into a paragraph. Do NOT remove pivot phrases. Do NOT drop section headers.\n\nDetected structural elements in this post:\n${structuralBeats.map(b => `- ${b}`).join('\n')}\n\nIf the user's instruction doesn't explicitly ask to change the structure, the revised post should have the SAME number of paragraphs, the SAME number of numbered points (with the same numbering style), the SAME line breaks between sections, and the SAME pivot phrases.\n`
    : '';

  // Auto-detect news reactions from the content body so revisions inherit the
  // same fabrication / headline-recap / hedge bans the original draft got.
  const isNewsReaction = looksLikeNewsReaction(content);
  const craftRules = buildCraftRules({ brandNiche: brand?.niche ?? null, isNewsReaction });

  const prompt = `You are refining a ${platformLabel} post. This is a targeted revision, not a rewrite.

${STRUCTURAL_RULES}

${voiceSection}

${craftRules}
${preservationBlock}
## Current post
${content}

## Revision instruction
${instruction}

## Hard rules for this revision
1. Apply ONLY the requested change. Everything not mentioned by the instruction stays exactly as written.
2. Preserve the structural pattern (see above). If the original has numbered points, keep numbered points. If it has → arrows, keep arrows. If it has a "Three things stand out:" pivot, keep it.
3. Keep the voice intact. Do not switch from first-person to third-person or vice versa.
4. Do not start the revised post with "I".
5. Do not add URLs or "Source:" lines on LinkedIn posts — LinkedIn deboosts outbound links.
6. The craft rules above apply: do not introduce fabricated personal experience, niche stamping, news-channel hedges, vague forward-statement closers, or banned reframe patterns in the revision.

Return ONLY the revised post text. No explanation, no preamble, no surrounding text.`;

  try {
    const raw = await callAI({ model: MODEL_CREATIVE, prompt, temperature: 0.75, maxTokens: 1500 });
    const fixed = await applyRulesFix(raw, { userId, niche: brand?.niche ?? null, isNewsReaction });
    // Enforce Twitter line breaks if the AI didn't include them
    const revised = platform === 'twitter' ? enforceTwitterBreaks(fixed) : fixed;
    const learningSuggestion = detectEditPreference({
      original: typeof originalContent === 'string' && originalContent.trim() ? originalContent : content,
      revised,
      instruction,
      platform,
    });
    return NextResponse.json({ revised, learningSuggestion });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
