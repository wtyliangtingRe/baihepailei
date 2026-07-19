-- Add the missing Works humanAssessment columns to the current and
-- version tables. This migration is additive only:
-- - no column or table is dropped
-- - no existing assessment data is overwritten
-- - existing Works rows receive the safe default status "pending"

BEGIN;

LOCK TABLE
  "public"."works",
  "public"."_works_v",
  "public"."works_human_assessment_source_links",
  "public"."_works_v_version_human_assessment_source_links"
IN SHARE ROW EXCLUSIVE MODE;

-- Keep this migration portable to another database that has not yet had
-- Payload's enum creation step.
DO $$
BEGIN
  CREATE TYPE "public"."enum_works_human_assessment_grade"
    AS ENUM ('S', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "public"."enum_works_human_assessment_status"
    AS ENUM ('pending', 'reviewed', 'disputed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "public"."enum_works_human_assessment_evidence_status"
    AS ENUM ('unassessed', 'source_checked', 'primary_checked', 'insufficient');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "public"."enum__works_v_version_human_assessment_grade"
    AS ENUM ('S', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "public"."enum__works_v_version_human_assessment_status"
    AS ENUM ('pending', 'reviewed', 'disputed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "public"."enum__works_v_version_human_assessment_evidence_status"
    AS ENUM ('unassessed', 'source_checked', 'primary_checked', 'insufficient');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "public"."works"
  ADD COLUMN IF NOT EXISTS "human_assessment_grade"
    "public"."enum_works_human_assessment_grade",
  ADD COLUMN IF NOT EXISTS "human_assessment_status"
    "public"."enum_works_human_assessment_status"
    DEFAULT 'pending'::"public"."enum_works_human_assessment_status",
  ADD COLUMN IF NOT EXISTS "human_assessment_note" varchar,
  ADD COLUMN IF NOT EXISTS "human_assessment_source_summary" varchar,
  ADD COLUMN IF NOT EXISTS "human_assessment_evidence_status"
    "public"."enum_works_human_assessment_evidence_status",
  ADD COLUMN IF NOT EXISTS "human_assessment_assessed_at"
    timestamp(3) with time zone,
  ADD COLUMN IF NOT EXISTS "human_assessment_assessed_by_id" integer;

ALTER TABLE "public"."_works_v"
  ADD COLUMN IF NOT EXISTS "version_human_assessment_grade"
    "public"."enum__works_v_version_human_assessment_grade",
  ADD COLUMN IF NOT EXISTS "version_human_assessment_status"
    "public"."enum__works_v_version_human_assessment_status"
    DEFAULT 'pending'::"public"."enum__works_v_version_human_assessment_status",
  ADD COLUMN IF NOT EXISTS "version_human_assessment_note" varchar,
  ADD COLUMN IF NOT EXISTS "version_human_assessment_source_summary" varchar,
  ADD COLUMN IF NOT EXISTS "version_human_assessment_evidence_status"
    "public"."enum__works_v_version_human_assessment_evidence_status",
  ADD COLUMN IF NOT EXISTS "version_human_assessment_assessed_at"
    timestamp(3) with time zone,
  ADD COLUMN IF NOT EXISTS "version_human_assessment_assessed_by_id" integer;

-- Ensure the defaults are correct even if a partially-created column
-- already existed before this migration.
ALTER TABLE "public"."works"
  ALTER COLUMN "human_assessment_status"
  SET DEFAULT 'pending'::"public"."enum_works_human_assessment_status";

ALTER TABLE "public"."_works_v"
  ALTER COLUMN "version_human_assessment_status"
  SET DEFAULT 'pending'::"public"."enum__works_v_version_human_assessment_status";

-- Abort instead of silently creating invalid foreign keys if either
-- pre-existing source-link table contains orphan rows.
DO $$
DECLARE
  orphan_count bigint;
BEGIN
  SELECT COUNT(*)
  INTO orphan_count
  FROM "public"."works_human_assessment_source_links" AS source_link
  LEFT JOIN "public"."works" AS work
    ON work."id" = source_link."_parent_id"
  WHERE work."id" IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'works_human_assessment_source_links contains % orphan rows',
      orphan_count;
  END IF;

  SELECT COUNT(*)
  INTO orphan_count
  FROM "public"."_works_v_version_human_assessment_source_links" AS source_link
  LEFT JOIN "public"."_works_v" AS work_version
    ON work_version."id" = source_link."_parent_id"
  WHERE work_version."id" IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      '_works_v_version_human_assessment_source_links contains % orphan rows',
      orphan_count;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS
  "works_human_assessment_human_assessment_assessed_by_idx"
ON "public"."works" ("human_assessment_assessed_by_id");

CREATE INDEX IF NOT EXISTS
  "_works_v_version_human_assessment_version_human_assessme_idx"
ON "public"."_works_v" ("version_human_assessment_assessed_by_id");

CREATE INDEX IF NOT EXISTS
  "works_human_assessment_source_links_order_idx"
ON "public"."works_human_assessment_source_links" ("_order");

CREATE INDEX IF NOT EXISTS
  "works_human_assessment_source_links_parent_id_idx"
ON "public"."works_human_assessment_source_links" ("_parent_id");

CREATE INDEX IF NOT EXISTS
  "_works_v_version_human_assessment_source_links_order_idx"
ON "public"."_works_v_version_human_assessment_source_links" ("_order");

CREATE INDEX IF NOT EXISTS
  "_works_v_version_human_assessment_source_links_parent_id_idx"
ON "public"."_works_v_version_human_assessment_source_links" ("_parent_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'works_human_assessment_assessed_by_fk'
      AND conrelid = 'public.works'::regclass
  ) THEN
    ALTER TABLE "public"."works"
      ADD CONSTRAINT "works_human_assessment_assessed_by_fk"
      FOREIGN KEY ("human_assessment_assessed_by_id")
      REFERENCES "public"."users" ("id")
      ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = '_works_v_human_assessment_assessed_by_fk'
      AND conrelid = 'public._works_v'::regclass
  ) THEN
    ALTER TABLE "public"."_works_v"
      ADD CONSTRAINT "_works_v_human_assessment_assessed_by_fk"
      FOREIGN KEY ("version_human_assessment_assessed_by_id")
      REFERENCES "public"."users" ("id")
      ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'works_human_assessment_source_links_parent_id_fk'
      AND conrelid =
        'public.works_human_assessment_source_links'::regclass
  ) THEN
    ALTER TABLE "public"."works_human_assessment_source_links"
      ADD CONSTRAINT
        "works_human_assessment_source_links_parent_id_fk"
      FOREIGN KEY ("_parent_id")
      REFERENCES "public"."works" ("id")
      ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      '_works_v_version_human_assessment_source_links_parent_id_fk'
      AND conrelid =
        'public._works_v_version_human_assessment_source_links'::regclass
  ) THEN
    ALTER TABLE
      "public"."_works_v_version_human_assessment_source_links"
      ADD CONSTRAINT
        "_works_v_version_human_assessment_source_links_parent_id_fk"
      FOREIGN KEY ("_parent_id")
      REFERENCES "public"."_works_v" ("id")
      ON DELETE CASCADE;
  END IF;
END
$$;

COMMENT ON COLUMN "public"."works"."human_assessment_status"
  IS 'Human-verified assessment workflow status. Defaults to pending.';

COMMENT ON COLUMN
  "public"."_works_v"."version_human_assessment_status"
  IS 'Versioned human-verified assessment workflow status.';

COMMIT;