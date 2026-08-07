import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_radar_public_conclusion_mode" ADD VALUE IF NOT EXISTS 'labels_only';
  ALTER TYPE "public"."enum_radar_public_conclusion_mode" ADD VALUE IF NOT EXISTS 'blocked';

  ALTER TABLE "radar_public" ALTER COLUMN "compatibility_grade" DROP NOT NULL;

  CREATE TYPE "public"."enum_radar_public_ratings_conclusion_mode" AS ENUM('fixed_grade', 'bounded_range', 'labels_only', 'blocked');
  ALTER TABLE "radar_public_ratings" ADD COLUMN "conclusion_mode" "enum_radar_public_ratings_conclusion_mode";
  ALTER TABLE "radar_public_ratings" ALTER COLUMN "core_grade" DROP NOT NULL;
  ALTER TABLE "radar_public_ratings" ALTER COLUMN "best_grade" DROP NOT NULL;
  ALTER TABLE "radar_public_ratings" ALTER COLUMN "likely_grade" DROP NOT NULL;
  ALTER TABLE "radar_public_ratings" ALTER COLUMN "worst_grade" DROP NOT NULL;
  `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM "radar_public"
      WHERE "conclusion_mode"::text IN ('labels_only', 'blocked')
         OR "compatibility_grade" IS NULL
    ) THEN
      RAISE EXCEPTION 'Cannot safely roll back Radar v0.5 persistence: radar_public contains grade-less or v0.5-only conclusions.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "radar_public_ratings"
      WHERE "conclusion_mode"::text IN ('labels_only', 'blocked')
         OR "core_grade" IS NULL
         OR "best_grade" IS NULL
         OR "likely_grade" IS NULL
         OR "worst_grade" IS NULL
    ) THEN
      RAISE EXCEPTION 'Cannot safely roll back Radar v0.5 persistence: radar_public_ratings contains grade-less or v0.5-only conclusions.';
    END IF;
  END $$;

  ALTER TABLE "radar_public_ratings" ALTER COLUMN "core_grade" SET NOT NULL;
  ALTER TABLE "radar_public_ratings" ALTER COLUMN "best_grade" SET NOT NULL;
  ALTER TABLE "radar_public_ratings" ALTER COLUMN "likely_grade" SET NOT NULL;
  ALTER TABLE "radar_public_ratings" ALTER COLUMN "worst_grade" SET NOT NULL;
  ALTER TABLE "radar_public_ratings" DROP COLUMN "conclusion_mode";
  DROP TYPE "public"."enum_radar_public_ratings_conclusion_mode";

  ALTER TABLE "radar_public" ALTER COLUMN "compatibility_grade" SET NOT NULL;
  ALTER TABLE "radar_public" ALTER COLUMN "conclusion_mode" TYPE varchar USING "conclusion_mode"::text;
  DROP TYPE "public"."enum_radar_public_conclusion_mode";
  CREATE TYPE "public"."enum_radar_public_conclusion_mode" AS ENUM('fixed_grade', 'bounded_range');
  ALTER TABLE "radar_public" ALTER COLUMN "conclusion_mode" TYPE "enum_radar_public_conclusion_mode" USING "conclusion_mode"::"enum_radar_public_conclusion_mode";
  `)
}
