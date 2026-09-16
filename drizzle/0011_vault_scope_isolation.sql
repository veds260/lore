-- Make vault scope explicit: global rules can flow down, tenant notes never flow sideways.

CREATE TYPE "vault_scope" AS ENUM ('global', 'tenant');

ALTER TABLE "vault_notes"
  ADD COLUMN "scope" "vault_scope" NOT NULL DEFAULT 'tenant';

UPDATE "vault_notes"
SET "scope" = CASE WHEN "brand_id" IS NULL THEN 'global'::"vault_scope" ELSE 'tenant'::"vault_scope" END;

CREATE INDEX "vault_notes_scope_status_idx" ON "vault_notes" ("scope", "status");

-- Stronger uniqueness for the two supported scopes. Global notes are shared system knowledge.
-- Tenant notes are private per brand and may use the same canonical paths in every tenant workspace.
DROP INDEX IF EXISTS "vault_notes_brand_path_idx";
CREATE UNIQUE INDEX "vault_notes_global_path_idx"
  ON "vault_notes" ("path")
  WHERE "scope" = 'global' AND "brand_id" IS NULL;
CREATE UNIQUE INDEX "vault_notes_tenant_brand_path_idx"
  ON "vault_notes" ("brand_id", "path")
  WHERE "scope" = 'tenant' AND "brand_id" IS NOT NULL;
