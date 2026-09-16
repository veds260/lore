import { db } from '@/lib/db';
import { brands, skills, corrections, vaultNotes } from '@/lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { decryptSkillBody } from '@/lib/skills-crypto';
import { upsertVaultNote } from './notes';
import { ensureCanonicalWorkspace, verifyTenantBrandScope } from './workspace';

// Mirror existing self-learning data into vault notes so the vault is the
// canonical lookup surface for retrieval. We do NOT delete from the source
// tables; we just keep a derived vault note in sync per row.

export async function mirrorSelfLearningIntoVault(opts: {
  userId: string;
  brandId: string;
}): Promise<{ workspace: number; skills: number; corrections: number; voiceDoc: number }> {
  const { userId, brandId } = opts;

  const scope = await verifyTenantBrandScope(userId, brandId);
  if (!scope) return { workspace: 0, skills: 0, corrections: 0, voiceDoc: 0 };
  const seeded = await ensureCanonicalWorkspace(scope);

  const [activeSkills, recentCorr, [brand]] = await Promise.all([
    db.select({
      id: skills.id, name: skills.name, kind: skills.kind, body: skills.body,
      confidence: skills.confidence, updatedAt: skills.updatedAt,
    })
      .from(skills)
      .where(and(eq(skills.brandId, brandId), eq(skills.status, 'active'))),
    db.select({ id: corrections.id, note: corrections.note, context: corrections.context, createdAt: corrections.createdAt })
      .from(corrections)
      .where(eq(corrections.brandId, brandId)),
    db.select({ voiceDocument: brands.voiceDocument, voiceUpdatedAt: brands.voiceDocumentUpdatedAt, name: brands.name })
      .from(brands)
      .where(eq(brands.id, brandId))
      .limit(1),
  ]);

  let skillCount = 0;
  for (const s of activeSkills) {
    const body = (() => { try { return decryptSkillBody(s.body); } catch { return s.body; } })();
    await upsertVaultNote({
      userId,
      brandId,
      path: `50-rules/skills/${s.id}.md`,
      title: s.name,
      type: 'rule',
      tags: ['skill', s.kind],
      topics: [],
      summary: body.slice(0, 280),
      body: `${body}\n\n_Type: ${s.kind} · confidence ${(s.confidence ?? 0).toFixed(2)}_`,
      source: 'skill_mirror',
      status: 'active',
      sourceRefType: 'skill',
      sourceRefId: s.id,
      frontmatter: { kind: s.kind, confidence: s.confidence ?? 0.5 },
    });
    skillCount += 1;
  }

  let corrCount = 0;
  for (const c of recentCorr) {
    await upsertVaultNote({
      userId,
      brandId,
      path: `50-rules/corrections/${c.id}.md`,
      title: c.note.slice(0, 80),
      type: 'rule',
      tags: ['correction'],
      topics: [],
      summary: c.note,
      body: c.context ? `${c.note}\n\n_Context: ${c.context}_` : c.note,
      source: 'correction_mirror',
      status: 'active',
      sourceRefType: 'correction',
      sourceRefId: c.id,
    });
    corrCount += 1;
  }

  let voiceCount = 0;
  if (brand?.voiceDocument) {
    await upsertVaultNote({
      userId,
      brandId,
      path: '00-profile/voice.md',
      title: `${brand.name ?? 'Brand'} — voice`,
      type: 'profile',
      tags: ['voice'],
      topics: [],
      summary: brand.voiceDocument.slice(0, 320),
      body: brand.voiceDocument,
      source: 'voice_doc_mirror',
      status: 'active',
      sourceRefType: 'voice_document',
      sourceRefId: brandId,
    });
    voiceCount = 1;
  }

  return { workspace: seeded.createdOrUpdated, skills: skillCount, corrections: corrCount, voiceDoc: voiceCount };
}

// Ensure unabsorbed corrections/skills show up in the vault on read. This is
// cheap and idempotent, call from any path that already touches vault context
// for a brand to keep the mirror warm.
export async function ensureVaultMirrored(userId: string, brandId: string): Promise<void> {
  // Only rebuild the mirror if there's no recent mirror note. Avoids hammering
  // the DB on every generate call.
  const [recent] = await db.select({ id: vaultNotes.id, updatedAt: vaultNotes.updatedAt })
    .from(vaultNotes)
    .where(and(
      eq(vaultNotes.scope, 'tenant'),
      eq(vaultNotes.userId, userId),
      eq(vaultNotes.brandId, brandId),
      eq(vaultNotes.source, 'workspace_seed'),
    ))
    .limit(1);

  const fifteenMin = 15 * 60 * 1000;
  if (recent && +new Date(recent.updatedAt) > Date.now() - fifteenMin) return;

  await mirrorSelfLearningIntoVault({ userId, brandId }).catch(() => {});
  // Suppress lint for unused import in this branch
  void isNull;
}
