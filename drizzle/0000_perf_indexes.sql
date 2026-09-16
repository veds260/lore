CREATE TYPE "public"."draft_status" AS ENUM('idea', 'draft', 'review', 'approved', 'scheduled', 'posted', 'scored');--> statement-breakpoint
CREATE TYPE "public"."interview_mode" AS ENUM('live_video', 'text_chat');--> statement-breakpoint
CREATE TYPE "public"."interview_status" AS ENUM('pending', 'active', 'paused', 'completed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('free', 'base', 'pro', 'growth', 'agency');--> statement-breakpoint
CREATE TYPE "public"."question_template_category" AS ENUM('origin_story', 'success_story', 'failure_story', 'turning_point', 'hot_take', 'contrarian_view', 'industry_critique', 'values', 'influences', 'prediction', 'advice', 'technical', 'framework', 'how_to', 'lessons', 'habits');--> statement-breakpoint
CREATE TYPE "public"."skill_kind" AS ENUM('avoidance_rule', 'hook_formula', 'structure_template', 'voice_rule', 'format_rule');--> statement-breakpoint
CREATE TYPE "public"."skill_scope" AS ENUM('brand', 'global');--> statement-breakpoint
CREATE TYPE "public"."skill_status" AS ENUM('active', 'dismissed', 'consolidated');--> statement-breakpoint
CREATE TABLE "account_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"last_verified_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text
);
--> statement-breakpoint
CREATE TABLE "brand_voice_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"voice_document" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"triggered_by" text DEFAULT 'weekly_cron' NOT NULL,
	"skills_included" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"handle" text,
	"linkedin_handle" text,
	"avatar_url" text,
	"niche" text,
	"voice_summary" text,
	"brief_md" text,
	"style_guide_md" text,
	"voice_document" text,
	"voice_document_updated_at" timestamp,
	"content_pillars" jsonb DEFAULT '[]'::jsonb,
	"weekly_focus" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"text" text,
	"posts" jsonb,
	"is_question" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"note" text NOT NULL,
	"context" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"delta" integer NOT NULL,
	"action" text NOT NULL,
	"meta" jsonb,
	"balance_after" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"status" text NOT NULL,
	"triggered_by" text DEFAULT 'schedule' NOT NULL,
	"result" jsonb,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"status" "draft_status" DEFAULT 'draft' NOT NULL,
	"quality_score" real,
	"hook_score" real,
	"substance_score" real,
	"authenticity_score" real,
	"formatting_score" real,
	"posted_at" timestamp,
	"likes" integer,
	"reposts" integer,
	"replies" integer,
	"impressions" integer,
	"engagement_score" real,
	"hook_type" text,
	"content_format" text,
	"scheduled_for" timestamp,
	"source_template_id" uuid,
	"notes" text,
	"is_approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follower_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"follower_count" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"question_index" integer,
	"is_follow_up" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"brand_id" uuid,
	"mode" "interview_mode" DEFAULT 'text_chat' NOT NULL,
	"status" "interview_status" DEFAULT 'pending' NOT NULL,
	"share_token" text,
	"expires_at" timestamp,
	"guest_name" text,
	"started_at" timestamp,
	"generated_questions" jsonb DEFAULT '[]'::jsonb,
	"questions_asked" jsonb DEFAULT '[]'::jsonb,
	"session_state" jsonb DEFAULT '{"currentIndex":0,"followUpCount":0}'::jsonb,
	"transcript_markdown" text,
	"paused_at" timestamp,
	"billing_period" text NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "interview_sessions_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "learning_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"week_of" text NOT NULL,
	"summary" text,
	"new_skills_count" integer DEFAULT 0 NOT NULL,
	"posts_scored" integer DEFAULT 0 NOT NULL,
	"top_hook" text,
	"data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "own_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"platform" text DEFAULT 'twitter' NOT NULL,
	"external_id" text NOT NULL,
	"content" text NOT NULL,
	"posted_at" timestamp NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"retweet_count" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"template" text NOT NULL,
	"description" text,
	"example" text,
	"hook_type" text,
	"format_type" text,
	"body_structure" text,
	"closer_type" text,
	"engagement_target" text,
	"core_insight" text,
	"viral_mechanic" text,
	"emotion_trigger" text,
	"reusable_for" jsonb DEFAULT '[]'::jsonb,
	"post_type" text DEFAULT 'tweet',
	"content_category" text,
	"tweet_url" text,
	"image_url" text,
	"is_qrt" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "question_template_category" NOT NULL,
	"base_question" text NOT NULL,
	"extraction_goal" text NOT NULL,
	"difficulty" text DEFAULT 'medium' NOT NULL,
	"clip_potential" integer DEFAULT 7 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"brand_id" uuid,
	"platform" text NOT NULL,
	"content" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"posted_at" timestamp with time zone,
	"post_url" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid,
	"user_id" text,
	"scope" "skill_scope" DEFAULT 'brand' NOT NULL,
	"name" text NOT NULL,
	"kind" "skill_kind" NOT NULL,
	"body" text NOT NULL,
	"status" "skill_status" DEFAULT 'active' NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"times_applied" integer DEFAULT 0 NOT NULL,
	"last_applied_at" timestamp,
	"trigger_conditions" jsonb,
	"evidence" jsonb,
	"superseded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_credits" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp,
	"image" text,
	"plan_tier" "plan_tier" DEFAULT 'free' NOT NULL,
	"interviews_per_month" integer DEFAULT 0 NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_connections" ADD CONSTRAINT "account_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_voice_history" ADD CONSTRAINT "brand_voice_history_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follower_snapshots" ADD CONSTRAINT "follower_snapshots_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_messages" ADD CONSTRAINT "interview_messages_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_reports" ADD CONSTRAINT "learning_reports_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_posts" ADD CONSTRAINT "own_posts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_usage" ADD CONSTRAINT "template_usage_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_usage" ADD CONSTRAINT "template_usage_template_id_post_patterns_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."post_patterns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_credits" ADD CONSTRAINT "user_credits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_connections_user_platform_idx" ON "account_connections" USING btree ("user_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_idx" ON "accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "voice_history_brand_idx" ON "brand_voice_history" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "voice_history_brand_created_idx" ON "brand_voice_history" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX "brands_user_idx" ON "brands" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_conversations_user_idx" ON "chat_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_messages_conv_idx" ON "chat_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "corrections_brand_idx" ON "corrections" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "credit_tx_user_idx" ON "credit_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_tx_created_idx" ON "credit_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "credit_tx_user_action_date_idx" ON "credit_transactions" USING btree ("user_id","action","created_at");--> statement-breakpoint
CREATE INDEX "cron_runs_job_created_idx" ON "cron_runs" USING btree ("job_name","created_at");--> statement-breakpoint
CREATE INDEX "drafts_brand_status_idx" ON "drafts" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "drafts_user_idx" ON "drafts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "follower_snapshots_brand_platform_idx" ON "follower_snapshots" USING btree ("brand_id","platform");--> statement-breakpoint
CREATE INDEX "follower_snapshots_recorded_idx" ON "follower_snapshots" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "interview_messages_session_idx" ON "interview_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "interviews_user_idx" ON "interview_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "interviews_user_period_idx" ON "interview_sessions" USING btree ("user_id","billing_period");--> statement-breakpoint
CREATE INDEX "interviews_token_idx" ON "interview_sessions" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "interviews_user_status_idx" ON "interview_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_brand_week_idx" ON "learning_reports" USING btree ("brand_id","week_of");--> statement-breakpoint
CREATE UNIQUE INDEX "own_posts_brand_external_idx" ON "own_posts" USING btree ("brand_id","external_id");--> statement-breakpoint
CREATE INDEX "own_posts_brand_platform_idx" ON "own_posts" USING btree ("brand_id","platform");--> statement-breakpoint
CREATE INDEX "own_posts_posted_at_idx" ON "own_posts" USING btree ("posted_at");--> statement-breakpoint
CREATE INDEX "post_patterns_hook_idx" ON "post_patterns" USING btree ("hook_type");--> statement-breakpoint
CREATE INDEX "post_patterns_format_idx" ON "post_patterns" USING btree ("format_type");--> statement-breakpoint
CREATE INDEX "post_patterns_active_idx" ON "post_patterns" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "scheduled_posts_user_status_idx" ON "scheduled_posts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "scheduled_posts_scheduled_for_idx" ON "scheduled_posts" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "skills_brand_status_idx" ON "skills" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "skills_brand_source_idx" ON "skills" USING btree ("brand_id","source");--> statement-breakpoint
CREATE INDEX "template_usage_brand_idx" ON "template_usage" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "template_usage_brand_template_idx" ON "template_usage" USING btree ("brand_id","template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_credits_user_idx" ON "user_credits" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vt_identifier_token_idx" ON "verification_tokens" USING btree ("identifier","token");