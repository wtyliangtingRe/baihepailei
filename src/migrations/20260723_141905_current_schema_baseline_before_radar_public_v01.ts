import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

/** Snapshot-only baseline. Running this migration intentionally changes nothing. */
export async function up(_args: MigrateUpArgs): Promise<void> {}
export async function down(_args: MigrateDownArgs): Promise<void> {}
