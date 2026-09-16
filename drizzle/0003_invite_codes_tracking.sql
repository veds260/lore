ALTER TABLE "invite_codes"
  ADD COLUMN "redeemed_by" text,
  ADD COLUMN "redeemed_at" timestamp with time zone;

ALTER TABLE "invite_codes" DROP COLUMN IF EXISTS "max_uses";
ALTER TABLE "invite_codes" DROP COLUMN IF EXISTS "uses";
