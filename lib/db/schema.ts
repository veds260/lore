import {
  pgTable, pgEnum, uuid, text, integer, real,
  timestamp, boolean, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, type AnyColumn } from 'drizzle-orm';

// ─── Interview JSON types ─────────────────────────────────────────────────────
export interface GeneratedQuestion {
  question: string;
  category: string;
  extractionGoal: string;
  templateId?: string;
}
export interface QuestionAsked {
  question: string;
  answer: string;
  category: string;
  isFollowUp: boolean;
  timestamp: string;
}
export interface SessionState {
  currentIndex: number;
  followUpCount: number;
}

// ─── Enums ────────────────────────────────────────────────────────────────────

export const planTierEnum = pgEnum('plan_tier', ['free', 'base', 'pro', 'growth', 'agency']);

// NOTE: 'approved' and 'scored' are legacy enum values kept for PostgreSQL compatibility.
// The app no longer places cards in these statuses. The board uses 5 statuses:
// idea → draft → review → scheduled → posted
export const draftStatusEnum = pgEnum('draft_status', [
  'idea', 'draft', 'review', 'approved', 'scheduled', 'posted', 'scored',
]);

export const skillKindEnum = pgEnum('skill_kind', [
  'avoidance_rule', 'hook_formula', 'structure_template', 'voice_rule', 'format_rule',
]);

export const skillStatusEnum = pgEnum('skill_status', ['active', 'dismissed', 'consolidated']);
export const skillScopeEnum = pgEnum('skill_scope', ['brand', 'global']);

export const interviewModeEnum = pgEnum('interview_mode', ['live_video', 'text_chat']);

export const interviewStatusEnum = pgEnum('interview_status', [
  'pending', 'active', 'paused', 'completed', 'expired',
]);

// ─── Users + NextAuth tables (@auth/drizzle-adapter compatible) ───────────────

export const users = pgTable('users', {
  // NextAuth required columns (exact names)
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: text('image'),
  // Lore custom columns
  planTier: planTierEnum('plan_tier').notNull().default('free'),
  interviewsPerMonth: integer('interviews_per_month').notNull().default(0),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  // Telegram bot linking
  telegramChatId: text('telegram_chat_id'),
  telegramLinkToken: text('telegram_link_token'),
  telegramLinkedAt: timestamp('telegram_linked_at'),
  telegramLastIdeas: jsonb('telegram_last_ideas').$type<{
    type: 'daily' | 'perf' | 'list_ideas' | 'list_drafts';
    sentAt: string;
    ideas: Array<{ index: number; content: string; hook?: string; draftId?: string; linkedinContent?: string }>;
    highPostId?: string;
    highPostContent?: string;
  }>(),
  // Rolling buffer of the last ~10 telegram exchanges so the agent loop has context.
  // Each entry: { role: 'user' | 'assistant', content, ts }. Trimmed to 20 max.
  telegramHistory: jsonb('telegram_history').$type<Array<{
    role: 'user' | 'assistant';
    content: string;
    ts: string;
  }>>(),
  // Per-account tour completion, replaces browser localStorage so a DB reset re-fires the tour
  tourCompletedAt: timestamp('tour_completed_at'),
  drawerTourCompletedAt: timestamp('drawer_tour_completed_at'),
  // Per-ritual opt-outs. Key = ritual id ('morning_brief' | 'evening_report' | ...),
  // absent key = enabled (rituals are on by default for linked users).
  ritualSettings: jsonb('ritual_settings').$type<Record<string, { enabled: boolean }>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const accounts = pgTable('accounts', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  refresh_token: text('refresh_token'),
  access_token: text('access_token'),
  expires_at: integer('expires_at'),
  token_type: text('token_type'),
  scope: text('scope'),
  id_token: text('id_token'),
  session_state: text('session_state'),
}, (t) => [
  uniqueIndex('accounts_provider_account_idx').on(t.provider, t.providerAccountId),
]);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable('verification_tokens', {
  identifier: text('identifier').notNull(),
  token: text('token').notNull(),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
}, (t) => [
  uniqueIndex('vt_identifier_token_idx').on(t.identifier, t.token),
]);

// ─── Brands ───────────────────────

export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  handle: text('handle'),                     // Twitter/X handle
  linkedinHandle: text('linkedin_handle'),    // LinkedIn handle/URL
  avatarUrl: text('avatar_url'),
  niche: text('niche'),                       // e.g. "Web3", "SaaS founders", "Fitness"
  voiceSummary: text('voice_summary'),        // 1-para plain text voice description
  briefMd: text('brief_md'),                  // Full brief: audience, goals, off-limits
  styleGuideMd: text('style_guide_md'),       // Human-written style rules (never auto-overwritten)
  voiceDocument: text('voice_document'),      // AI-synthesized living voice doc (updated weekly by cron)
  voiceDocumentUpdatedAt: timestamp('voice_document_updated_at'), // last synthesis timestamp
  voiceSamples: text('voice_samples'),        // JSON string[] of the raw posts the voice was built from, layout/few-shot fallback when own_posts is sparse (new profiles)
  contentPillars: jsonb('content_pillars').$type<string[]>().default([]),
  contentStyle: text('content_style').default('mixed'),  // 'witty-short' | 'deep-value' | 'mixed'
  selectedCategories: text('selected_categories').array().notNull().default([]),
  weeklyFocus: text('weekly_focus'),
  linkedinPersonId: text('linkedin_person_id'),
  linkedinAccessToken: text('linkedin_access_token'),
  linkedinRefreshToken: text('linkedin_refresh_token'),
  linkedinTokenExpiresAt: timestamp('linkedin_token_expires_at'),
  // Official X API OAuth2 (user context). POSTING ONLY, all reads stay on
  // twitterapi.io. Do not add a read path on these tokens (the official key
  // was once drained by uncached analytics reads).
  xUserId: text('x_user_id'),
  xUsername: text('x_username'),
  xAccessToken: text('x_access_token'),
  xRefreshToken: text('x_refresh_token'),
  xTokenExpiresAt: timestamp('x_token_expires_at'),
  xScope: text('x_scope'),
  // Opt-in flag: if true, the "satirical character voice" LinkedIn template
  // becomes eligible for auto-pick / per-post selection. Off by default since
  // satirical/absurdist register fits very few brands.
  allowUnhingedMode: boolean('allow_unhinged_mode').notNull().default(false),
  // Opt-in flag: surface mainstream tech/AI news items in the LinkedIn pulse.
  // Off by default, only AI/tech/founder brands benefit. Niche brands
  // (e.g. a niche-only brand) will see off-brand items if this is on.
  mainstreamNewsEnabled: boolean('mainstream_news_enabled').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('brands_user_idx').on(t.userId),
]);

