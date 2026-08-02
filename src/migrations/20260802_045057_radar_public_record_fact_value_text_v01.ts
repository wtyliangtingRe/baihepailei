import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "radar_public_records_facts" ALTER COLUMN "value" SET DATA TYPE varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "radar_public_records_facts" ALTER COLUMN "value" SET DATA TYPE jsonb;`)
}
