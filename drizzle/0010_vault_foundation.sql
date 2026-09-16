-- Vault foundation: Obsidian-style notes + visual assets + agent runs + draft sources

CREATE TYPE "vault_note_type" AS ENUM ('rule', 'story', 'belief', 'proof', 'idea', 'post', 'visual', 'profile');
CREATE TYPE "vault_note_status" AS ENUM ('active', 'archived', 'needs_review');
CREATE TYPE "vault_asset_status" AS ENUM ('processing', 'analyzing', 'ready', 'needs_review', 'failed');
CREATE TYPE "agent_run_status" AS ENUM ('queued', 'running', 'completed', 'failed');

CREATE TABLE "vault_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "path" text NOT NULL,
  "title" text NOT NULL,
  "type" "vault_note_type" NOT NULL,
  "tags" text[] NOT NULL DEFAULT '{}',
  "topics" text[] NOT NULL DEFAULT '{}',
  "summary" text,
  "body" text,
  "frontmatter" jsonb DEFAULT '{}'::jsonb,
  "source" text NOT NULL DEFAULT 'manual',
  "status" "vault_note_status" NOT NULL DEFAULT 'active',
  "content_hash" text,
  "source_ref_type" text,
  "source_ref_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "vault_notes_brand_type_idx" ON "vault_notes" ("brand_id", "type");
CREATE INDEX "vault_notes_brand_status_idx" ON "vault_notes" ("brand_id", "status");
CREATE INDEX "vault_notes_user_idx" ON "vault_notes" ("user_id");
CREATE UNIQUE INDEX "vault_notes_brand_path_idx" ON "vault_notes" ("brand_id", "path");

CREATE TABLE "vault_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "note_id" uuid REFERENCES "vault_notes"("id") ON DELETE SET NULL,
  "original_filename" text NOT NULL,
  "storage_key" text NOT NULL,
  "file_url" text NOT NULL,
  "thumbnail_url" text,
  "mime_type" text NOT NULL,
  "width" integer,
  "height" integer,
  "file_size" integer,
  "phash" text,
  "tags" text[] NOT NULL DEFAULT '{}',
  "topics" text[] NOT NULL DEFAULT '{}',
  "visual_style" text,
  "sensitivity" text NOT NULL DEFAULT 'safe',
  "usable_for" text[] NOT NULL DEFAULT '{}',
  "do_not_use_for" text[] NOT NULL DEFAULT '{}',
  "caption_summary" text,
  "text_in_image" text,
  "status" "vault_asset_status" NOT NULL DEFAULT 'processing',
  "last_used_at" timestamp,
  "upload_source" text NOT NULL DEFAULT 'upload',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "vault_assets_brand_status_idx" ON "vault_assets" ("brand_id", "status");
CREATE INDEX "vault_assets_user_idx" ON "vault_assets" ("user_id");
CREATE INDEX "vault_assets_brand_created_idx" ON "vault_assets" ("brand_id", "created_at" DESC);

CREATE TABLE "agent_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "brand_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "agent_name" text NOT NULL,
  "status" "agent_run_status" NOT NULL DEFAULT 'queued',
  "input" jsonb,
  "output" jsonb,
  "error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp
);

CREATE INDEX "agent_runs_brand_agent_idx" ON "agent_runs" ("brand_id", "agent_name");
CREATE INDEX "agent_runs_status_idx" ON "agent_runs" ("status");

CREATE TABLE "draft_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "draft_id" uuid NOT NULL REFERENCES "drafts"("id") ON DELETE CASCADE,
  "note_id" uuid REFERENCES "vault_notes"("id") ON DELETE CASCADE,
  "asset_id" uuid REFERENCES "vault_assets"("id") ON DELETE CASCADE,
  "reason" text,
  "relevance_score" real,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "draft_sources_draft_idx" ON "draft_sources" ("draft_id");