// ─── Drafts ───────────────────────────────────────────────────────────────────

export const drafts = pgTable('drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  status: draftStatusEnum('status').notNull().default('draft'),
  // Scoring (1-10 per dimension, populated after quality check)
  qualityScore: real('quality_score'),
  hookScore: real('hook_score'),
  substanceScore: real('substance_score'),
  authenticityScore: real('authenticity_score'),
  formattingScore: real('formatting_score'),
  // Performance (populated after posting)
  postedAt: timestamp('posted_at'),
  likes: integer('likes'),
  reposts: integer('reposts'),
  replies: integer('replies'),
  impressions: integer('impressions'),
  engagementScore: real('engagement_score'),
  // Metadata
  hookType: text('hook_type'),                // 'stat', 'story', 'contrarian', etc.
  contentFormat: text('content_format'),      // 'single-punch', 'arrow-list', etc.
  contentCategory: text('content_category'),  // build-in-public | educational | storytelling | etc.
  scheduledFor: timestamp('scheduled_for'),
  sourceTemplateId: uuid('source_template_id'),
  notes: text('notes'),
  isApproved: boolean('is_approved').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('drafts_brand_status_idx').on(t.brandId, t.status),
  index('drafts_user_idx').on(t.userId),
]);

// ─── Corrections (user feedback on drafts) ────────────────────────────────────

export const corrections = pgTable('corrections', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  note: text('note').notNull(),
  context: text('context'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  absorbedAt: timestamp('absorbed_at'),
}, (t) => [
  index('corrections_brand_idx').on(t.brandId),
]);

