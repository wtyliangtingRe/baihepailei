import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_radar_public_records_evidence_tier" AS ENUM('A', 'B', 'C', 'D', 'E');
  CREATE TYPE "public"."enum_radar_public_records_evidence_role" AS ENUM('primary', 'supplemental', 'lead_only');
  CREATE TYPE "public"."enum_radar_public_records_public_state" AS ENUM('verified', 'partial', 'needs_more_research');
  CREATE TYPE "public"."enum_radar_public_records_research_status" AS ENUM('ready_for_publication', 'partially_verified', 'needs_more_research');
  CREATE TYPE "public"."enum_radar_public_records_record_status" AS ENUM('current', 'withdrawn');
  CREATE TABLE "radar_public_records_facts_source_refs" (
    "_order" integer NOT NULL,
    "_parent_id" varchar NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "value" varchar NOT NULL
  );

  CREATE TABLE "radar_public_records_facts" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "fact_id" varchar NOT NULL,
    "fact_type" varchar NOT NULL,
    "value" jsonb NOT NULL
  );

  CREATE TABLE "radar_public_records_evidence" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "source_ref" varchar NOT NULL,
    "tier" "enum_radar_public_records_evidence_tier" NOT NULL,
    "role" "enum_radar_public_records_evidence_role" NOT NULL,
    "url" varchar NOT NULL,
    "title" varchar NOT NULL,
    "exact_identity_bound" boolean DEFAULT false NOT NULL
  );

  CREATE TABLE "radar_public_records" (
    "id" serial PRIMARY KEY NOT NULL,
    "publication_key" varchar NOT NULL,
    "work_id" integer NOT NULL,
    "identity_key" varchar NOT NULL,
    "work_id_snapshot" varchar NOT NULL,
    "work_site_id" varchar NOT NULL,
    "title" varchar NOT NULL,
    "public_state" "enum_radar_public_records_public_state" NOT NULL,
    "research_status" "enum_radar_public_records_research_status" NOT NULL,
    "page_notice" varchar NOT NULL,
    "source_release_id" varchar NOT NULL,
    "source_commit_sha" varchar NOT NULL,
    "source_policy_version" varchar NOT NULL,
    "research_snapshot_id" varchar NOT NULL,
    "record_sha256" varchar NOT NULL,
    "release_records_sha256" varchar NOT NULL,
    "source_reviewed_at" timestamp(3) with time zone NOT NULL,
    "imported_at" timestamp(3) with time zone NOT NULL,
    "record_status" "enum_radar_public_records_record_status" DEFAULT 'current' NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "radar_public_records_facts_source_refs" ADD CONSTRAINT "radar_public_records_facts_source_refs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."radar_public_records_facts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "radar_public_records_facts" ADD CONSTRAINT "radar_public_records_facts_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."radar_public_records"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "radar_public_records_evidence" ADD CONSTRAINT "radar_public_records_evidence_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."radar_public_records"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "radar_public_records" ADD CONSTRAINT "radar_public_records_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "radar_public_records_facts_source_refs_order_idx" ON "radar_public_records_facts_source_refs" USING btree ("_order");
  CREATE INDEX "radar_public_records_facts_source_refs_parent_id_idx" ON "radar_public_records_facts_source_refs" USING btree ("_parent_id");
  CREATE INDEX "radar_public_records_facts_order_idx" ON "radar_public_records_facts" USING btree ("_order");
  CREATE INDEX "radar_public_records_facts_parent_id_idx" ON "radar_public_records_facts" USING btree ("_parent_id");
  CREATE INDEX "radar_public_records_evidence_order_idx" ON "radar_public_records_evidence" USING btree ("_order");
  CREATE INDEX "radar_public_records_evidence_parent_id_idx" ON "radar_public_records_evidence" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "radar_public_records_publication_key_idx" ON "radar_public_records" USING btree ("publication_key");
  CREATE INDEX "radar_public_records_work_idx" ON "radar_public_records" USING btree ("work_id");
  CREATE UNIQUE INDEX "radar_public_records_identity_key_idx" ON "radar_public_records" USING btree ("identity_key");
  CREATE INDEX "radar_public_records_work_id_snapshot_idx" ON "radar_public_records" USING btree ("work_id_snapshot");
  CREATE INDEX "radar_public_records_work_site_id_idx" ON "radar_public_records" USING btree ("work_site_id");
  CREATE INDEX "radar_public_records_public_state_idx" ON "radar_public_records" USING btree ("public_state");
  CREATE INDEX "radar_public_records_research_status_idx" ON "radar_public_records" USING btree ("research_status");
  CREATE INDEX "radar_public_records_source_release_id_idx" ON "radar_public_records" USING btree ("source_release_id");
  CREATE INDEX "radar_public_records_record_sha256_idx" ON "radar_public_records" USING btree ("record_sha256");
  CREATE INDEX "radar_public_records_source_reviewed_at_idx" ON "radar_public_records" USING btree ("source_reviewed_at");
  CREATE INDEX "radar_public_records_record_status_idx" ON "radar_public_records" USING btree ("record_status");
  CREATE INDEX "radar_public_records_updated_at_idx" ON "radar_public_records" USING btree ("updated_at");
  CREATE INDEX "radar_public_records_created_at_idx" ON "radar_public_records" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "radar_public_records_facts_source_refs" CASCADE;
  DROP TABLE "radar_public_records_facts" CASCADE;
  DROP TABLE "radar_public_records_evidence" CASCADE;
  DROP TABLE "radar_public_records" CASCADE;
  DROP TYPE "public"."enum_radar_public_records_evidence_tier";
  DROP TYPE "public"."enum_radar_public_records_evidence_role";
  DROP TYPE "public"."enum_radar_public_records_public_state";
  DROP TYPE "public"."enum_radar_public_records_research_status";
  DROP TYPE "public"."enum_radar_public_records_record_status";`)
}
