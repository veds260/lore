import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { interviewSessions, users, brands } from '@/lib/db/schema';
import { PLAN_CONFIG } from '@/lib/plans';
import { generateQuestionsForSession } from '@/lib/interview-engine';
import { z } from 'zod';

const StartSchema = z.object({
  brandId: z.string().uuid().optional(),
  isOnboarding: z.boolean().optional(),
});

function billingPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function generateShareToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = StartSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const userId = session.user.id;
  const period = billingPeriod();

  // Check monthly quota
  const [user] = await db.select({ planTier: users.planTier }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const isOnboarding = parsed.data.isOnboarding === true;

  if (!isOnboarding) {
    const quota = PLAN_CONFIG[user.planTier]?.monthlyInterviews ?? 0;
    // -1 means unlimited (agency). Skip quota check for unlimited plans.
    if (quota !== -1) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(interviewSessions)
        .where(and(eq(interviewSessions.userId, userId), eq(interviewSessions.billingPeriod, period)));
      if (count >= quota) {
        return NextResponse.json({ error: 'Monthly interview limit reached', type: 'quota_exceeded' }, { status: 402 });
      }
    }

  }

  // Resolve brand, always validate ownership so a caller can't pass an arbitrary brandId
  let brandId: string | null = null;
  if (parsed.data.brandId) {
    const [ownedBrand] = await db
      .select({ id: brands.id })
      .from(brands)
      .where(and(eq(brands.id, parsed.data.brandId), eq(brands.userId, userId)))
      .limit(1);
    brandId = ownedBrand?.id ?? null;
  } else {
    const [activeBrand] = await db
      .select({ id: brands.id })
      .from(brands)
      .where(and(eq(brands.userId, userId), eq(brands.isActive, true)))
      .limit(1);
    brandId = activeBrand?.id ?? null;
  }

  if (!brandId) {
    return NextResponse.json({ error: 'No brand found. Set up your profile first.' }, { status: 422 });
  }

  // Generate personalized questions
  const generatedQuestions = await generateQuestionsForSession(brandId, userId);

  const shareToken = generateShareToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

  const [interviewSession] = await db.insert(interviewSessions).values({
    userId,
    brandId,
    billingPeriod: period,
    shareToken,
    expiresAt,
    status: 'active',
    startedAt: new Date(),
    generatedQuestions,
    questionsAsked: [],
    sessionState: { currentIndex: 0, followUpCount: 0 },
  }).returning({ id: interviewSessions.id, shareToken: interviewSessions.shareToken });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? '';
  const shareUrl = `${appUrl}/interview/${shareToken}`;

  const questionsQueue = generatedQuestions.slice(0, 2).map((q: { question: string }) => q.question);

  return NextResponse.json({ shareUrl, sessionId: interviewSession.id, shareToken, questionsQueue }, { status: 201 });
}
