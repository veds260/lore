-- Rituals: per-user opt-outs for proactive jobs (absent key = enabled)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ritual_settings" jsonb;

-- Official X API OAuth2 tokens (posting only — reads stay on twitterapi.io)
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "x_user_id" text;
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "x_username" text;
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "x_access_token" text;
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "x_refresh_token" text;
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "x_token_expires_at" timestamp;
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "x_scope" text;
