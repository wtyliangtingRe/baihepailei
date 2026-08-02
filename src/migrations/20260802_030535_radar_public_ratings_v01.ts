import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TYPE "public"."enum_radar_public_ratings_core_grade" AS ENUM('S', 'A', 'B', 'C', 'D', 'E', 'F', 'X');
  CREATE TYPE "public"."enum_radar_public_ratings_best_grade" AS ENUM('S', 'A', 'B', 'C', 'D', 'E', 'F', 'X');
  CREATE TYPE "public"."enum_radar_public_ratings_likely_grade" AS ENUM('S', 'A', 'B', 'C', 'D', 'E', 'F', 'X');
  CREATE TYPE "public"."enum_radar_public_ratings_worst_grade" AS ENUM('S', 'A', 'B', 'C', 'D', 'E', 'F', 'X');
  CREATE TYPE "public"."enum_radar_public_ratings_confidence" AS ENUM('high', 'medium', 'low');
  CREATE TYPE "public"."enum_radar_public_ratings_human_review_status" AS ENUM('unreviewed', 'reviewed', 'disputed');
  CREATE TYPE "public"."enum_radar_public_ratings_human_review_proposed_core_grade" AS ENUM('S', 'A', 'B', 'C', 'D', 'E', 'F', 'X');
  CREATE TYPE "public"."enum_radar_public_ratings_record_status" AS ENUM('current', 'withdrawn');

  CREATE TABLE "radar_public_ratings_matched_classes" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "value" varchar NOT NULL
  );

  CREATE TABLE "radar_public_ratings_fact_refs" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "value" varchar NOT NULL
  );

  CREATE TABLE "radar_public_ratings_evidence_refs" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "value" varchar NOT NULL
  );

  CREATE TABLE "radar_public_ratings_unresolved_dimensions" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "value" varchar NOT NULL
  );

  CREATE TABLE "radar_public_ratings_confirmation_basis" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "value" varchar NOT NULL
  );

  CREATE TABLE "radar_public_ratings_public_tag_hints" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "key" varchar NOT NULL,
    "group" varchar NOT NULL,
    "value" varchar NOT NULL,
    "warning_template_id" varchar
  );

  CREATE TABLE "radar_public_ratings_public_warning_template_ids" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "value" varchar NOT NULL
  );

  CREATE TABLE "radar_public_ratings_human_review_proposed_profile_changes" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "value" varchar NOT NULL
  );

  CREATE TABLE "radar_public_ratings_human_review_additional_evidence_refs" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "value" varchar NOT NULL
  );

  CREATE TABLE "radar_public_ratings" (
    "id" serial PRIMARY KEY NOT NULL,
    "publication_key" varchar NOT NULL,
    "work_id" integer NOT NULL,
    "identity_key" varchar NOT NULL,
    "work_id_snapshot" varchar NOT NULL,
    "work_site_id" varchar NOT NULL,
    "title" varchar NOT NULL,
    "core_grade" "enum_radar_public_ratings_core_grade" NOT NULL,
    "best_grade" "enum_radar_public_ratings_best_grade" NOT NULL,
    "likely_grade" "enum_radar_public_ratings_likely_grade" NOT NULL,
    "worst_grade" "enum_radar_public_ratings_worst_grade" NOT NULL,
    "confidence" "enum_radar_public_ratings_confidence" NOT NULL,
    "reasoning_summary" varchar NOT NULL,
    "classification_rule" varchar NOT NULL,
    "benefit_of_doubt_baseline_applied" boolean DEFAULT false NOT NULL,
    "human_review_status" "enum_radar_public_ratings_human_review_status" DEFAULT 'unreviewed' NOT NULL,
    "human_review_reviewer_identity" varchar,
    "human_review_reviewed_at" timestamp(3) with time zone,
    "human_review_decision" varchar,
    "human_review_proposed_core_grade" "enum_radar_public_ratings_human_review_proposed_core_grade",
    "human_review_reasoning" varchar,
    "human_review_moderation_state" varchar,
    "human_review_blocks_analysis" boolean DEFAULT false NOT NULL,
    "human_review_blocks_publication" boolean DEFAULT false NOT NULL,
    "source_release_id" varchar NOT NULL,
    "source_commit_sha" varchar NOT NULL,
    "source_policy_version" varchar NOT NULL,
    "research_snapshot_id" varchar NOT NULL,
    "source_rating_campaign_id" varchar NOT NULL,
    "source_rating_decision_hash" varchar NOT NULL,
    "release_rating_hash" varchar NOT NULL,
    "release_ratings_sha256" varchar NOT NULL,
    "imported_at" timestamp(3) with time zone NOT NULL,
    "record_status" "enum_radar_public_ratings_record_status" DEFAULT 'current' NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "radar_public_ratings_matched_classes" ADD CONSTRAINT "radar_public_ratings_matched_classes_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."radar_public_ratings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "radar_public_ratings_fact_refs" ADD CONSTRAINT "radar_public_ratings_fact_refs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."radar_public_ratings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "radar_public_ratings_evidence_refs" ADD CONSTRAINT "radar_public_ratings_evidence_refs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."radar_public_ratings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "radar_public_ratings_unresolved_dimensions" ADD CONSTRAINT "radar_public_ratings_unresolved_dimensions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."radar_public_ratings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "radar_public_ratings_confirmation_basis" ADD CONSTRAINT "radar_public_ratings_confirmation_basis_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."radar_public_ratings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "radar_public_ratings_public_tag_hints" ADD CONSTRAINT "radar_public_ratings_public_tag_hints_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."radar_public_ratings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "radar_public_ratings_public_warning_template_ids" ADD CONSTRAINT "radar_public_ratings_public_warning_template_ids_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."radar_public_ratings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "radar_public_ratings_human_review_proposed_profile_changes" ADD CONSTRAINT "radar_public_ratings_human_review_proposed_profile_changes_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."radar_public_ratings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "radar_public_ratings_human_review_additional_evidence_refs" ADD CONSTRAINT "radar_public_ratings_human_review_additional_evidence_refs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."radar_public_ratings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "radar_public_ratings" ADD CONSTRAINT "radar_public_ratings_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;

  CREATE INDEX "radar_public_ratings_matched_classes_order_idx" ON "radar_public_ratings_matched_classes" USING btree ("_order");
  CREATE INDEX "radar_public_ratings_matched_classes_parent_id_idx" ON "radar_public_ratings_matched_classes" USING btree ("_parent_id");
  CREATE INDEX "radar_public_ratings_fact_refs_order_idx" ON "radar_public_ratings_fact_refs" USING btree ("_order");
  CREATE INDEX "radar_public_ratings_fact_refs_parent_id_idx" ON "radar_public_ratings_fact_refs" USING btree ("_parent_id");
  CREATE INDEX "radar_public_ratings_evidence_refs_order_idx" ON "radar_public_ratings_evidence_refs" USING btree ("_order");
  CREATE INDEX "radar_public_ratings_evidence_refs_parent_id_idx" ON "radar_public_ratings_evidence_refs" USING btree ("_parent_id");
  CREATE INDEX "radar_public_ratings_unresolved_dimensions_order_idx" ON "radar_public_ratings_unresolved_dimensions" USING btree ("_order");
  CREATE INDEX "radar_public_ratings_unresolved_dimensions_parent_id_idx" ON "radar_public_ratings_unresolved_dimensions" USING btree ("_parent_id");
  CREATE INDEX "radar_public_ratings_confirmation_basis_order_idx" ON "radar_public_ratings_confirmation_basis" USING btree ("_order");
  CREATE INDEX "radar_public_ratings_confirmation_basis_parent_id_idx" ON "radar_public_ratings_confirmation_basis" USING btree ("_parent_id");
  CREATE INDEX "radar_public_ratings_public_tag_hints_order_idx" ON "radar_public_ratings_public_tag_hints" USING btree ("_order");
  CREATE INDEX "radar_public_ratings_public_tag_hints_parent_id_idx" ON "radar_public_ratings_public_tag_hints" USING btree ("_parent_id");
  CREATE INDEX "radar_public_ratings_public_warning_template_ids_order_idx" ON "radar_public_ratings_public_warning_template_ids" USING btree ("_order");
  CREATE INDEX "radar_public_ratings_public_warning_template_ids_parent_id_idx" ON "radar_public_ratings_public_warning_template_ids" USING btree ("_parent_id");
  CREATE INDEX "radar_public_ratings_human_review_proposed_profile_changes_order_idx" ON "radar_public_ratings_human_review_proposed_profile_changes" USING btree ("_order");
  CREATE INDEX "radar_public_ratings_human_review_proposed_profile_changes_parent_id_idx" ON "radar_public_ratings_human_review_proposed_profile_changes" USING btree ("_parent_id");
  CREATE INDEX "radar_public_ratings_human_review_additional_evidence_refs_order_idx" ON "radar_public_ratings_human_review_additional_evidence_refs" USING btree ("_order");
  CREATE INDEX "radar_public_ratings_human_review_additional_evidence_refs_parent_id_idx" ON "radar_public_ratings_human_review_additional_evidence_refs" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "radar_public_ratings_publication_key_idx" ON "radar_public_ratings" USING btree ("publication_key");
  CREATE INDEX "radar_public_ratings_work_idx" ON "radar_public_ratings" USING btree ("work_id");
  CREATE UNIQUE INDEX "radar_public_ratings_identity_key_idx" ON "radar_public_ratings" USING btree ("identity_key");
  CREATE INDEX "radar_public_ratings_work_id_snapshot_idx" ON "radar_public_ratings" USING btree ("work_id_snapshot");
  CREATE INDEX "radar_public_ratings_work_site_id_idx" ON "radar_public_ratings" USING btree ("work_site_id");
  CREATE INDEX "radar_public_ratings_core_grade_idx" ON "radar_public_ratings" USING btree ("core_grade");
  CREATE INDEX "radar_public_ratings_confidence_idx" ON "radar_public_ratings" USING btree ("confidence");
  CREATE INDEX "radar_public_ratings_classification_rule_idx" ON "radar_public_ratings" USING btree ("classification_rule");
  CREATE INDEX "radar_public_ratings_source_release_id_idx" ON "radar_public_ratings" USING btree ("source_release_id");
  CREATE INDEX "radar_public_ratings_source_rating_campaign_id_idx" ON "radar_public_ratings" USING btree ("source_rating_campaign_id");
  CREATE INDEX "radar_public_ratings_source_rating_decision_hash_idx" ON "radar_public_ratings" USING btree ("source_rating_decision_hash");
  CREATE INDEX "radar_public_ratings_release_rating_hash_idx" ON "radar_public_ratings" USING btree ("release_rating_hash");
  CREATE INDEX "radar_public_ratings_record_status_idx" ON "radar_public_ratings" USING btree ("record_status");
  CREATE INDEX "radar_public_ratings_updated_at_idx" ON "radar_public_ratings" USING btree ("updated_at");
  CREATE INDEX "radar_public_ratings_created_at_idx" ON "radar_public_ratings" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP TABLE "radar_public_ratings_matched_classes" CASCADE;
  DROP TABLE "radar_public_ratings_fact_refs" CASCADE;
  DROP TABLE "radar_public_ratings_evidence_refs" CASCADE;
  DROP TABLE "radar_public_ratings_unresolved_dimensions" CASCADE;
  DROP TABLE "radar_public_ratings_confirmation_basis" CASCADE;
  DROP TABLE "radar_public_ratings_public_tag_hints" CASCADE;
  DROP TABLE "radar_public_ratings_public_warning_template_ids" CASCADE;
  DROP TABLE "radar_public_ratings_human_review_proposed_profile_changes" CASCADE;
  DROP TABLE "radar_public_ratings_human_review_additional_evidence_refs" CASCADE;
  DROP TABLE "radar_public_ratings" CASCADE;
  DROP TYPE "public"."enum_radar_public_ratings_core_grade";
  DROP TYPE "public"."enum_radar_public_ratings_best_grade";
  DROP TYPE "public"."enum_radar_public_ratings_likely_grade";
  DROP TYPE "public"."enum_radar_public_ratings_worst_grade";
  DROP TYPE "public"."enum_radar_public_ratings_confidence";
  DROP TYPE "public"."enum_radar_public_ratings_human_review_status";
  DROP TYPE "public"."enum_radar_public_ratings_human_review_proposed_core_grade";
  DROP TYPE "public"."enum_radar_public_ratings_record_status";`)
}
