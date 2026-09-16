import { db } from '@/lib/db';
import { brands, skills, corrections } from '@/lib/db/schema';
import { eq, and, isNull, gte } from 'drizzle-orm';
import { decryptSkillBody } from '@/lib/skills-crypto';

export interface VoiceContext {
  pass2: string; // synthesized voiceDocument (stable baseline, covers absorbed skills/corrections)
  pass3: string; // delta: unabsorbed skills + corrections added since last synthesis
}

// Build the 3-pass voice context for a brand.
// Pass 1 (STRUCTURAL_RULES + GLOBAL_RULES_PROMPT) is always injected by callers, not this helper's concern.
// Pass 2 = voiceDocument (synthesized, stable). Falls back to styleGuideMd for new brands.
// Pass 3 = skills + corrections added since last synthesis run (absorbedAt IS NULL).
//          Small by design, synthesis periodically sweeps it back to empty.
export async function loadVoiceContext(brandId: string): Promise<VoiceContext> {
  const [brand] = await db
    .select({ voiceDocument: brands.voiceDocument, styleGuideMd: brands.styleGuideMd })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);

  const pass2 = brand?.voiceDocument
    ?? (brand?.styleGuideMd ? `## Writing style\n${brand.styleGuideMd}` : '');

  const [unabsorbedSkills, unabsorbedCorrections] = await Promise.all([
    db
      .select({ kind: skills.kind, body: skills.body })
      .from(skills)
      .where(and(eq(skills.brandId, brandId), eq(skills.status, 'active'), isNull(skills.absorbedAt), gte(skills.confidence, 0.6))),
    db
      .select({ note: corrections.note, context: corrections.context })
      .from(corrections)
      .where(and(eq(corrections.brandId, brandId), isNull(corrections.absorbedAt))),
  ]);

  const parts: string[] = [];

  if (unabsorbedSkills.length > 0) {
    const lines = unabsorbedSkills.map(s => {
      try { return `- [${s.kind}] ${decryptSkillBody(s.body)}`; } catch { return `- [${s.kind}] ${s.body}`; }
    }).join('\n');
    parts.push(`## New writing rules (not yet synthesized into voice guide — apply these too)\n${lines}`);
  }

  if (unabsorbedCorrections.length > 0) {
    const lines = unabsorbedCorrections
      .map(c => c.context ? `- ${c.note} (context: ${c.context})` : `- ${c.note}`)
      .join('\n');
    parts.push(`## Creator corrections — hard rules, follow exactly\n${lines}`);
  }

  return { pass2, pass3: parts.join('\n\n') };
}

// Assemble the full voice section string ready for prompt injection.
// Returns a pre-labeled string with pass2 and pass3 clearly separated.
// Caller injects: `${voiceSection ? voiceSection + '\n' : ''}`
export function formatVoiceSection(ctx: VoiceContext): string {
  return [
    ctx.pass2
      ? `## Brand voice guide — stylistic preference only (does not override Output Structure Rules above)\n${ctx.pass2}`
      : '',
    ctx.pass3
      ? `## New writing rules — apply in addition to voice guide above\n${ctx.pass3}`
      : '',
  ].filter(Boolean).join('\n\n');
}
