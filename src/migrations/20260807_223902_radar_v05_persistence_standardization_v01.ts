import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_radar_public_ratings_conclusion_mode" AS ENUM('fixed_grade', 'bounded_range', 'labels_only', 'blocked');
  ALTER TYPE "public"."enum_radar_public_conclusion_mode" ADD VALUE 'labels_only';
  ALTER TYPE "public"."enum_radar_public_conclusion_mode" ADD VALUE 'blocked';
  ALTER TABLE "radar_public" ALTER COLUMN "compatibility_grade" DROP NOT NULL;
  ALTER TABLE "radar_public_ratings" ALTER COLUMN "core_grade" DROP NOT NULL;
  ALTER TABLE "radar_public_ratings" ALTER COLUMN "best_grade" DROP NOT NULL;
  ALTER TABLE "radar_public_ratings" ALTER COLUMN "likely_grade" DROP NOT NULL;
  ALTER TABLE "radar_public_ratings" ALTER COLUMN "worst_grade" DROP NOT NULL;
  ALTER TABLE "radar_public_ratings" ADD COLUMN "conclusion_mode" "enum_radar_public_ratings_conclusion_mode";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "radar_public" ALTER COLUMN "conclusion_mode" SET DATA TYPE text;
  DROP TYPE "public"."enum_radar_public_conclusion_mode";
  CREATE TYPE "public"."enum_radar_public_conclusion_mode" AS ENUM('fixed_grade', 'bounded_range');
  ALTER TABLE "radar_public" ALTER COLUMN "conclusion_mode" SET DATA TYPE "public"."enum_radar_public_conclusion_mode" USING "conclusion_mode"::"public"."enum_radar_public_conclusion_mode";
  ALTER TABLE "radar_public" ALTER COLUMN "compatibility_grade" SET NOT NULL;
  ALTER TABLE "radar_public_ratings" ALTER COLUMN "core_grade" SET NOT NULL;
  ALTER TABLE "radar_public_ratings" ALTER COLUMN "best_grade" SET NOT NULL;
  ALTER TABLE "radar_public_ratings" ALTER COLUMN "likely_grade" SET NOT NULL;
  ALTER TABLE "radar_public_ratings" ALTER COLUMN "worst_grade" SET NOT NULL;
  ALTER TABLE "radar_public_ratings" DROP COLUMN "conclusion_mode";
  DROP TYPE "public"."enum_radar_public_ratings_conclusion_mode";`)
}
