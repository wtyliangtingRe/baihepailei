-- Split the forbidden root Works.status field into:
--   works._status: Payload draft / publication state
--   works.catalog_status: Baihepailei catalog lifecycle
--
-- Safety:
-- - Does not drop the legacy works.status or _works_v.version_status columns.
-- - Does not touch legacy_x_wiki_page columns.
-- - Idempotent for the new types/columns and data backfill.

BEGIN;

LOCK TABLE "public"."works", "public"."_works_v" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  CREATE TYPE "public"."enum_works_catalog_status" AS ENUM ('active', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "public"."enum__works_v_version_catalog_status" AS ENUM ('active', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "public"."works"
  ADD COLUMN IF NOT EXISTS "catalog_status" "public"."enum_works_catalog_status";

ALTER TABLE "public"."_works_v"
  ADD COLUMN IF NOT EXISTS "version_catalog_status" "public"."enum__works_v_version_catalog_status";

UPDATE "public"."works"
SET "catalog_status" = (
  CASE
    WHEN "status"::text = 'archived' THEN 'archived'
    ELSE 'active'
  END
)::"public"."enum_works_catalog_status"
WHERE "catalog_status" IS NULL;

UPDATE "public"."_works_v"
SET "version_catalog_status" = (
  CASE
    WHEN "version_status"::text = 'archived' THEN 'archived'
    ELSE 'active'
  END
)::"public"."enum__works_v_version_catalog_status"
WHERE "version_catalog_status" IS NULL;

-- The former custom status field was also being used as publication state.
-- Copy that intent into Payload's real _status field. Archived works become
-- drafts as a second public-exposure safety barrier.
UPDATE "public"."works"
SET "_status" = CASE
  WHEN "status"::text = 'published' THEN 'published'
  ELSE 'draft'
END
WHERE "status"::text IN ('draft', 'published', 'archived');

ALTER TABLE "public"."works"
  ALTER COLUMN "catalog_status" SET DEFAULT 'active'::"public"."enum_works_catalog_status",
  ALTER COLUMN "catalog_status" SET NOT NULL;

ALTER TABLE "public"."_works_v"
  ALTER COLUMN "version_catalog_status" SET DEFAULT 'active'::"public"."enum__works_v_version_catalog_status",
  ALTER COLUMN "version_catalog_status" SET NOT NULL;

COMMENT ON COLUMN "public"."works"."catalog_status"
  IS 'Baihepailei catalog lifecycle: active or archived. Payload publication uses _status.';

COMMENT ON COLUMN "public"."_works_v"."version_catalog_status"
  IS 'Versioned copy of works.catalog_status.';

COMMIT;