// ─── Skills (learned rules per brand) ────────────────────────────────────────

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  scope: skillScopeEnum('scope').notNull().default('brand'),
  name: text('name').notNull(),
  kind: skillKindEnum('kind').notNull(),
  body: text('body').notNull(),
  status: skillStatusEnum('status').notNull().default('active'),
  confidence: real('confidence').notNull().default(0.5),
  source: text('source').notNull().default('manual'), // 'auto' | 'manual' | 'consolidated'
  timesApplied: integer('times_applied').notNull().default(0),
  lastAppliedAt: timestamp('last_applied_at'),        // updated by selectSkillsForPrompt / voice doc synthesis
  triggerConditions: jsonb('trigger_conditions'),      // { keywords: string[] }
  evidence: jsonb('evidence'),                        // { original: string, revised: string, instruction: string }
  supersededBy: uuid('superseded_by'),                // FK to skills.id, set when contradiction replaces this skill
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  absorbedAt: timestamp('absorbed_at'),               // set when skill is synthesized into voiceDocument
}, (t) => [
  index('skills_brand_status_idx').on(t.brandId, t.status),
  index('skills_brand_source_idx').on(t.brandId, t.source),
]);

// ─── Interview Question Templates ────────────────────────────────────────────

export const questionTemplateEnum = pgEnum('question_template_category', [
  'origin_story', 'success_story', 'failure_story', 'turning_point',
  'hot_take', 'contrarian_view', 'industry_critique',
  'values', 'influences', 'prediction', 'advice',
  'technical', 'framework', 'how_to', 'lessons', 'habits',
  'build_in_public',
]);

export const questionTemplates = pgTable('question_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  category: questionTemplateEnum('category').notNull(),
  baseQuestion: text('base_question').notNull(),   // generic form, never shown to users
  extractionGoal: text('extraction_goal').notNull(), // what this question tries to surface
  difficulty: text('difficulty').notNull().default('medium'), // easy | medium | deep
  clipPotential: integer('clip_potential').notNull().default(7), // 1-10
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─── Interview Sessions ───────────────────────────────────────────────────────

export const interviewSessions = pgTable('interview_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
  mode: interviewModeEnum('mode').notNull().default('text_chat'),
  status: interviewStatusEnum('status').notNull().default('pending'),
  shareToken: text('share_token').unique(),
  expiresAt: timestamp('expires_at'),
  guestName: text('guest_name'),
  startedAt: timestamp('started_at'),
  // Personalized questions generated by AI before the interview starts
  // Array of { question, category, extractionGoal, templateId? }
  generatedQuestions: jsonb('generated_questions').$type<GeneratedQuestion[]>().default([]),
  // Accumulated answers: { question, answer, category, isFollowUp, timestamp }
  questionsAsked: jsonb('questions_asked').$type<QuestionAsked[]>().default([]),
  // Runtime state: { currentIndex, followUpCount }
  sessionState: jsonb('session_state').$type<SessionState>().default({ currentIndex: 0, followUpCount: 0 }),
  transcriptMarkdown: text('transcript_markdown'),
  pausedAt: timestamp('paused_at'),
  billingPeriod: text('billing_period').notNull(),
  completedAt: timestamp('completed_at'),
  synthesisStatus: text('synthesis_status'),  // null | 'pending' | 'completed' | 'failed'
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('interviews_user_idx').on(t.userId),
  index('interviews_user_period_idx').on(t.userId, t.billingPeriod),
  index('interviews_token_idx').on(t.shareToken),
  index('interviews_user_status_idx').on(t.userId, t.status),
]);

// ─── Interview Messages (per-session chat log) ────────────────────────────────

export const interviewMessages = pgTable('interview_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => interviewSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'interviewer' | 'user'
  content: text('content').notNull(),
  questionIndex: integer('question_index'),
  isFollowUp: boolean('is_follow_up').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('interview_messages_session_idx').on(t.sessionId),
]);

// ─── Scheduled Posts ─────────────────────────────────────────────────────────

// ─── Own Posts (founder's existing Twitter posts, cached for dedup) ──────────

export const ownPosts = pgTable('own_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull().default('twitter'), // 'twitter' | 'linkedin'
  externalId: text('external_id').notNull(),
  content: text('content').notNull(),
  postedAt: timestamp('posted_at').notNull(),
  likeCount: integer('like_count').notNull().default(0),
  retweetCount: integer('retweet_count').notNull().default(0),
  replyCount: integer('reply_count').notNull().default(0),
  viewCount: integer('view_count').notNull().default(0),
  commentCount: integer('comment_count').notNull().default(0), // LinkedIn comments
  fetchedAt: timestamp('fetched_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('own_posts_brand_external_idx').on(t.brandId, t.externalId),
  index('own_posts_brand_platform_idx').on(t.brandId, t.platform),
  index('own_posts_posted_at_idx').on(t.postedAt),
]);

