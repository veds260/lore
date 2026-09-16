ALTER TABLE "users"
  ADD COLUMN "telegram_chat_id" text,
  ADD COLUMN "telegram_link_token" text,
  ADD COLUMN "telegram_linked_at" timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_chat_id_idx" ON "users" ("telegram_chat_id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_link_token_idx" ON "users" ("telegram_link_token");
