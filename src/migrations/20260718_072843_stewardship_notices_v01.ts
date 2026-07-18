import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_works_status"
    ADD VALUE IF NOT EXISTS 'archived';
  ALTER TYPE "public"."enum__works_v_version_status"
    ADD VALUE IF NOT EXISTS 'archived';
   CREATE TYPE "public"."enum_stewardship_notices_applicable_collections" AS ENUM('works', 'creators', 'organizations');
  CREATE TYPE "public"."enum_stewardship_notices_category" AS ENUM('operation', 'terminology', 'identity', 'editorial', 'content', 'transparency', 'other');
  CREATE TYPE "public"."enum_stewardship_notices_tone" AS ENUM('note', 'warning', 'danger', 'black-banner');
  CREATE TYPE "public"."enum_stewardship_notices_severity" AS ENUM('low', 'medium', 'high', 'critical');
  CREATE TYPE "public"."enum_stewardship_notices_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__stewardship_notices_v_version_applicable_collections" AS ENUM('works', 'creators', 'organizations');
  CREATE TYPE "public"."enum__stewardship_notices_v_version_category" AS ENUM('operation', 'terminology', 'identity', 'editorial', 'content', 'transparency', 'other');
  CREATE TYPE "public"."enum__stewardship_notices_v_version_tone" AS ENUM('note', 'warning', 'danger', 'black-banner');
  CREATE TYPE "public"."enum__stewardship_notices_v_version_severity" AS ENUM('low', 'medium', 'high', 'critical');
  CREATE TYPE "public"."enum__stewardship_notices_v_version_status" AS ENUM('draft', 'published');
  CREATE TABLE "creators_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"stewardship_notices_id" integer
  );
  
  CREATE TABLE "_creators_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"stewardship_notices_id" integer
  );
  
  CREATE TABLE "organizations_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"stewardship_notices_id" integer
  );
  
  CREATE TABLE "_organizations_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"stewardship_notices_id" integer
  );
  
  CREATE TABLE "stewardship_notices_applicable_collections" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_stewardship_notices_applicable_collections",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "stewardship_notices" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"slug" varchar,
  	"category" "enum_stewardship_notices_category" DEFAULT 'operation',
  	"tone" "enum_stewardship_notices_tone" DEFAULT 'note',
  	"severity" "enum_stewardship_notices_severity" DEFAULT 'low',
  	"summary" varchar,
  	"details" jsonb,
  	"help_url" varchar,
  	"sort_order" numeric DEFAULT 100,
  	"is_public" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_stewardship_notices_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "_stewardship_notices_v_version_applicable_collections" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum__stewardship_notices_v_version_applicable_collections",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "_stewardship_notices_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_category" "enum__stewardship_notices_v_version_category" DEFAULT 'operation',
  	"version_tone" "enum__stewardship_notices_v_version_tone" DEFAULT 'note',
  	"version_severity" "enum__stewardship_notices_v_version_severity" DEFAULT 'low',
  	"version_summary" varchar,
  	"version_details" jsonb,
  	"version_help_url" varchar,
  	"version_sort_order" numeric DEFAULT 100,
  	"version_is_public" boolean DEFAULT false,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__stewardship_notices_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  ALTER TABLE "works_rels" ADD COLUMN "stewardship_notices_id" integer;
  ALTER TABLE "_works_v_rels" ADD COLUMN "stewardship_notices_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "stewardship_notices_id" integer;
  ALTER TABLE "creators_rels" ADD CONSTRAINT "creators_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "creators_rels" ADD CONSTRAINT "creators_rels_stewardship_notices_fk" FOREIGN KEY ("stewardship_notices_id") REFERENCES "public"."stewardship_notices"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_creators_v_rels" ADD CONSTRAINT "_creators_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_creators_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_creators_v_rels" ADD CONSTRAINT "_creators_v_rels_stewardship_notices_fk" FOREIGN KEY ("stewardship_notices_id") REFERENCES "public"."stewardship_notices"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "organizations_rels" ADD CONSTRAINT "organizations_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "organizations_rels" ADD CONSTRAINT "organizations_rels_stewardship_notices_fk" FOREIGN KEY ("stewardship_notices_id") REFERENCES "public"."stewardship_notices"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_organizations_v_rels" ADD CONSTRAINT "_organizations_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_organizations_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_organizations_v_rels" ADD CONSTRAINT "_organizations_v_rels_stewardship_notices_fk" FOREIGN KEY ("stewardship_notices_id") REFERENCES "public"."stewardship_notices"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "stewardship_notices_applicable_collections" ADD CONSTRAINT "stewardship_notices_applicable_collections_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."stewardship_notices"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_stewardship_notices_v_version_applicable_collections" ADD CONSTRAINT "_stewardship_notices_v_version_applicable_collections_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_stewardship_notices_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_stewardship_notices_v" ADD CONSTRAINT "_stewardship_notices_v_parent_id_stewardship_notices_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."stewardship_notices"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "creators_rels_order_idx" ON "creators_rels" USING btree ("order");
  CREATE INDEX "creators_rels_parent_idx" ON "creators_rels" USING btree ("parent_id");
  CREATE INDEX "creators_rels_path_idx" ON "creators_rels" USING btree ("path");
  CREATE INDEX "creators_rels_stewardship_notices_id_idx" ON "creators_rels" USING btree ("stewardship_notices_id");
  CREATE INDEX "_creators_v_rels_order_idx" ON "_creators_v_rels" USING btree ("order");
  CREATE INDEX "_creators_v_rels_parent_idx" ON "_creators_v_rels" USING btree ("parent_id");
  CREATE INDEX "_creators_v_rels_path_idx" ON "_creators_v_rels" USING btree ("path");
  CREATE INDEX "_creators_v_rels_stewardship_notices_id_idx" ON "_creators_v_rels" USING btree ("stewardship_notices_id");
  CREATE INDEX "organizations_rels_order_idx" ON "organizations_rels" USING btree ("order");
  CREATE INDEX "organizations_rels_parent_idx" ON "organizations_rels" USING btree ("parent_id");
  CREATE INDEX "organizations_rels_path_idx" ON "organizations_rels" USING btree ("path");
  CREATE INDEX "organizations_rels_stewardship_notices_id_idx" ON "organizations_rels" USING btree ("stewardship_notices_id");
  CREATE INDEX "_organizations_v_rels_order_idx" ON "_organizations_v_rels" USING btree ("order");
  CREATE INDEX "_organizations_v_rels_parent_idx" ON "_organizations_v_rels" USING btree ("parent_id");
  CREATE INDEX "_organizations_v_rels_path_idx" ON "_organizations_v_rels" USING btree ("path");
  CREATE INDEX "_organizations_v_rels_stewardship_notices_id_idx" ON "_organizations_v_rels" USING btree ("stewardship_notices_id");
  CREATE INDEX "stewardship_notices_applicable_collections_order_idx" ON "stewardship_notices_applicable_collections" USING btree ("order");
  CREATE INDEX "stewardship_notices_applicable_collections_parent_idx" ON "stewardship_notices_applicable_collections" USING btree ("parent_id");
  CREATE UNIQUE INDEX "stewardship_notices_slug_idx" ON "stewardship_notices" USING btree ("slug");
  CREATE INDEX "stewardship_notices_updated_at_idx" ON "stewardship_notices" USING btree ("updated_at");
  CREATE INDEX "stewardship_notices_created_at_idx" ON "stewardship_notices" USING btree ("created_at");
  CREATE INDEX "stewardship_notices__status_idx" ON "stewardship_notices" USING btree ("_status");
  CREATE INDEX "_stewardship_notices_v_version_applicable_collections_order_idx" ON "_stewardship_notices_v_version_applicable_collections" USING btree ("order");
  CREATE INDEX "_stewardship_notices_v_version_applicable_collections_parent_idx" ON "_stewardship_notices_v_version_applicable_collections" USING btree ("parent_id");
  CREATE INDEX "_stewardship_notices_v_parent_idx" ON "_stewardship_notices_v" USING btree ("parent_id");
  CREATE INDEX "_stewardship_notices_v_version_version_slug_idx" ON "_stewardship_notices_v" USING btree ("version_slug");
  CREATE INDEX "_stewardship_notices_v_version_version_updated_at_idx" ON "_stewardship_notices_v" USING btree ("version_updated_at");
  CREATE INDEX "_stewardship_notices_v_version_version_created_at_idx" ON "_stewardship_notices_v" USING btree ("version_created_at");
  CREATE INDEX "_stewardship_notices_v_version_version__status_idx" ON "_stewardship_notices_v" USING btree ("version__status");
  CREATE INDEX "_stewardship_notices_v_created_at_idx" ON "_stewardship_notices_v" USING btree ("created_at");
  CREATE INDEX "_stewardship_notices_v_updated_at_idx" ON "_stewardship_notices_v" USING btree ("updated_at");
  CREATE INDEX "_stewardship_notices_v_latest_idx" ON "_stewardship_notices_v" USING btree ("latest");
  ALTER TABLE "works_rels" ADD CONSTRAINT "works_rels_stewardship_notices_fk" FOREIGN KEY ("stewardship_notices_id") REFERENCES "public"."stewardship_notices"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_works_v_rels" ADD CONSTRAINT "_works_v_rels_stewardship_notices_fk" FOREIGN KEY ("stewardship_notices_id") REFERENCES "public"."stewardship_notices"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_stewardship_notices_fk" FOREIGN KEY ("stewardship_notices_id") REFERENCES "public"."stewardship_notices"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "works_rels_stewardship_notices_id_idx" ON "works_rels" USING btree ("stewardship_notices_id");
  CREATE INDEX "_works_v_rels_stewardship_notices_id_idx" ON "_works_v_rels" USING btree ("stewardship_notices_id");
  CREATE INDEX "payload_locked_documents_rels_stewardship_notices_id_idx" ON "payload_locked_documents_rels" USING btree ("stewardship_notices_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "creators_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_creators_v_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "organizations_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_organizations_v_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "stewardship_notices_applicable_collections" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "stewardship_notices" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_stewardship_notices_v_version_applicable_collections" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_stewardship_notices_v" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "creators_rels" CASCADE;
  DROP TABLE "_creators_v_rels" CASCADE;
  DROP TABLE "organizations_rels" CASCADE;
  DROP TABLE "_organizations_v_rels" CASCADE;
  DROP TABLE "stewardship_notices_applicable_collections" CASCADE;
  DROP TABLE "stewardship_notices" CASCADE;
  DROP TABLE "_stewardship_notices_v_version_applicable_collections" CASCADE;
  DROP TABLE "_stewardship_notices_v" CASCADE;
  ALTER TABLE "works_rels" DROP CONSTRAINT "works_rels_stewardship_notices_fk";
  
  ALTER TABLE "_works_v_rels" DROP CONSTRAINT "_works_v_rels_stewardship_notices_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_stewardship_notices_fk";
  
  DROP INDEX "works_rels_stewardship_notices_id_idx";
  DROP INDEX "_works_v_rels_stewardship_notices_id_idx";
  DROP INDEX "payload_locked_documents_rels_stewardship_notices_id_idx";
  ALTER TABLE "works_rels" DROP COLUMN "stewardship_notices_id";
  ALTER TABLE "_works_v_rels" DROP COLUMN "stewardship_notices_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "stewardship_notices_id";
  DROP TYPE "public"."enum_stewardship_notices_applicable_collections";
  DROP TYPE "public"."enum_stewardship_notices_category";
  DROP TYPE "public"."enum_stewardship_notices_tone";
  DROP TYPE "public"."enum_stewardship_notices_severity";
  DROP TYPE "public"."enum_stewardship_notices_status";
  DROP TYPE "public"."enum__stewardship_notices_v_version_applicable_collections";
  DROP TYPE "public"."enum__stewardship_notices_v_version_category";
  DROP TYPE "public"."enum__stewardship_notices_v_version_tone";
  DROP TYPE "public"."enum__stewardship_notices_v_version_severity";
  DROP TYPE "public"."enum__stewardship_notices_v_version_status";`)
}