// ─── Follower Snapshots (daily count per platform) ────────────────────────────

export const followerSnapshots = pgTable('follower_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(), // 'twitter' | 'linkedin'
  followerCount: integer('follower_count').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('follower_snapshots_brand_platform_idx').on(t.brandId, t.platform),
  index('follower_snapshots_recorded_idx').on(t.recordedAt),
]);

// ─── Scheduled Posts ─────────────────────────────────────────────────────────

export const scheduledPosts = pgTable('scheduled_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
  platform: text('platform').notNull(), // 'twitter' | 'linkedin'
  content: text('content').notNull(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'posting' | 'posted' | 'failed' | 'cancelled'
  postedAt: timestamp('posted_at', { withTimezone: true }),
  postUrl: text('post_url'),
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('scheduled_posts_user_status_idx').on(t.userId, t.status),
  index('scheduled_posts_scheduled_for_idx').on(t.scheduledFor),
]);

// ─── Account Connections (social platform sessions) ──────────────────────────

export const accountConnections = pgTable('account_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(), // 'twitter' | 'linkedin'
  connectedAt: timestamp('connected_at').notNull().defaultNow(),
  lastVerifiedAt: timestamp('last_verified_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('account_connections_user_platform_idx').on(t.userId, t.platform),
]);

// ─── Chat Conversations ───────────────────────────────────────────────────────

export const chatConversations = pgTable('chat_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('chat_conversations_user_idx').on(t.userId),
]);

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant'
  text: text('text'),
  posts: jsonb('posts').$type<{ twitter: string; linkedin: string } | null>(),
  isQuestion: boolean('is_question').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('chat_messages_conv_idx').on(t.conversationId),
]);

// ─── Learning Reports (weekly digest snapshots) ───────────────────────────────

export const learningReports = pgTable('learning_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  weekOf: text('week_of').notNull(),           // 'YYYY-WW'
  summary: text('summary'),
  newSkillsCount: integer('new_skills_count').notNull().default(0),
  postsScored: integer('posts_scored').notNull().default(0),
  topHook: text('top_hook'),
  data: jsonb('data'),                         // full report payload
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('reports_brand_week_idx').on(t.brandId, t.weekOf),
]);

// ─── Credit System ────────────────────────────────────────────────────────────

export const userCredits = pgTable('user_credits', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  balance: integer('balance').notNull().default(0),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('user_credits_user_idx').on(t.userId),
]);

export const creditTransactions = pgTable('credit_transactions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  delta: integer('delta').notNull(),        // negative = usage, positive = grant
  action: text('action').notNull(),         // 'generate' | 'revise' | 'interview' | 'scrape_twitter' | 'scrape_youtube' | 'scrape_reddit' | 'scrape_url' | 'monthly_grant'
  meta: jsonb('meta'),
  balanceAfter: integer('balance_after').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('credit_tx_user_idx').on(t.userId),
  index('credit_tx_created_idx').on(t.createdAt),
  // Covers daily limit queries: WHERE userId = ? AND action = ? AND createdAt >= ?
  index('credit_tx_user_action_date_idx').on(t.userId, t.action, t.createdAt),
]);

// ─── Viral Post Patterns ────────────────────

export const postPatterns = pgTable('post_patterns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  template: text('template').notNull(),              // structural blueprint with [brackets]
  description: text('description'),
  example: text('example'),                          // real viral tweet using this structure
  hookType: text('hook_type'),                       // contrarian | story | outcome | question | etc.
  formatType: text('format_type'),                   // single-punch | line-per-point | numbered-list | etc.
  bodyStructure: text('body_structure'),             // short-punch | before-after | narrative | etc.
  closerType: text('closer_type'),                   // punchline | question_cta | open_loop | etc.
  engagementTarget: text('engagement_target'),       // save | share | reply | follow
  coreInsight: text('core_insight'),                 // why this post went viral (1-2 sentences)
  viralMechanic: text('viral_mechanic'),             // gap-reveal | borrowed-authority | debate-bait | etc.
  emotionTrigger: text('emotion_trigger'),           // curiosity | aspiration | fear | validation | etc.
  reusableFor: jsonb('reusable_for').$type<string[]>().default([]),
  postType: text('post_type').default('tweet'),      // tweet | thread | long-post
  contentCategory: text('content_category'),         // build-in-public | thought-leadership | thesis-building | ragebait | storytelling | authority | article | visual | educational | etc.
  tweetUrl: text('tweet_url'),                       // optional source URL for admin reference
  imageUrl: text('image_url'),                        // for visual category: the image from the source tweet
  isQrt: boolean('is_qrt').notNull().default(false),  // true = quote-repost format (requires source tweet)
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('post_patterns_hook_idx').on(t.hookType),
  index('post_patterns_format_idx').on(t.formatType),
  index('post_patterns_active_idx').on(t.isActive),
]);

