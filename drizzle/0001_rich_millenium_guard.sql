ALTER TYPE "public"."question_template_category" ADD VALUE 'build_in_public';--> statement-breakpoint
CREATE TABLE "visual_inspirations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"style_prompt" text NOT NULL,
	"category" text DEFAULT 'diagram' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "content_style" text DEFAULT 'mixed';--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "selected_categories" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "linkedin_person_id" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "linkedin_access_token" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "linkedin_refresh_token" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "linkedin_token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "corrections" ADD COLUMN "absorbed_at" timestamp;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "content_category" text;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "synthesis_status" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "absorbed_at" timestamp;