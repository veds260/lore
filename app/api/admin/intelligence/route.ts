import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  brands, users, skills, corrections, interviewSessions, drafts, cronRuns,
} from '@/lib/db/schema';
import { eq, desc, count, sql, and, isNull, gte, not, inArray } from 'drizzle-orm';

function isAdmin(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return adminEmail.split(',').map(e => e.trim().toLowerCase()).includes(email.toLowerCase());
}

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // All active brands with their user email and core fields
  const allBrands = await db
    .select({
      id: brands.id,
      name: brands.name,
      userId: brands.userId,
      handle: brands.handle,
      niche: brands.niche,
      selectedCategories: brands.selectedCategories,
      weeklyFocus: brands.weeklyFocus,
      voiceDocument: brands.voiceDocument,
      voiceDocumentUpdatedAt: brands.voiceDocumentUpdatedAt,
      briefMd: brands.briefMd,
    })
    .from(brands)
    .where(eq(brands.isActive, true));

  const userIds = [...new Set(allBrands.map(b => b.userId))];
  const userRows = userIds.length > 0
    ? await db
        .select({ id: users.id, email: users.email, planTier: users.planTier })
        .from(users)
        .where(inArray(users.id, userIds))
    : [];
  const userMap = new Map(userRows.map(u => [u.id, u]));

  const brandIds = allBrands.map(b => b.id);

  // Skills per brand
  const skillRows = brandIds.length > 0
    ? await db
        .select({ brandId: skills.brandId, status: skills.status, kind: skills.kind })
        .from(skills)
        .where(inArray(skills.brandId, brandIds))
    : [];
  const skillsByBrand = new Map<string, typeof skillRows>();
  for (const s of skillRows) {
    if (!s.brandId) continue;
    if (!skillsByBrand.has(s.brandId)) skillsByBrand.set(s.brandId, []);
    skillsByBrand.get(s.brandId)!.push(s);
  }

  // Corrections count per brand
  const correctionRows = brandIds.length > 0
    ? await db
        .select({ brandId: corrections.brandId, count: count() })
        .from(corrections)
        .where(inArray(corrections.brandId, brandIds))
        .groupBy(corrections.brandId)
    : [];
  const correctionsByBrand = new Map(correctionRows.map(r => [r.brandId, r.count]));

  // Last interview per brand
  const lastInterviews = brandIds.length > 0
    ? await db
        .select({
          brandId: interviewSessions.brandId,
          completedAt: interviewSessions.completedAt,
          status: interviewSessions.status,
        })
        .from(interviewSessions)
        .where(
          and(
            inArray(interviewSessions.brandId, brandIds),
            eq(interviewSessions.status, 'completed'),
          ),
        )
        .orderBy(desc(interviewSessions.completedAt))
    : [];
  const lastInterviewByBrand = new Map<string, (typeof lastInterviews)[0]>();
  for (const i of lastInterviews) {
    if (i.brandId && !lastInterviewByBrand.has(i.brandId)) {
      lastInterviewByBrand.set(i.brandId, i);
    }
  }

  // Draft stats per brand (last 30 days)
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const draftStats = brandIds.length > 0
    ? await db
        .select({
          brandId: drafts.brandId,
          status: drafts.status,
          count: count(),
          avgQuality: sql<number>`AVG(${drafts.qualityScore})`,
        })
        .from(drafts)
        .where(and(inArray(drafts.brandId, brandIds), gte(drafts.createdAt, since30)))
        .groupBy(drafts.brandId, drafts.status)
    : [];

  const draftStatsByBrand = new Map<string, { total: number; posted: number; unscored: number; avgQuality: number | null }>();
  for (const row of draftStats) {
    if (!draftStatsByBrand.has(row.brandId)) {
      draftStatsByBrand.set(row.brandId, { total: 0, posted: 0, unscored: 0, avgQuality: null });
    }
    const entry = draftStatsByBrand.get(row.brandId)!;
    entry.total += Number(row.count);
    if (row.status === 'posted') entry.posted += Number(row.count);
  }

  // Unscored drafts count per brand
  const unscoredRows = brandIds.length > 0
    ? await db
        .select({ brandId: drafts.brandId, count: count() })
        .from(drafts)
        .where(
          and(
            inArray(drafts.brandId, brandIds),
            isNull(drafts.qualityScore),
            not(inArray(drafts.status, ['idea'])),
          ),
        )
        .groupBy(drafts.brandId)
    : [];
  for (const row of unscoredRows) {
    const entry = draftStatsByBrand.get(row.brandId);
    if (entry) entry.unscored = Number(row.count);
  }

  // Recent cron runs (last 5 of each job)
  const recentRuns = await db
    .select({
      jobName: cronRuns.jobName,
      status: cronRuns.status,
      triggeredBy: cronRuns.triggeredBy,
      result: cronRuns.result,
      durationMs: cronRuns.durationMs,
      createdAt: cronRuns.createdAt,
    })
    .from(cronRuns)
    .orderBy(desc(cronRuns.createdAt))
    .limit(20);

  // Global unscored count
  const [{ unscoredTotal }] = await db
    .select({ unscoredTotal: count() })
    .from(drafts)
    .where(and(isNull(drafts.qualityScore), not(inArray(drafts.status, ['idea']))));

  // Global unmatched (drafts without postedAt that are in posted status)
  const [{ unmatchedTotal }] = await db
    .select({ unmatchedTotal: count() })
    .from(drafts)
    .where(and(eq(drafts.status, 'posted'), isNull(drafts.postedAt)));

  const brandData = allBrands.map(b => {
    const user = userMap.get(b.userId);
    const brandSkills = skillsByBrand.get(b.id) ?? [];
    const activeSkills = brandSkills.filter(s => s.status === 'active').length;
    const lastInterview = lastInterviewByBrand.get(b.id);
    const draftInfo = draftStatsByBrand.get(b.id) ?? { total: 0, posted: 0, unscored: 0, avgQuality: null };

    return {
      id: b.id,
      name: b.name,
      handle: b.handle,
      niche: b.niche,
      userEmail: user?.email ?? null,
      planTier: user?.planTier ?? 'free',
      selectedCategories: b.selectedCategories ?? [],
      weeklyFocus: b.weeklyFocus,
      hasVoiceDoc: !!b.voiceDocument,
      voiceDocUpdatedAt: b.voiceDocumentUpdatedAt?.toISOString() ?? null,
      hasBrief: !!b.briefMd,
      activeSkills,
      totalSkills: brandSkills.length,
      correctionsCount: correctionsByBrand.get(b.id) ?? 0,
      lastInterviewAt: lastInterview?.completedAt?.toISOString() ?? null,
      drafts30d: draftInfo.total,
      posted30d: draftInfo.posted,
      unscoredDrafts: draftInfo.unscored,
    };
  });

  return NextResponse.json({
    brands: brandData,
    global: {
      unscoredDrafts: Number(unscoredTotal),
      unmatchedPostedDrafts: Number(unmatchedTotal),
    },
    recentRuns: recentRuns.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