// ─── Template Usage (per-brand tracking to avoid repeating templates) ─────────

export const templateUsage = pgTable('template_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  templateId: uuid('template_id').notNull().references(() => postPatterns.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('template_usage_brand_idx').on(t.brandId),
  index('template_usage_brand_template_idx').on(t.brandId, t.templateId),
]);

// ─── Cron Infrastructure ─────────────────────────────────────────────────────

export const cronRuns = pgTable('cron_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobName: text('job_name').notNull(),
  status: text('status').notNull(), // 'success' | 'failed' | 'skipped'
  triggeredBy: text('triggered_by').notNull().default('schedule'), // 'schedule' | 'manual'
  result: jsonb('result'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('cron_runs_job_created_idx').on(t.jobName, t.createdAt),
]);

export const systemConfig = pgTable('system_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── Brand Voice History (append-only snapshot on every synthesis run) ───────

export const brandVoiceHistory = pgTable('brand_voice_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  voiceDocument: text('voice_document').notNull(),
  version: integer('version').notNull().default(1),
  triggeredBy: text('triggered_by').notNull().default('weekly_cron'), // 'weekly_cron' | 'manual' | 'init'
  skillsIncluded: integer('skills_included').notNull().default(0),    // how many skills were in the source pool
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('voice_history_brand_idx').on(t.brandId),
  index('voice_history_brand_created_idx').on(t.brandId, t.createdAt),
]);

// ─── Mainstream news ingestion (RSS-fed, per-brand AI scoring) ───────────────

export const mainstreamNewsItems = pgTable('mainstream_news_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull(),                          // techcrunch | hackernews | techmeme | verge | ...
  title: text('title').notNull(),
  summary: text('summary'),
  url: text('url').notNull().unique(),
  imageUrl: text('image_url'),
  namedEntities: jsonb('named_entities').$type<string[]>().default([]),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('mainstream_news_published_idx').on(t.publishedAt),
  index('mainstream_news_fetched_idx').on(t.fetchedAt),
]);

