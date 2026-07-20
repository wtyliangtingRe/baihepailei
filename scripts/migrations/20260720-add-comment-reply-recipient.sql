-- Record which account a reply targets so account messages can notify the
-- author of any replied-to comment, not only the root comment author.
-- Additive only: existing comments remain valid with NULL reply_to_user_id.

BEGIN;

LOCK TABLE "public"."comments"
  IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "public"."comments"
  ADD COLUMN IF NOT EXISTS "reply_to_user_id" integer;

CREATE INDEX IF NOT EXISTS "comments_reply_to_user_idx"
  ON "public"."comments" USING btree ("reply_to_user_id");

COMMIT;

-- Read-only verification after applying:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'comments'
--   AND column_name = 'reply_to_user_id';
