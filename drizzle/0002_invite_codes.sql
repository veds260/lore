CREATE TABLE "invite_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL UNIQUE,
  "plan_tier" "plan_tier" NOT NULL DEFAULT 'pro',
  "max_uses" integer,
  "uses" integer NOT NULL DEFAULT 0,
  "note" text,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
