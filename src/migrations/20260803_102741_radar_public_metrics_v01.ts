import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_radar_public_ratings_relationship_evidence_state" AS ENUM('covered', 'partial', 'uncovered');
  ALTER TABLE "radar_public_ratings" ADD COLUMN "confidence_percent" numeric;
  ALTER TABLE "radar_public_ratings" ADD COLUMN "evidence_coverage_percent" numeric;
  ALTER TABLE "radar_public_ratings" ADD COLUMN "metrics_policy_version" varchar;
  ALTER TABLE "radar_public_ratings" ADD COLUMN "source_metrics_policy_version" varchar;
  ALTER TABLE "radar_public_ratings" ADD COLUMN "relationship_evidence_state" "enum_radar_public_ratings_relationship_evidence_state";
  ALTER TABLE "radar_public_ratings" ADD COLUMN "metrics_source_release_id" varchar;
  ALTER TABLE "radar_public_ratings" ADD COLUMN "metrics_calculation_basis_sha256" varchar;
  ALTER TABLE "radar_public_ratings" ADD COLUMN "requires_metric_review" boolean DEFAULT false;
  CREATE INDEX "radar_public_ratings_metrics_policy_version_idx" ON "radar_public_ratings" USING btree ("metrics_policy_version");
  CREATE INDEX "radar_public_ratings_source_metrics_policy_version_idx" ON "radar_public_ratings" USING btree ("source_metrics_policy_version");
  CREATE INDEX "radar_public_ratings_metrics_source_release_id_idx" ON "radar_public_ratings" USING btree ("metrics_source_release_id");
  CREATE INDEX "radar_public_ratings_metrics_calculation_basis_sha256_idx" ON "radar_public_ratings" USING btree ("metrics_calculation_basis_sha256");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "radar_public_ratings_metrics_policy_version_idx";
  DROP INDEX "radar_public_ratings_source_metrics_policy_version_idx";
  DROP INDEX "radar_public_ratings_metrics_source_release_id_idx";
  DROP INDEX "radar_public_ratings_metrics_calculation_basis_sha256_idx";
  ALTER TABLE "radar_public_ratings" DROP COLUMN "confidence_percent";
  ALTER TABLE "radar_public_ratings" DROP COLUMN "evidence_coverage_percent";
  ALTER TABLE "radar_public_ratings" DROP COLUMN "metrics_policy_version";
  ALTER TABLE "radar_public_ratings" DROP COLUMN "source_metrics_policy_version";
  ALTER TABLE "radar_public_ratings" DROP COLUMN "relationship_evidence_state";
  ALTER TABLE "radar_public_ratings" DROP COLUMN "metrics_source_release_id";
  ALTER TABLE "radar_public_ratings" DROP COLUMN "metrics_calculation_basis_sha256";
  ALTER TABLE "radar_public_ratings" DROP COLUMN "requires_metric_review";
  DROP TYPE "public"."enum_radar_public_ratings_relationship_evidence_state";`)
}
