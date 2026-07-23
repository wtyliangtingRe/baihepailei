import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_radar_public_review_reasons" AS ENUM('radar_v06_package_import', 'radar_publication_guard', 'radar_guard_low_evidence_coverage', 'radar_guard_weak_or_conflicting_source', 'radar_guard_unclear_provisional_grade');
  CREATE TYPE "public"."enum_radar_public_radar_assessment_matched_rules_grade" AS ENUM('S', 'A', 'B', 'C', 'D', 'E', 'F', 'X');
  CREATE TYPE "public"."enum_radar_public_record_status" AS ENUM('current', 'withdrawn');
  CREATE TYPE "public"."enum_radar_public_conclusion_mode" AS ENUM('fixed_grade', 'bounded_range');
  CREATE TYPE "public"."enum_radar_public_compatibility_grade" AS ENUM('S', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'unknown');
  CREATE TYPE "public"."enum_radar_public_best_grade" AS ENUM('S', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'unknown');
  CREATE TYPE "public"."enum_radar_public_likely_grade" AS ENUM('S', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'unknown');
  CREATE TYPE "public"."enum_radar_public_worst_grade" AS ENUM('S', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'unknown');
  CREATE TYPE "public"."enum_radar_public_rating_notice" AS ENUM('ai_synthesized_pending_review', 'insufficient_information', 'none');
  CREATE TYPE "public"."enum_radar_public_evidence_strength" AS ENUM('unassessed', 'weak', 'medium', 'strong');
  CREATE TYPE "public"."enum_radar_public_radar_assessment_evidence_status" AS ENUM('official_confirmed', 'primary_material_confirmed', 'multiple_secondary_supported', 'single_secondary_supported', 'community_consensus', 'inferred_from_metadata', 'conflicting_evidence', 'insufficient_evidence', 'unknown');
  CREATE TYPE "public"."enum_radar_public_radar_assessment_suggested_grade" AS ENUM('S', 'A', 'B', 'C', 'D', 'E', 'F', 'X');
  CREATE TYPE "public"."enum_radar_public_source_kind" AS ENUM('package', 'latest_ai_draft', 'manual_ai_update');
  CREATE TABLE "radar_public_review_reasons" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_radar_public_review_reasons",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "radar_public_radar_assessment_matched_rules" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"grade" "enum_radar_public_radar_assessment_matched_rules_grade" NOT NULL,
  	"confidence_percent" numeric,
  	"reason" varchar
  );
  
  CREATE TABLE "radar_public_radar_assessment_contradictions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"value" varchar NOT NULL
  );
  
  CREATE TABLE "radar_public" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"publication_key" varchar NOT NULL,
  	"work_id" integer NOT NULL,
  	"work_id_snapshot" varchar NOT NULL,
  	"work_site_id" varchar,
  	"title" varchar NOT NULL,
  	"record_status" "enum_radar_public_record_status" DEFAULT 'current' NOT NULL,
  	"conclusion_mode" "enum_radar_public_conclusion_mode" NOT NULL,
  	"compatibility_grade" "enum_radar_public_compatibility_grade" NOT NULL,
  	"best_grade" "enum_radar_public_best_grade",
  	"likely_grade" "enum_radar_public_likely_grade",
  	"worst_grade" "enum_radar_public_worst_grade",
  	"rating_notice" "enum_radar_public_rating_notice" DEFAULT 'ai_synthesized_pending_review' NOT NULL,
  	"evidence_strength" "enum_radar_public_evidence_strength" DEFAULT 'unassessed' NOT NULL,
  	"radar_assessment_confidence_percent" numeric,
  	"radar_assessment_evidence_coverage_percent" numeric,
  	"radar_assessment_evidence_status" "enum_radar_public_radar_assessment_evidence_status",
  	"radar_assessment_source_summary" varchar,
  	"radar_assessment_source_count" numeric,
  	"radar_assessment_policy_version" varchar,
  	"radar_assessment_assessment_batch" varchar,
  	"radar_assessment_suggested_grade" "enum_radar_public_radar_assessment_suggested_grade",
  	"radar_assessment_decisive_rule_code" varchar,
  	"radar_assessment_decisive_rule_reason" varchar,
  	"radar_assessment_requires_human_review" boolean DEFAULT true,
  	"radar_assessment_assessed_at" timestamp(3) with time zone,
  	"source_kind" "enum_radar_public_source_kind" NOT NULL,
  	"source_package_id" varchar,
  	"source_package_sha256" varchar,
  	"conclusion_sha256" varchar NOT NULL,
  	"publication_version" varchar NOT NULL,
  	"published_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "radar_public_review_reasons" ADD CONSTRAINT "radar_public_review_reasons_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."radar_public"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "radar_public_radar_assessment_matched_rules" ADD CONSTRAINT "radar_public_radar_assessment_matched_rules_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."radar_public"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "radar_public_radar_assessment_contradictions" ADD CONSTRAINT "radar_public_radar_assessment_contradictions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."radar_public"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "radar_public" ADD CONSTRAINT "radar_public_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "radar_public_review_reasons_order_idx" ON "radar_public_review_reasons" USING btree ("order");
  CREATE INDEX "radar_public_review_reasons_parent_idx" ON "radar_public_review_reasons" USING btree ("parent_id");
  CREATE INDEX "radar_public_radar_assessment_matched_rules_order_idx" ON "radar_public_radar_assessment_matched_rules" USING btree ("_order");
  CREATE INDEX "radar_public_radar_assessment_matched_rules_parent_id_idx" ON "radar_public_radar_assessment_matched_rules" USING btree ("_parent_id");
  CREATE INDEX "radar_public_radar_assessment_contradictions_order_idx" ON "radar_public_radar_assessment_contradictions" USING btree ("_order");
  CREATE INDEX "radar_public_radar_assessment_contradictions_parent_id_idx" ON "radar_public_radar_assessment_contradictions" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "radar_public_publication_key_idx" ON "radar_public" USING btree ("publication_key");
  CREATE INDEX "radar_public_work_idx" ON "radar_public" USING btree ("work_id");
  CREATE INDEX "radar_public_work_id_snapshot_idx" ON "radar_public" USING btree ("work_id_snapshot");
  CREATE INDEX "radar_public_work_site_id_idx" ON "radar_public" USING btree ("work_site_id");
  CREATE INDEX "radar_public_record_status_idx" ON "radar_public" USING btree ("record_status");
  CREATE INDEX "radar_public_compatibility_grade_idx" ON "radar_public" USING btree ("compatibility_grade");
  CREATE INDEX "radar_public_source_package_id_idx" ON "radar_public" USING btree ("source_package_id");
  CREATE INDEX "radar_public_conclusion_sha256_idx" ON "radar_public" USING btree ("conclusion_sha256");
  CREATE INDEX "radar_public_published_at_idx" ON "radar_public" USING btree ("published_at");
  CREATE INDEX "radar_public_updated_at_idx" ON "radar_public" USING btree ("updated_at");
  CREATE INDEX "radar_public_created_at_idx" ON "radar_public" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "radar_public_review_reasons" CASCADE;
  DROP TABLE "radar_public_radar_assessment_matched_rules" CASCADE;
  DROP TABLE "radar_public_radar_assessment_contradictions" CASCADE;
  DROP TABLE "radar_public" CASCADE;
  DROP TYPE "public"."enum_radar_public_review_reasons";
  DROP TYPE "public"."enum_radar_public_radar_assessment_matched_rules_grade";
  DROP TYPE "public"."enum_radar_public_record_status";
  DROP TYPE "public"."enum_radar_public_conclusion_mode";
  DROP TYPE "public"."enum_radar_public_compatibility_grade";
  DROP TYPE "public"."enum_radar_public_best_grade";
  DROP TYPE "public"."enum_radar_public_likely_grade";
  DROP TYPE "public"."enum_radar_public_worst_grade";
  DROP TYPE "public"."enum_radar_public_rating_notice";
  DROP TYPE "public"."enum_radar_public_evidence_strength";
  DROP TYPE "public"."enum_radar_public_radar_assessment_evidence_status";
  DROP TYPE "public"."enum_radar_public_radar_assessment_suggested_grade";
  DROP TYPE "public"."enum_radar_public_source_kind";`)
}
