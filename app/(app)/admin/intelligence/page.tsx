import { auth } from '@/lib/auth';
import { notFound } from 'next/navigation';
import { IntelligenceClient } from '@/components/admin/intelligence-client';

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function isAdmin(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return adminEmail.split(',').map(e => e.trim().toLowerCase()).includes(email.toLowerCase());
}

export default async function AdminIntelligencePage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/admin/intelligence`, {
    headers: { cookie: '' },
    cache: 'no-store',
  });

  // Fallback: call DB directly if fetch fails (SSR same-origin issue)
  let data;
  if (!res.ok) {
    const { db } = await import('@/lib/db');
    const { brands, users, skills, corrections, interviewSessions, drafts, cronRuns } = await import('@/lib/db/schema');
    const { eq, desc, count, sql, and, isNull, gte, not, inArray } = await import('drizzle-orm');

    const allBrands = await db.select({
      id: brands.id, name: brands.name, userId: brands.userId, handle: brands.handle,
      niche: brands.niche, selectedCategories: brands.selectedCategories,
      weeklyFocus: brands.weeklyFocus, voiceDocument: brands.voiceDocument,
      voiceDocumentUpdatedAt: brands.voiceDocumentUpdatedAt, briefMd: brands.briefMd,
    }).from(brands).where(eq(brands.isActive, true));

    const userIds = [...new Set(allBrands.map(b => b.userId))];
    const userRows = userIds.length > 0
      ? await db.select({ id: users.id, email: users.email, planTier: users.planTier })
          .from(users).where(inArray(users.id, userIds))
      : [];
    const userMap = new Map(userRows.map(u => [u.id, u]));
    const brandIds = allBrands.map(b => b.id);

    const skillRows = brandIds.length > 0
      ? await db.select({ brandId: skills.brandId, status: skills.status, kind: skills.kind })
          .from(skills).where(inArray(skills.brandId, brandIds))
      : [];
    const correctionRows = brandIds.length > 0
      ? await db.select({ brandId: corrections.brandId, cnt: count() })
          .from(corrections).where(inArray(corrections.brandId, brandIds))
          .groupBy(corrections.brandId)
      : [];
    const lastInterviews = brandIds.length > 0
      ? await db.select({ brandId: interviewSessions.brandId, completedAt: interviewSessions.completedAt })
          .from(interviewSessions)
          .where(and(inArray(interviewSessions.brandId, brandIds), eq(interviewSessions.status, 'completed')))
          .orderBy(desc(interviewSessions.completedAt))
      : [];

    const since30 = daysAgo(30);
    const draftStats = brandIds.length > 0
      ? await db.select({ brandId: drafts.brandId, status: drafts.status, cnt: count() })
          .from(drafts).where(and(inArray(drafts.brandId, brandIds), gte(drafts.createdAt, since30)))
          .groupBy(drafts.brandId, drafts.status)
      : [];
    const unscoredRows = brandIds.length > 0
      ? await db.select({ brandId: drafts.brandId, cnt: count() })
          .from(drafts)
          .where(and(inArray(drafts.brandId, brandIds), isNull(drafts.qualityScore), not(inArray(drafts.status, ['idea']))))
          .groupBy(drafts.brandId)
      : [];

    const skillsByBrand = new Map<string, typeof skillRows>();
    for (const s of skillRows) {
      if (!s.brandId) continue;
      if (!skillsByBrand.has(s.brandId)) skillsByBrand.set(s.brandId, []);
      skillsByBrand.get(s.brandId)!.push(s);
    }
    const correctionsByBrand = new Map(correctionRows.map(r => [r.brandId, r.cnt]));
    const lastInterviewByBrand = new Map<string, Date | null>();
    for (const i of lastInterviews) {
      if (i.brandId && !lastInterviewByBrand.has(i.brandId)) {
        lastInterviewByBrand.set(i.brandId, i.completedAt);
      }
    }
    const draftStatsByBrand = new Map<string, { total: number; posted: number }>();
    for (const r of draftStats) {
      if (!draftStatsByBrand.has(r.brandId)) draftStatsByBrand.set(r.brandId, { total: 0, posted: 0 });
      const e = draftStatsByBrand.get(r.brandId)!;
      e.total += Number(r.cnt);
      if (r.status === 'posted') e.posted += Number(r.cnt);
    }
    const unscoredByBrand = new Map(unscoredRows.map(r => [r.brandId, Number(r.cnt)]));

    const recentRuns = await db.select({
      jobName: cronRuns.jobName, status: cronRuns.status, triggeredBy: cronRuns.triggeredBy,
      result: cronRuns.result, durationMs: cronRuns.durationMs, createdAt: cronRuns.createdAt,
    }).from(cronRuns).orderBy(desc(cronRuns.createdAt)).limit(20);

    const [{ unscoredTotal }] = await db.select({ unscoredTotal: count() }).from(drafts)
      .where(and(isNull(drafts.qualityScore), not(inArray(drafts.status, ['idea']))));
    const [{ unmatchedTotal }] = await db.select({ unmatchedTotal: count() }).from(drafts)
      .where(and(eq(drafts.status, 'posted'), isNull(drafts.postedAt)));

    data = {
      brands: allBrands.map(b => {
        const user = userMap.get(b.userId);
        const brandSkills = skillsByBrand.get(b.id) ?? [];
        const draftInfo = draftStatsByBrand.get(b.id) ?? { total: 0, posted: 0 };
        return {
          id: b.id, name: b.name, handle: b.handle, niche: b.niche,
          userEmail: user?.email ?? null, planTier: user?.planTier ?? 'free',
          selectedCategories: b.selectedCategories ?? [], weeklyFocus: b.weeklyFocus,
          hasVoiceDoc: !!b.voiceDocument,
          voiceDocUpdatedAt: b.voiceDocumentUpdatedAt?.toISOString() ?? null,
          hasBrief: !!b.briefMd, activeSkills: brandSkills.filter(s => s.status === 'active').length,
          totalSkills: brandSkills.length, correctionsCount: correctionsByBrand.get(b.id) ?? 0,
          lastInterviewAt: lastInterviewByBrand.get(b.id)?.toISOString() ?? null,
          drafts30d: draftInfo.total, posted30d: draftInfo.posted,
          unscoredDrafts: unscoredByBrand.get(b.id) ?? 0,
        };
      }),
      global: { unscoredDrafts: Number(unscoredTotal), unmatchedPostedDrafts: Number(unmatchedTotal) },
      recentRuns: recentRuns.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })),
    };
  } else {
    data = await res.json();
  }

  return (
    <div className="px-6 py-5 max-w-4xl">
      <IntelligenceClient data={data} />
    </div>
  );
}
