import { db } from './db';
import { users, userCredits, creditTransactions } from './db/schema';
import { eq, and, gte, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { PLAN_CONFIG, isHosted } from './plans';

// Credit model: only unbounded premium features are credit-gated.
// Hard-capped actions (generate, revise, interview, tts, stt) use their plan caps, not credits.
//
// ── AI Chat ──────────────────────────────────────────────────────────────────
// chat_message   Any AI response in chat → 10 credits. No daily cap.
// chat_generate  Additional charge when chat actually produces posts → 10 credits.
//                A post-generating chat turn = 20 credits total.
//
// ── Image generation ─────────────────────────────────────────────────────────
// generate_image  → 25 credits. No hard cap.
//
// ── Scrapes ──────────────────────────────────────────────────────────────────
// scrape_twitter   → 3 credits. Used in chat + manual sync.
// scrape_linkedin  → 3 credits. Manual sync only.
// trends_refresh   → 1 credit. 5/day cap.
//
// ── Governed by hard caps only (not credit-gated) ────────────────────────────
// generate    daily cap (3–15/day by plan)
// revise      daily cap (5–50/day by plan)
// interview   monthly cap (2–10/mo by plan), voice TTS/STT included in session
export const CREDIT_COSTS = {
  chat_message:    10,
  chat_generate:   10,
  generate_image:  25,
  scrape_twitter:   3,
  scrape_linkedin:  3,
  trends_refresh:   1,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

// Monthly credit allowances per plan.
// Credits are a soft budget; the daily action caps in plans.ts are the real guardrails.
//
// Worst-case credit spend at daily caps (generate=10cr, revise=5cr, interview=20cr, tts=1cr, stt=1cr):
// free:   50 credits, enough for ~5 trial generates, no card required
// base:   0 credits, board only, no AI credits
// pro:    2000 credits
// growth: 5000 credits
// agency: -1 = unlimited
const HOSTED_CREDITS: Record<string, number> = {
  free:   50,
  base:   0,
  pro:    2000,
  growth: 5000,
  agency: -1,
};

// Self-hosted installs are never short of credits, see isHosted().
export const PLAN_CREDITS: Record<string, number> = new Proxy(HOSTED_CREDITS, {
  get(target, tier) {
    if (typeof tier !== 'string') return undefined;
    return isHosted() ? target[tier] : -1;
  },
});

export const PLAN_LABELS: Record<string, string> = {
  free:   'Free',
  base:   'Creator',
  pro:    'Pro',
  growth: 'Growth',
  agency: 'Agency',
};

function currentPeriodStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function currentPeriodEnd(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export interface CreditsState {
  balance: number;
  monthlyAllowance: number;
  isUnlimited: boolean;
  periodEnd: Date;
  plan: string;
}

async function getUserPlan(userId: string): Promise<string> {
  const [user] = await db.select({ planTier: users.planTier }).from(users).where(eq(users.id, userId));
  return user?.planTier ?? 'free';
}

async function initRow(userId: string, plan: string): Promise<typeof userCredits.$inferSelect> {
  const allowance = PLAN_CREDITS[plan] ?? 0;
  const periodStart = currentPeriodStart();
  const periodEnd = currentPeriodEnd();

  const [row] = await db.insert(userCredits)
    .values({ userId, balance: allowance, periodStart, periodEnd })
    .onConflictDoNothing()
    .returning();

  if (!row) {
    // Row already exists (race), fetch it
    const [existing] = await db.select().from(userCredits).where(eq(userCredits.userId, userId));
    return existing;
  }

  if (allowance > 0) {
    await db.insert(creditTransactions).values({
      userId, delta: allowance, action: 'monthly_grant', balanceAfter: allowance,
    });
  }

  return row;
}

export async function getCredits(userId: string): Promise<CreditsState> {
  const plan = await getUserPlan(userId);
  const allowance = PLAN_CREDITS[plan] ?? 0;
  const isUnlimited = allowance === -1;

  if (isUnlimited) {
    return { balance: -1, monthlyAllowance: -1, isUnlimited: true, periodEnd: currentPeriodEnd(), plan };
  }

  let [row] = await db.select().from(userCredits).where(eq(userCredits.userId, userId));

  if (!row) {
    row = await initRow(userId, plan);
  }

  // Auto-reset if billing period expired
  const now = new Date();
  if (row.periodEnd <= now) {
    const periodStart = currentPeriodStart();
    const periodEnd = currentPeriodEnd();
    const [updated] = await db.update(userCredits)
      .set({ balance: allowance, periodStart, periodEnd, updatedAt: new Date() })
      .where(eq(userCredits.userId, userId))
      .returning();

    await db.insert(creditTransactions).values({
      userId, delta: allowance, action: 'monthly_grant', balanceAfter: allowance,
    });

    row = updated;
  }

  return { balance: row.balance, monthlyAllowance: allowance, isUnlimited: false, periodEnd: row.periodEnd, plan };
}

export interface DeductResult {
  ok: boolean;
  balance: number;
  required: number;
}

export async function deductCredits(
  userId: string,
  actions: CreditAction | CreditAction[],
  meta?: Record<string, unknown>,
): Promise<DeductResult> {
  const actionList = Array.isArray(actions) ? actions : [actions];
  const required = actionList.reduce((sum, a) => sum + CREDIT_COSTS[a], 0);

  // getCredits already fetches the plan internally, no separate getUserPlan call needed
  const state = await getCredits(userId);

  if (state.isUnlimited) {
    return { ok: true, balance: -1, required };
  }

  if (state.balance < required) {
    return { ok: false, balance: state.balance, required };
  }

  // Atomic deduct: only proceeds if balance >= required
  const [updated] = await db
    .update(userCredits)
    .set({ balance: sql`balance - ${required}`, updatedAt: new Date() })
    .where(and(eq(userCredits.userId, userId), gte(userCredits.balance, required)))
    .returning({ balance: userCredits.balance });

  if (!updated) {
    // Lost race: balance dropped between check and update
    const [fresh] = await db.select({ balance: userCredits.balance }).from(userCredits).where(eq(userCredits.userId, userId));
    return { ok: false, balance: fresh?.balance ?? 0, required };
  }

  // Batch-insert all transaction entries in one round trip
  let running = updated.balance + required;
  await db.insert(creditTransactions).values(
    actionList.map(action => {
      running -= CREDIT_COSTS[action];
      return {
        userId,
        delta: -CREDIT_COSTS[action],
        action,
        meta: actionList.length > 1 ? { ...meta, actions: actionList } : (meta ?? null),
        balanceAfter: running,
      };
    })
  );

  return { ok: true, balance: updated.balance, required };
}

// ── Operational cost telemetry: silent costs we absorb that aren't billed to users ──
// These get logged as zero-delta rows in credit_transactions so admin/costs can roll
// them up by user and plan. Cost-per-call is defined in the admin costs page only.
export type TelemetryAction =
  | 'agent_route'          // Haiku call per Telegram free-text message
  | 'rules_judge'          // Gemini Flash always-on judge per generated post
  | 'brand_enrich'         // Gemini Flash one-off after manual-form brand creation
  | 'voice_transcribe'     // Groq Whisper per Telegram voice memo
  | 'brand_profile_sync'   // TwitterAPI.io profile + 10 tweets on brand creation
  | 'mainstream_ingest'    // Gemini Flash judge call per news item per brand
  | 'telegram_brief'       // Haiku call per morning brief / evening report
  | 'x_publish'            // official X API publish of a scheduled post (no AI cost, volume telemetry)
  | 'asset_label';         // Gemini Flash vision call per uploaded image

export async function recordCost(
  userId: string,
  action: TelemetryAction,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    // Read the current balance without locking it, this row is pure telemetry.
    const [row] = await db
      .select({ balance: userCredits.balance })
      .from(userCredits)
      .where(eq(userCredits.userId, userId))
      .limit(1);
    const balanceAfter = row?.balance ?? 0;
    await db.insert(creditTransactions).values({
      userId,
      delta: 0,
      action,
      meta: meta ?? null,
      balanceAfter,
    });
  } catch (err) {
    // Telemetry must never break a user-facing path
    console.error('[recordCost] failed:', action, err instanceof Error ? err.message : err);
  }
}

// ── Daily usage limits (hard caps per plan) ──────────────────────────────────

export type DailyAction = 'generate' | 'revise';

export interface DailyLimitResult {
  allowed: boolean;
  used: number;
  limit: number;
}

export async function getDailyUsage(userId: string, action: DailyAction): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.userId, userId),
        eq(creditTransactions.action, action),
        gte(creditTransactions.createdAt, todayStart),
      )
    );
  return row?.count ?? 0;
}

