-- Per-brand toggle for surfacing mainstream tech/AI news in the pulse
ALTER TABLE "brands"
  ADD COLUMN "mainstream_news_enabled" boolean NOT NULL DEFAULT false;

-- Raw news items ingested from RSS feeds. Dumb storage layer; the smart scoring
-- happens at query time per brand.
CREATE TABLE "mainstream_news_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source" text NOT NULL,
  "title" text NOT NULL,
  "summary" text,
  "url" text NOT NULL UNIQUE,
  "image_url" text,
  "named_entities" jsonb DEFAULT '[]'::jsonb,
  "published_at" timestamp with time zone,
  "fetched_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "mainstream_news_published_idx" ON "mainstream_news_items" ("published_at" DESC);
CREATE INDEX "mainstream_news_fetched_idx" ON "mainstream_news_items" ("fetched_at" DESC);

-- Per-brand cached scores. The Flash judge runs once per (brand, news_item) and
-- the result is cached for ~3 hours so we don't re-score the same item repeatedly.
CREATE TABLE "brand_news_scores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
  "news_item_id" uuid NOT NULL REFERENCES "mainstream_news_items"("id") ON DELETE CASCADE,
  "relevance_score" integer NOT NULL,
  "virality_score" integer NOT NULL,
  "combined_score" real NOT NULL,
  "suggested_angle" text,
  "skip_reason" text,
  "scored_at" timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE("brand_id", "news_item_id")
);

CREATE INDEX "brand_news_brand_score_idx" ON "brand_news_scores" ("brand_id", "combined_score" DESC);
