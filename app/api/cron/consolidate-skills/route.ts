import { NextRequest, NextResponse } from 'next/server';
import { assertCronRequest, cronTriggeredBy } from '@/lib/cron-auth';
import { db } from '@/lib/db';
import { brands, skills, corrections, cronRuns, systemConfig, brandVoiceHistory } from '@/lib/db/schema';
import { eq, and, lt, sql, desc, or, isNull, gt } from 'drizzle-orm';
import { callAI, MODEL_CREATIVE } from '@/lib/ai';
import { decryptSkillBody } from '@/lib/skills-crypto';

export const JOB_NAME = 'consolidate-skills';

async function isJobEnabled(): Promise<boolean> {
  const [row] = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, `cron:${JOB_NAME}:enabled`));
  if (!row) return true; // default enabled
  return (row.value as { enabled: boolean }).enabled !== false;
}

async function logRun(opts: {
  status: 'success' | 'failed' | 'skipped';
  triggeredBy: 'schedule' | 'manual';
  result: Record<string, unknown>;
  durationMs: number;
}) {
  await db.insert(cronRuns).values({
    jobName: JOB_NAME,
    status: opts.status,
    triggeredBy: opts.triggeredBy,
    result: opts.result,
    durationMs: opts.durationMs,
  });
}

// Called weekly by Railway cron OR manually from admin panel.
// Auth: x-cron-secret header vs CRON_SECRET env var.
export async function POST(req: NextRequest) {
  const unauthorized = assertCronRequest(req);
  if (unauthorized) return unauthorized;

  const triggeredBy = cronTriggeredBy(req);
  const startedAt = Date.now();

  // Optional: scope to a single brand (used by skills/learn fire-and-forget)
  const body = await req.json().catch(() => ({})) as { brandId?: string };
  const scopedBrandId = body.brandId ?? null;

  const enabled = await isJobEnabled();
  if (!enabled) {
    await logRun({ status: 'skipped', triggeredBy, result: { message: 'Job disabled' }, durationMs: Date.now() - startedAt });
    return NextResponse.json({ message: 'Job is disabled', skipped: true });
  }

  // Find brands to process, scoped to one brand when brandId is provided
  const allBrands = await db
    .select({
      id: brands.id,
      userId: brands.userId,
      styleGuideMd: brands.styleGuideMd,
      voiceDocument: brands.voiceDocument,
      voiceDocumentUpdatedAt: brands.voiceDocumentUpdatedAt,
    })
    .from(brands)
    .where(scopedBrandId
      ? and(eq(brands.isActive, true), eq(brands.id, scopedBrandId))
      : eq(brands.isActive, true));

  let synthesized = 0;
  let skipped = 0;
  let totalSkillsProcessed = 0;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  for (const brand of allBrands) {
    // ── Confidence decay (runs before synthesis, for all active brands) ─────────
    const decayTargets = await db
      .select({ id: skills.id, confidence: skills.confidence })
      .from(skills)
      .where(
        and(
          eq(skills.brandId, brand.id),
          eq(skills.status, 'active'),
          lt(skills.createdAt, thirtyDaysAgo),
          or(
            isNull(skills.lastAppliedAt),
            lt(skills.lastAppliedAt, thirtyDaysAgo),
          ),
          gt(skills.confidence, 0.1),
        ),
      );

    for (const skill of decayTargets) {
      const newConfidence = Math.max(0.1, (skill.confidence ?? 0.5) - 0.05);
      if (newConfidence <= 0.1) {
        await db
          .update(skills)
          .set({ confidence: newConfidence, status: 'dismissed' })
          .where(eq(skills.id, skill.id));
      } else {
        await db
          .update(skills)
          .set({ confidence: newConfidence })
          .where(eq(skills.id, skill.id));
      }
    }

    // ── Voice document synthesis ──────────────────────────────────────────────
    const allSkills = await db
      .select({
        name: skills.name,
        kind: skills.kind,
        body: skills.body,
        triggerConditions: skills.triggerConditions,
        createdAt: skills.createdAt,
      })
      .from(skills)
      .where(and(eq(skills.brandId, brand.id), eq(skills.status, 'active')));

    // Also load all corrections for this brand
    const allCorrections = await db
      .select({ note: corrections.note, context: corrections.context })
      .from(corrections)
      .where(eq(corrections.brandId, brand.id));

    if (allSkills.length === 0 && allCorrections.length === 0) {
      skipped++;
      continue;
    }

    totalSkillsProcessed += allSkills.length;

    const formattedSkillList = allSkills
      .map((s, i) => `${i + 1}. [${s.kind}] "${s.name}": ${decryptSkillBody(s.body)}`)
      .join('\n');

    const formattedCorrections = allCorrections.length > 0
      ? allCorrections.map(c => c.context ? `- ${c.note} (context: ${c.context})` : `- ${c.note}`).join('\n')
      : null;

    const synthesisPrompt = `You are maintaining a living voice document for a content creator's brand.
This document captures all learned writing rules and is injected into every AI generation.

${brand.voiceDocument ? `## Current voice document\n${brand.voiceDocument}\n\n` : ''}${allSkills.length > 0 ? `## All active writing rules (${allSkills.length} total)\n${formattedSkillList}\n\n` : ''}${formattedCorrections ? `## Creator corrections (explicit hard rules — must be represented in the document)\n${formattedCorrections}\n\n` : ''}
${brand.styleGuideMd ? `## Manual style guide (written by creator — never remove or override)\n${brand.styleGuideMd}\n\n` : ''}
Produce an updated voice document that:
1. Represents EVERY rule in the active rules list — nothing can be omitted
2. Organizes rules into these sections (create subsections as needed):
   ### Universal Rules
   ### Tone
   ### Structure
   ### Platform Rules
   #### Twitter/X
   #### LinkedIn
   ### Topic-Specific Rules
3. Merges rules that say the same thing in different words into one clear rule
4. Preserves the original wording of rules that are specific and precise
5. If a manual style guide exists, its rules take precedence and appear at top of relevant sections
6. Keeps total length under 2500 tokens
7. Returns ONLY the Markdown document, no explanation or preamble`;

    try {
      const newDoc = await callAI({ model: MODEL_CREATIVE, prompt: synthesisPrompt, temperature: 0.3, maxTokens: 2500 });

      // Get current version number (count existing rows + 1)
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(brandVoiceHistory)
        .where(eq(brandVoiceHistory.brandId, brand.id));
      const nextVersion = (countRow?.count ?? 0) + 1;

      // Archive old voice document if it exists
      if (brand.voiceDocument) {
        await db.insert(brandVoiceHistory).values({
          brandId: brand.id,
          voiceDocument: brand.voiceDocument,
          version: nextVersion,
          triggeredBy: triggeredBy === 'manual' ? 'manual' : 'weekly_cron',
          skillsIncluded: allSkills.length,
        });
      }

      // Update brands with new voice document
      await db
        .update(brands)
        .set({ voiceDocument: newDoc, voiceDocumentUpdatedAt: new Date() })
        .where(eq(brands.id, brand.id));

      const now = new Date();

      // Mark all synthesized skills as absorbed, they are now covered by voiceDocument
      if (allSkills.length > 0) {
        await db
          .update(skills)
          .set({ absorbedAt: now })
          .where(and(eq(skills.brandId, brand.id), eq(skills.status, 'active')));
      }

      // Mark all corrections as absorbed
      if (allCorrections.length > 0) {
        await db
          .update(corrections)
          .set({ absorbedAt: now })
          .where(eq(corrections.brandId, brand.id));
      }

      synthesized++;
    } catch {
      skipped++;
      continue;
    }
  }

  const durationMs = Date.now() - startedAt;
  await logRun({
    status: 'success',
    triggeredBy,
    result: { synthesized, skipped, totalSkills: totalSkillsProcessed, durationMs },
    durationMs,
  });

  return NextResponse.json({
    message: `Synthesized voice documents for ${synthesized} brand(s), skipped ${skipped}`,
    synthesized,
    skipped,
    totalSkills: totalSkillsProcessed,
    durationMs,
  });
}

// Admin: get recent run history for this job
export async function GET(req: NextRequest) {
  const unauthorized = assertCronRequest(req);
  if (unauthorized) return unauthorized;

  const runs = await db
    .select()
    .from(cronRuns)
    .where(eq(cronRuns.jobName, JOB_NAME))
    .orderBy(desc(cronRuns.createdAt))
    .limit(20);

  const [enabledRow] = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, `cron:${JOB_NAME}:enabled`));

  const enabled = !enabledRow || (enabledRow.value as { enabled: boolean }).enabled !== false;

  return NextResponse.json({ enabled, runs });
}
