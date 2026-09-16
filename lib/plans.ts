// Single source of truth for plan limits and features.
// plan_tier enum: free | base | pro | growth | agency

export interface PlanLimits {
  dailyGenerates: number;        // hard cap: posts generated per day (dashboard board)
  dailyRevisions: number;        // hard cap: revisions per day
  monthlyInterviews: number;     // AI interviews per billing period
  monthlyCredits: number;        // total AI credit pool (covers all actions); -1 = unlimited
  dailyScrapesPerBrand: number;  // hard cap: manual scrape calls (twitter + linkedin) per brand per day
  agentMessagesPerDay: number;   // hard cap: free-text Telegram messages routed through Haiku agent
  voiceMemosPerDay: number;      // hard cap: Telegram voice memos transcribed via Groq Whisper
  timelineFeature: boolean;      // daily QRT + reaction angle suggestions (pro+)
  clientSlots: number;           // brand slots (agency only)
}

const HOSTED_PLANS: Record<string, PlanLimits> = {
  // Free: trial only, no card required
  free: {
    dailyGenerates:       1,
    dailyRevisions:       2,
    monthlyInterviews:    0,
    monthlyCredits:       50,
    dailyScrapesPerBrand: 2,
    agentMessagesPerDay:  10,
    voiceMemosPerDay:     3,
    timelineFeature:      false,
    clientSlots:          1,
  },
  // $99/month: Creator (no AI chat, credits start at Pro)
  base: {
    dailyGenerates:       3,
    dailyRevisions:       5,
    monthlyInterviews:    2,
    monthlyCredits:       0,
    dailyScrapesPerBrand: 5,
    agentMessagesPerDay:  30,
    voiceMemosPerDay:     10,
    timelineFeature:      false,
    clientSlots:          1,
  },
  // $199/month: Pro
  pro: {
    dailyGenerates:       3,
    dailyRevisions:       15,
    monthlyInterviews:    2,
    monthlyCredits:       2000,
    dailyScrapesPerBrand: 10,
    agentMessagesPerDay:  60,
    voiceMemosPerDay:     20,
    timelineFeature:      true,
    clientSlots:          1,
  },
  // $499/month: Growth
  growth: {
    dailyGenerates:       5,
    dailyRevisions:       20,
    monthlyInterviews:    4,
    monthlyCredits:       5000,
    dailyScrapesPerBrand: 20,
    agentMessagesPerDay:  120,
    voiceMemosPerDay:     40,
    timelineFeature:      true,
    clientSlots:          1,
  },
  // $799/month: Agency (5 brand slots)
  agency: {
    dailyGenerates:       15,
    dailyRevisions:       50,
    monthlyInterviews:    10,
    monthlyCredits:       -1,
    dailyScrapesPerBrand: 50, // hard ceiling even for unlimited to prevent runaway API costs
    agentMessagesPerDay:  300,
    voiceMemosPerDay:     100,
    timelineFeature:      true,
    clientSlots:          5,
  },
};

// dailyGenerates / dailyRevisions are per-user caps, not per-brand.
// dailyScrapesPerBrand caps manual scraping for all tiers incl. agency.

/**
 * Plans, credits and invite codes only exist on the maintainer's hosted service,
 * which sets LORE_HOSTED=true. A self-hosted install runs on its owner's own model
 * and keys, so nothing there is capped by plan.
 */
export function isHosted(): boolean {
  return process.env.LORE_HOSTED === 'true';
}

const SELF_HOSTED: PlanLimits = {
  dailyGenerates:       9999,
  dailyRevisions:       9999,
  monthlyInterviews:    9999,
  monthlyCredits:       -1,
  dailyScrapesPerBrand: 9999,
  agentMessagesPerDay:  9999,
  voiceMemosPerDay:     9999,
  timelineFeature:      true,
  clientSlots:          25,
};

export const PLAN_CONFIG: Record<string, PlanLimits> = new Proxy(HOSTED_PLANS, {
  get(target, tier) {
    if (typeof tier !== 'string') return undefined;
    return isHosted() ? target[tier] : SELF_HOSTED;
  },
});
