-- Add one structured JSONB column for member-submitted new-work catalog data.
-- This migration is additive only:
-- - no existing feedback row is changed
-- - no table or column is removed
-- - existing new-work submissions remain valid with NULL metadata

BEGIN;

LOCK TABLE "public"."feedback_submissions"
  IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "public"."feedback_submissions"
  ADD COLUMN IF NOT EXISTS "new_work_metadata" jsonb;

COMMIT;

-- Read-only verification after applying:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'feedback_submissions'
--   AND column_name = 'new_work_metadata';