export async function recordDailyAction(userId: string, action: DailyAction): Promise<void> {
  const [row] = await db.select({ balance: userCredits.balance }).from(userCredits).where(eq(userCredits.userId, userId)).limit(1);
  await db.insert(creditTransactions).values({
    userId,
    delta: 0,
    action,
    meta: null,
    balanceAfter: row?.balance ?? 0,
  }).catch(() => {});
}

export async function checkDailyLimit(userId: string, action: DailyAction): Promise<DailyLimitResult> {
  // Self-hosted installs run on the owner's own subscription or keys, so nothing is capped.
  if (!isHosted()) return { allowed: true, used: 0, limit: -1 };
  const [plan, used] = await Promise.all([getUserPlan(userId), getDailyUsage(userId, action)]);
  const config = PLAN_CONFIG[plan];
  const limit = action === 'generate' ? (config?.dailyGenerates ?? 0) : (config?.dailyRevisions ?? 0);
  return { allowed: used < limit, used, limit };
}

// Operational daily caps: count rows for an operational action since UTC midnight.
// Used for hard rate-limits on silently-absorbed costs (agent routing, voice transcribe).
export type OperationalDailyAction = 'agent_route' | 'voice_transcribe';

export async function checkOperationalDailyLimit(
  userId: string,
  action: OperationalDailyAction,
): Promise<DailyLimitResult> {
  // Self-hosted installs run on the owner's own subscription or keys, so nothing is capped.
  if (!isHosted()) return { allowed: true, used: 0, limit: -1 };
  const plan = await getUserPlan(userId);
  const config = PLAN_CONFIG[plan];
  const limit = action === 'agent_route'
    ? (config?.agentMessagesPerDay ?? 0)
    : (config?.voiceMemosPerDay ?? 0);

  // -1 sentinel = unlimited
  if (limit < 0) return { allowed: true, used: 0, limit: -1 };
  if (limit === 0) return { allowed: false, used: 0, limit: 0 };

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.userId, userId),
        eq(creditTransactions.action, action),
        gte(creditTransactions.createdAt, todayStart),
      )
    );
  const used = row?.count ?? 0;
  return { allowed: used < limit, used, limit };
}

