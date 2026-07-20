-- Align the existing comments table with the moderation fields already present
-- in src/collections/Comments.ts. Additive only: no comment content is changed.

BEGIN;

LOCK TABLE "public"."comments"
  IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "public"."comments"
  ADD COLUMN IF NOT EXISTS "report_count" integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "hidden_reason" text;

UPDATE "public"."comments"
SET "report_count" = 0
WHERE "report_count" IS NULL;

ALTER TABLE "public"."comments"
  ALTER COLUMN "report_count" SET DEFAULT 0;

COMMIT;

-- Read-only verification after applying:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'comments'
--   AND column_name IN ('report_count', 'hidden_reason')
-- ORDER BY column_name;
