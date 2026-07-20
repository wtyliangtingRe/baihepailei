-- New lifecycle model:
-- - registered-user proposals remain feedback submissions until accepted;
-- - accepted proposals and first-party manual intake become published temporary works;
-- - AI/imported works remain published and explicitly pending human review;
-- - archived/merged rows remain hidden.
--
-- This migration is additive/idempotent and does not delete content.

BEGIN;

LOCK TABLE "public"."works"
  IN SHARE ROW EXCLUSIVE MODE;

-- Payload normally stores select values in varchar columns. If this database
-- uses a PostgreSQL enum for catalog_status, extend it safely before updates.
DO $$
DECLARE
  catalog_type text;
  catalog_is_enum boolean;
BEGIN
  SELECT c.udt_name, (t.typtype = 'e')
    INTO catalog_type, catalog_is_enum
  FROM information_schema.columns c
  JOIN pg_type t ON t.typname = c.udt_name
  WHERE c.table_schema = 'public'
    AND c.table_name = 'works'
    AND c.column_name = 'catalog_status';

  IF catalog_is_enum THEN
    EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', catalog_type, 'temporary');
  END IF;
END $$;

-- Existing first-party/manual and accepted-feedback drafts become temporary.
UPDATE "public"."works"
SET "catalog_status" = 'temporary'
WHERE COALESCE("catalog_status", 'active') <> 'archived'
  AND (
    COALESCE("site_id", '') LIKE 'manual:%'
    OR COALESCE("site_id", '') LIKE 'feedback:%'
    OR COALESCE("import_batch", '') LIKE 'feedback-intake:%'
  );

-- Every non-archived work is a live published record. Visibility is no longer
-- coupled to a hidden draft switch.
UPDATE "public"."works"
SET "_status" = 'published',
    "is_lite_visible" = true,
    "is_full_visible" = true,
    "catalog_status" = CASE
      WHEN "catalog_status" = 'temporary' THEN 'temporary'
      ELSE 'active'
    END
WHERE COALESCE("catalog_status", 'active') <> 'archived';

-- Controlled AI results without a recorded human assessment stay public but
-- are explicitly marked as waiting for human review. Column existence checks
-- keep this migration compatible with older local schemas.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'works'
      AND column_name = 'radar_assessment_assessed_at'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'works'
      AND column_name = 'human_assessment_status'
  ) THEN
    UPDATE "public"."works"
    SET "review_status" = CASE
          WHEN "review_status" = 'disputed' THEN 'disputed'
          ELSE 'pending'
        END,
        "rating_notice" = 'ai_synthesized_pending_review'
    WHERE "radar_assessment_assessed_at" IS NOT NULL
      AND COALESCE("human_assessment_status", 'pending') <> 'reviewed'
      AND COALESCE("catalog_status", 'active') <> 'archived';
  END IF;
END $$;

COMMIT;

-- Read-only verification after applying:
-- SELECT catalog_status, _status, review_status, rating_notice, count(*)
-- FROM works
-- GROUP BY catalog_status, _status, review_status, rating_notice
-- ORDER BY catalog_status, _status, review_status, rating_notice;