export async function checkDailyScrapeLimit(userId: string): Promise<DailyLimitResult> {
  // Self-hosted installs run on the owner's own subscription or keys, so nothing is capped.
  if (!isHosted()) return { allowed: true, used: 0, limit: -1 };
  const plan = await getUserPlan(userId);
  const config = PLAN_CONFIG[plan];
  const clientSlots = config?.clientSlots ?? 1;
  const limit = (config?.dailyScrapesPerBrand ?? 0) * clientSlots;
  if (limit === 0) return { allowed: false, used: 0, limit: 0 };

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.userId, userId),
        sql`${creditTransactions.action} IN ('scrape_twitter', 'scrape_linkedin')`,
        gte(creditTransactions.createdAt, todayStart),
      )
    );
  const used = row?.count ?? 0;
  return { allowed: used < limit, used, limit };
}

export async function refundCredits(
  userId: string,
  action: CreditAction,
  meta?: Record<string, unknown>,
): Promise<void> {
  const plan = await getUserPlan(userId);
  const allowance = PLAN_CREDITS[plan] ?? 0;
  if (allowance === -1) return; // unlimited plan, nothing to refund

  const amount = CREDIT_COSTS[action];

  const [updated] = await db
    .update(userCredits)
    .set({ balance: sql`balance + ${amount}`, updatedAt: new Date() })
    .where(eq(userCredits.userId, userId))
    .returning({ balance: userCredits.balance });

  if (updated) {
    await db.insert(creditTransactions).values({
      userId,
      delta: amount,
      action: `${action}_refund` as CreditAction,
      meta: meta ?? null,
      balanceAfter: updated.balance,
    });
  }
}

export async function getRecentTransactions(userId: string, limit = 10) {
  return db.select().from(creditTransactions)
    .where(eq(creditTransactions.userId, userId))
    .orderBy(desc(creditTransactions.createdAt))
    .limit(limit);
}