export const brandNewsScores = pgTable('brand_news_scores', {
  id: uuid('id').primaryKey().defaultRandom(),
  brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  newsItemId: uuid('news_item_id').notNull().references(() => mainstreamNewsItems.id, { onDelete: 'cascade' }),
  relevanceScore: integer('relevance_score').notNull(),       // 0-10, brand-fit
  viralityScore: integer('virality_score').notNull(),         // 0-10, universal appeal
  combinedScore: real('combined_score').notNull(),            // relevance*0.6 + virality*0.4
  suggestedAngle: text('suggested_angle'),
  skipReason: text('skip_reason'),
  scoredAt: timestamp('scored_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('brand_news_brand_score_idx').on(t.brandId, t.combinedScore),
]);

// ─── Visual Inspirations (global image style references) ─────────────────────

export const visualInspirations = pgTable('visual_inspirations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  stylePrompt: text('style_prompt').notNull(),
  category: text('category').notNull().default('diagram'), // diagram | list | chart | branding | illustration | image
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─── Vault (Obsidian-style notes + visual assets per brand) ───────────────────

export const vaultNoteTypeEnum = pgEnum('vault_note_type', [
  'rule', 'story', 'belief', 'proof', 'idea', 'post', 'visual', 'profile',
]);

export const vaultNoteStatusEnum = pgEnum('vault_note_status', [
  'active', 'archived', 'needs_review',
]);

export const vaultScopeEnum = pgEnum('vault_scope', ['global', 'tenant']);

export const vaultAssetStatusEnum = pgEnum('vault_asset_status', [
  'processing', 'analyzing', 'ready', 'needs_review', 'failed',
]);

export const agentRunStatusEnum = pgEnum('agent_run_status', [
  'queued', 'running', 'completed', 'failed',
]);

// vault_notes: metadata for markdown notes. Markdown body lives in `body` so the
// app can serve the slice as-is without a filesystem. Path is the logical vault
// location (e.g. `00-profile/voice.md`), primarily used for organization in UI.
export const vaultNotes = pgTable('vault_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'cascade' }),
  scope: vaultScopeEnum('scope').notNull().default('tenant'),
  path: text('path').notNull(),                    // e.g. '00-profile/voice.md'
  title: text('title').notNull(),
  type: vaultNoteTypeEnum('type').notNull(),
  tags: text('tags').array().notNull().default([]),
  topics: text('topics').array().notNull().default([]),
  summary: text('summary'),
  body: text('body'),                              // markdown body (without frontmatter)
  frontmatter: jsonb('frontmatter').$type<Record<string, unknown>>().default({}),
  source: text('source').notNull().default('manual'), // manual | onboarding | upload | agent | post_feedback | import | skill_mirror | correction_mirror | voice_doc_mirror
  status: vaultNoteStatusEnum('status').notNull().default('active'),
  contentHash: text('content_hash'),
  // When this row mirrors something from the existing self-learning system,
  // remember the source so we can update in place rather than duplicating.
  sourceRefType: text('source_ref_type'),          // 'skill' | 'correction' | 'voice_document' | null
  sourceRefId: text('source_ref_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('vault_notes_brand_type_idx').on(t.brandId, t.type),
  index('vault_notes_brand_status_idx').on(t.brandId, t.status),
  index('vault_notes_scope_status_idx').on(t.scope, t.status),
  index('vault_notes_user_idx').on(t.userId),
  uniqueIndex('vault_notes_brand_path_idx').on(t.brandId, t.path),
]);

// vault_assets: uploaded files. Stored under a local storage_key by default
// (see lib/vault/storage.ts). `file_url` is a resolved URL the UI can render.
export const vaultAssets = pgTable('vault_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'cascade' }),
  noteId: uuid('note_id').references(() => vaultNotes.id, { onDelete: 'set null' }),
  originalFilename: text('original_filename').notNull(),
  storageKey: text('storage_key').notNull(),
  fileUrl: text('file_url').notNull(),
  thumbnailUrl: text('thumbnail_url'),
  mimeType: text('mime_type').notNull(),
  width: integer('width'),
  height: integer('height'),
  fileSize: integer('file_size'),
  phash: text('phash'),
  // Tagging surface, mirrored into the linked visual note so the UI can edit
  // either place and stay in sync.
  tags: text('tags').array().notNull().default([]),
  topics: text('topics').array().notNull().default([]),
  visualStyle: text('visual_style'),               // candid-photo | screenshot | chart | diagram | meme | product-shot | brand-asset
  sensitivity: text('sensitivity').notNull().default('safe'), // safe | private | client-confidential | needs_review
  usableFor: text('usable_for').array().notNull().default([]),
  doNotUseFor: text('do_not_use_for').array().notNull().default([]),
  captionSummary: text('caption_summary'),
  textInImage: text('text_in_image'),
  status: vaultAssetStatusEnum('status').notNull().default('processing'),
  lastUsedAt: timestamp('last_used_at'),
  uploadSource: text('upload_source').notNull().default('upload'), // upload | folder | drag_drop
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('vault_assets_brand_status_idx').on(t.brandId, t.status),
  index('vault_assets_user_idx').on(t.userId),
  index('vault_assets_brand_created_idx').on(t.brandId, t.createdAt),
]);

// agent_runs: ledger of background/agent work (curator, visual librarian, etc).
export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'cascade' }),
  agentName: text('agent_name').notNull(),
  status: agentRunStatusEnum('status').notNull().default('queued'),
  input: jsonb('input'),
  output: jsonb('output'),
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
}, (t) => [
  index('agent_runs_brand_agent_idx').on(t.brandId, t.agentName),
  index('agent_runs_status_idx').on(t.status),
]);

// draft_sources: cite which vault notes/assets fed a draft generation.
export const draftSources = pgTable('draft_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  draftId: uuid('draft_id').notNull().references(() => drafts.id, { onDelete: 'cascade' }),
  noteId: uuid('note_id').references(() => vaultNotes.id, { onDelete: 'cascade' }),
  assetId: uuid('asset_id').references(() => vaultAssets.id, { onDelete: 'cascade' }),
  reason: text('reason'),
  relevanceScore: real('relevance_score'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('draft_sources_draft_idx').on(t.draftId),
]);

// ─── Invite Codes ─────────────────────────────────────────────────────────────

