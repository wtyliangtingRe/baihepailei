import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_radar_public_records_evidence_role" ADD VALUE 'licensed_or_authorized' BEFORE 'supplemental';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "radar_public_records_evidence" ALTER COLUMN "role" SET DATA TYPE text;
  DROP TYPE "public"."enum_radar_public_records_evidence_role";
  CREATE TYPE "public"."enum_radar_public_records_evidence_role" AS ENUM('primary', 'supplemental', 'lead_only');
  ALTER TABLE "radar_public_records_evidence" ALTER COLUMN "role" SET DATA TYPE "public"."enum_radar_public_records_evidence_role" USING "role"::"public"."enum_radar_public_records_evidence_role";`)
}
