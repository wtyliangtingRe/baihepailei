import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * Existing production-like PostgreSQL schema baseline.
 *
 * The database already contained this schema before Payload migrations were
 * adopted. Keep the adjacent JSON snapshot for future schema diffs, but do
 * not recreate any existing table, enum, index, constraint or row here.
 */
export async function up(_args: MigrateUpArgs): Promise<void> {
  // Intentionally empty.
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  // Intentionally empty. Existing pre-migration schema must never be dropped.
}