export const inviteCodes = pgTable('invite_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  planTier: planTierEnum('plan_tier').notNull().default('pro'),
  note: text('note'),
  redeemedBy: text('redeemed_by'),         // userId of who used it
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  brands: many(brands),
  drafts: many(drafts),
  interviewSessions: many(interviewSessions),
  scheduledPosts: many(scheduledPosts),
  creditTransactions: many(creditTransactions),
}));

export const brandsRelations = relations(brands, ({ one, many }) => ({
  user: one(users, { fields: [brands.userId], references: [users.id] }),
  drafts: many(drafts),
  skills: many(skills),
  corrections: many(corrections),
  interviewSessions: many(interviewSessions),
  learningReports: many(learningReports),
  voiceHistory: many(brandVoiceHistory),
}));

export const brandVoiceHistoryRelations = relations(brandVoiceHistory, ({ one }) => ({
  brand: one(brands, { fields: [brandVoiceHistory.brandId], references: [brands.id] }),
}));

export const draftsRelations = relations(drafts, ({ one }) => ({
  brand: one(brands, { fields: [drafts.brandId], references: [brands.id] }),
  user: one(users, { fields: [drafts.userId], references: [users.id] }),
}));

export const skillsRelations = relations(skills, ({ one }) => ({
  brand: one(brands, { fields: [skills.brandId], references: [brands.id] }),
}));

export const interviewSessionsRelations = relations(interviewSessions, ({ one, many }) => ({
  user: one(users, { fields: [interviewSessions.userId], references: [users.id] }),
  brand: one(brands, { fields: [interviewSessions.brandId], references: [brands.id] }),
  messages: many(interviewMessages),
}));

export const interviewMessagesRelations = relations(interviewMessages, ({ one }) => ({
  session: one(interviewSessions, { fields: [interviewMessages.sessionId], references: [interviewSessions.id] }),
}));

export const chatConversationsRelations = relations(chatConversations, ({ one, many }) => ({
  user: one(users, { fields: [chatConversations.userId], references: [users.id] }),
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  conversation: one(chatConversations, { fields: [chatMessages.conversationId], references: [chatConversations.id] }),
}));

export const scheduledPostsRelations = relations(scheduledPosts, ({ one }) => ({
  user: one(users, { fields: [scheduledPosts.userId], references: [users.id] }),
  brand: one(brands, { fields: [scheduledPosts.brandId], references: [brands.id] }),
}));

export const userCreditsRelations = relations(userCredits, ({ one }) => ({
  user: one(users, { fields: [userCredits.userId], references: [users.id] }),
}));

export const creditTransactionsRelations = relations(creditTransactions, ({ one }) => ({
  user: one(users, { fields: [creditTransactions.userId], references: [users.id] }),
}));

export const templateUsageRelations = relations(templateUsage, ({ one }) => ({
  brand: one(brands, { fields: [templateUsage.brandId], references: [brands.id] }),
  template: one(postPatterns, { fields: [templateUsage.templateId], references: [postPatterns.id] }),
}));

export const ownPostsRelations = relations(ownPosts, ({ one }) => ({
  brand: one(brands, { fields: [ownPosts.brandId], references: [brands.id] }),
}));

export const vaultNotesRelations = relations(vaultNotes, ({ one, many }) => ({
  user: one(users, { fields: [vaultNotes.userId], references: [users.id] }),
  brand: one(brands, { fields: [vaultNotes.brandId], references: [brands.id] }),
  assets: many(vaultAssets),
}));

export const vaultAssetsRelations = relations(vaultAssets, ({ one }) => ({
  user: one(users, { fields: [vaultAssets.userId], references: [users.id] }),
  brand: one(brands, { fields: [vaultAssets.brandId], references: [brands.id] }),
  note: one(vaultNotes, { fields: [vaultAssets.noteId], references: [vaultNotes.id] }),
}));

export const draftSourcesRelations = relations(draftSources, ({ one }) => ({
  draft: one(drafts, { fields: [draftSources.draftId], references: [drafts.id] }),
  note: one(vaultNotes, { fields: [draftSources.noteId], references: [vaultNotes.id] }),
  asset: one(vaultAssets, { fields: [draftSources.assetId], references: [vaultAssets.id] }),
}));

export const agentRunsRelations = relations(agentRuns, ({ one }) => ({
  user: one(users, { fields: [agentRuns.userId], references: [users.id] }),
  brand: one(brands, { fields: [agentRuns.brandId], references: [brands.id] }),
}));
