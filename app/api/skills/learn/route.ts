import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { skills } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getActiveBrandId } from '@/lib/active-brand';
import { callAI, parseJSON, MODEL_EXTRACT } from '@/lib/ai';
import { SHORT_TEXT_BANS } from '@/lib/craft-rules';
import { encryptSkillBody, decryptSkillBody } from '@/lib/skills-crypto';
import { mirrorSelfLearningIntoVault } from '@/lib/vault/sync';

const VALID_KINDS = ['hook_formula', 'structure_template', 'voice_rule', 'format_rule', 'avoidance_rule'] as const;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ skill: null }, { status: 200 });

  const { original, revised, instructions, platform } = await req.json().catch(() => ({}));
  if (!original?.trim() || !revised?.trim()) return NextResponse.json({ skill: null });
  if (original.trim() === revised.trim()) return NextResponse.json({ skill: null });

  if (!process.env.OPENROUTER_API_KEY) return NextResponse.json({ skill: null });

  // Resolve the brand the user is actually working in (cookie-backed), never
  // "newest active brand" (on agency accounts that wrote skills to the wrong brand).
  const activeBrandId = await getActiveBrandId(session.user.id);
  if (!activeBrandId) return NextResponse.json({ skill: null });
  const brand = { id: activeBrandId };

  const platformLabel = platform === 'linkedin' ? 'LinkedIn' : 'X (Twitter)';
  const instructionList: string[] = Array.isArray(instructions) ? instructions.filter(Boolean) : [];

  const instructionSection = instructionList.length > 0
    ? `\n## Revision instructions used (in order)\n${instructionList.map((inst, i) => `${i + 1}. "${inst}"`).join('\n')}\n`
    : '';

  const prompt = `A writer revised a ${platformLabel} post through ${instructionList.length > 1 ? `${instructionList.length} rounds of revision` : 'one round of revision'}.
${instructionSection}
## Original post (before any revisions)
${original}

## Final accepted post (after all revisions)
${revised}

Study the full picture: what the writer started with, what they explicitly asked for, and what they ended up with. Extract the single most specific, reusable writing rule this revision chain demonstrates.

This rule will apply to ALL future posts this writer generates — X tweets, LinkedIn long-form, Telegram drafts, every touchpoint. Brand-wide, not platform-specific. So phrase the rule so it makes sense regardless of platform (e.g. "always lead with a specific number in the hook" works for both Twitter and LinkedIn).

Rules for extraction:
- Be concrete — describe the exact pattern in 1-2 sentences, with what to do AND what to avoid
- The rule should be actionable for future posts
- Bias toward EXTRACTING rather than returning null. Even small revisions usually teach something. If you can articulate a learnable pattern from the change, extract it.
- Return null ONLY when the change is purely typographical (a typo fix, a comma added) or the original and revised are essentially the same idea reworded with no structural lesson
- Do NOT extract empty platitudes ("be clearer", "be more specific") — but DO extract specific applications of those ideas
- If multiple instructions were used, identify the overarching preference they reflect

Example of GOOD rules:
- "Lead the hook with a precise timeframe or number ('6 months', '400 decks') instead of vague quantifiers ('many', 'most')."
- "Never end a post with an engagement question — close on a declarative claim."
- "When listing 3+ items, use → arrows on separate lines rather than commas in a paragraph."
- "Strip out 'represents a significant' / 'remains limited' / 'as X transitions to Y' consultant phrasings — they read as AI."
- "Replace 'leverage' with 'use'. Replace 'utilize' with 'use'. Replace 'in order to' with 'to'."

Example of BAD rules:
- "Be more specific and engaging." (no specific behaviour)
- "Make the post sharper." (no learnable pattern)

${SHORT_TEXT_BANS}

Return ONLY a JSON object, or the literal text null if no clear rule can be extracted:
{
  "name": "5-8 word rule name",
  "kind": "hook_formula" | "structure_template" | "voice_rule" | "format_rule" | "avoidance_rule",
  "body": "The rule in 1-2 sentences. Concrete and immediately actionable. Phrased to apply across all platforms (Twitter + LinkedIn + Telegram drafts)."
}`;

  try {
    const text = await callAI({ model: MODEL_EXTRACT, prompt, temperature: 0.3, maxTokens: 400 });

    if (text === 'null' || !text.includes('{')) return NextResponse.json({ skill: null });

    const parsed = parseJSON<{ name?: string; kind?: string; body?: string }>(text);
    if (!parsed?.name || !parsed?.body) return NextResponse.json({ skill: null });

    const kind = VALID_KINDS.includes(parsed.kind as typeof VALID_KINDS[number])
      ? (parsed.kind as typeof VALID_KINDS[number])
      : 'voice_rule';

    const newRuleBody = parsed.body;

    // ── 1. Contradiction detection ────────────────────────────────────────────
    // Fetch all active skills for this brand so we can check for conflicts
    let supersededSkillId: string | null = null;

    try {
      const existingSkills = await db
        .select({ id: skills.id, body: skills.body })
        .from(skills)
        .where(and(eq(skills.brandId, brand.id), eq(skills.status, 'active')));

      if (existingSkills.length > 0) {
        // Decrypt all bodies for the contradiction check
        const decryptedBodies = existingSkills.map((s) => {
          try { return decryptSkillBody(s.body); } catch { return s.body; }
        });

        const existingList = decryptedBodies
          .map((body, i) => `${i + 1}. ${body}`)
          .join('\n');

        const contradictionPrompt = `Existing writing rules for this brand:
${existingList}

New rule being added: "${newRuleBody}"

Does the new rule CONTRADICT, REPLACE, or REFINE any of the existing rules?
- CONTRADICT: directly opposes an existing rule (new rule says opposite)
- REPLACE: covers the same ground as an existing rule but more specifically/correctly
- NEW: genuinely new, no conflict

Return ONLY JSON: {"action": "CONTRADICT"|"REPLACE"|"NEW", "supersedes_index": number|null, "reason": "one sentence"}
supersedes_index is the 1-based index of the rule being replaced/contradicted, or null.`;

        // ── 2. Keyword extraction ─────────────────────────────────────────────
        // Run contradiction check and keyword extraction in parallel
        const keywordPrompt = `Writing rule: "${newRuleBody}"

Extract 3-5 topic keywords that indicate WHEN this rule is most relevant.
Think: what topics, post types, or contexts does this rule apply to?
Generic rules (always apply) should return general keywords like ["all", "always"].

Return ONLY JSON: {"keywords": ["word1", "word2", "word3"]}`;

        const [contradictionText, keywordText] = await Promise.all([
          callAI({ model: MODEL_EXTRACT, prompt: contradictionPrompt, temperature: 0.1, maxTokens: 200 }),
          callAI({ model: MODEL_EXTRACT, prompt: keywordPrompt, temperature: 0.1, maxTokens: 150 }),
        ]);

        // Process contradiction result
        try {
          const contradictionResult = parseJSON<{
            action?: string;
            supersedes_index?: number | null;
            reason?: string;
          }>(contradictionText);

          if (
            contradictionResult &&
            (contradictionResult.action === 'CONTRADICT' || contradictionResult.action === 'REPLACE') &&
            typeof contradictionResult.supersedes_index === 'number' &&
            contradictionResult.supersedes_index >= 1 &&
            contradictionResult.supersedes_index <= existingSkills.length
          ) {
            supersededSkillId = existingSkills[contradictionResult.supersedes_index - 1].id;
          }
        } catch {
          // Contradiction check failed, proceed with insertion normally
        }

        // Generate new skill ID upfront so we can reference it in the supersededBy update
        const newSkillId = crypto.randomUUID();

        // If an old skill is superseded, mark it dismissed before inserting the new one
        if (supersededSkillId) {
          try {
            await db
              .update(skills)
              .set({ status: 'dismissed', supersededBy: newSkillId, updatedAt: new Date() })
              .where(eq(skills.id, supersededSkillId));
          } catch {
            // Update failed, still proceed with insertion
          }
        }

        // Process keyword result
        let triggerConditions: { keywords: string[] } = { keywords: [] };
        try {
          const keywordResult = parseJSON<{ keywords?: string[] }>(keywordText);
          if (keywordResult?.keywords && Array.isArray(keywordResult.keywords)) {
            triggerConditions = { keywords: keywordResult.keywords };
          }
        } catch {
          // Keyword extraction failed, proceed with empty keywords
        }

        // ── 3. Evidence capture ───────────────────────────────────────────────
        const evidence = {
          original,
          revised,
          instruction: instructionList.join(' → '),
        };

        await db.insert(skills).values({
          id: newSkillId,
          brandId: brand.id,
          userId: session.user.id,
          scope: 'brand',
          name: parsed.name,
          kind,
          body: encryptSkillBody(newRuleBody),
          status: 'active',
          confidence: 0.7,
          source: 'auto',
          triggerConditions,
          evidence,
        });

        // Fire-and-forget: re-synthesize only this brand's voice doc
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? '';
        if (appUrl) {
          fetch(`${appUrl}/api/cron/consolidate-skills`, {
            method: 'POST',
            headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '', 'Content-Type': 'application/json' },
            body: JSON.stringify({ brandId: brand.id }),
          }).catch(() => {});
        }

        // Best-effort: mirror the learned skill into the tenant vault so the
        // Vault reflects learning without a manual sync. Never break the request.
        await mirrorSelfLearningIntoVault({ userId: session.user.id, brandId: brand.id }).catch(() => {});

        // Return the rule text too so the caller can show the exact rule that was learned.
        return NextResponse.json({ skill: { name: parsed.name, body: newRuleBody } });
      }
    } catch {
      // Existing skills fetch or parallel AI calls failed, fall through to plain insert
    }

    // ── Fallback: plain insert when the enhanced path failed or no existing skills ─
    // Still run keyword extraction alone (no contradiction needed with empty list)
    let triggerConditions: { keywords: string[] } = { keywords: [] };
    try {
      const keywordPrompt = `Writing rule: "${newRuleBody}"

Extract 3-5 topic keywords that indicate WHEN this rule is most relevant.
Think: what topics, post types, or contexts does this rule apply to?
Generic rules (always apply) should return general keywords like ["all", "always"].

Return ONLY JSON: {"keywords": ["word1", "word2", "word3"]}`;

      const keywordText = await callAI({ model: MODEL_EXTRACT, prompt: keywordPrompt, temperature: 0.1, maxTokens: 150 });
      const keywordResult = parseJSON<{ keywords?: string[] }>(keywordText);
      if (keywordResult?.keywords && Array.isArray(keywordResult.keywords)) {
        triggerConditions = { keywords: keywordResult.keywords };
      }
    } catch {
      // Keyword extraction failed, proceed with empty keywords
    }

    const evidence = {
      original,
      revised,
      instruction: instructionList.join(' → '),
    };

    await db.insert(skills).values({
      brandId: brand.id,
      userId: session.user.id,
      scope: 'brand',
      name: parsed.name,
      kind,
      body: encryptSkillBody(newRuleBody),
      status: 'active',
      confidence: 0.7,
      source: 'auto',
      triggerConditions,
      evidence,
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? '';
    if (appUrl) {
      fetch(`${appUrl}/api/cron/consolidate-skills`, {
        method: 'POST',
        headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
      }).catch(() => {});
    }

    // Best-effort: mirror the learned skill into the tenant vault so the Vault
    // reflects learning without a manual sync. Never break the request.
    await mirrorSelfLearningIntoVault({ userId: session.user.id, brandId: brand.id }).catch(() => {});

    return NextResponse.json({ skill: { name: parsed.name, body: newRuleBody } });
  } catch (err) {
    console.error('[skills/learn]', err instanceof Error ? err.message : err);
    return NextResponse.json({ skill: null });
  }
}
