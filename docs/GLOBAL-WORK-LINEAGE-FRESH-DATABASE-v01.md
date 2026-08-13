# Global Work Lineage v01 — Fresh Database Import v01

> Status: **FRESH DATABASE ONLY / FROZEN 13-BLOCK / NO LEGACY RUNTIME DEPENDENCY**

The website starts a new PostgreSQL database for the Global Work Lineage v01 data plane. It does not upgrade the old Payload database, copy old tables, or create a compatibility layer.

## Physical model

The new database has one schema and two generic tables:

| Table | Purpose |
| --- | --- |
| `global_work_lineage_v01.work_lineages` | one self-contained JSONB projection per Work, with stable `work_id`, document digest, canonical-title index, and identity-binding GIN index |
| `global_work_lineage_v01.provenance_objects` | the already-defined Global ProvenanceSystem supporting objects used by imported rows |

This does not add a fourteenth logical block. `work_lineages.document` preserves the Frozen contract; the migration-only `legacy` block is retired and omitted. The provenance table stores supporting objects already required by Section 13.

Only two physical tables are necessary for the migration cutover. New Discover / Research / Assessment writers can later normalize hot write paths if profiling proves that necessary. The logical contract remains authoritative, so that physical optimization does not create new semantics.

## Import boundary

The importer accepts only the locked self-contained `formal/` package. It never accepts the root three-way package or the `reference/` directory.

Before writing, it verifies:

- all formal checksums and manifest self-hashes;
- the exact locked package and provenance root;
- 13 Frozen logical blocks with `legacy` retired;
- 35,411 unique Work rows;
- 34,169 unique full logical IdentityBinding revisions;
- 1,242 truthful partial identity observations;
- zero old Research, Assessment, Candidate, Published, Human judgment, or rating authority;
- fail-closed effective AI selection;
- complete provenance-object closure.

It prepares deterministic TSV and SQL files twice identically. Execution uses plain INSERT inside one transaction. There is no upsert, merge, mapper, alias, or fallback.

## Freshness guard

`apply.sql` aborts before creating anything unless the target database contains zero user tables. The schema also uses no `IF NOT EXISTS`; accidental reuse cannot silently blend old and new state.

The old Payload database remains a separate database. Production cutover changes the website connection to the new database only after validation. It is never attached through foreign-data wrappers, views, cross-database links, or runtime APIs.

For local development, `docker-compose.yml` uses a new `baihepailei_v01` database and a separate `postgres-v01-data` volume. The historical `postgres-data` volume is not mounted, so deleting it after the rollback window cannot affect the new database.

The new runtime repository requires `WORK_LINEAGE_DATABASE_URL`; it has no default to the historical Payload/Radar readers. It exposes exact `workId` lookup and a title/Work-ID presentation search through `/api/work-lineage/works`. Search never constructs identity authority. Missing configuration or a malformed row fails closed with an unavailable response.

The homepage, browse page, Work list, Work detail, and search read the new repository directly. Public legacy rating, Radar, evidence, recommendation, and update routes expose an explicit empty/retired state instead of reading the historical Payload collections or generated `search-index.json` / `detail-index.json`. Creator and organization routes remain empty until the new process creates formal entities; the migration does not infer them from old fields. Direct historical Radar downloads return `410 Gone`.

This UI cutover is deliberately lossy. It preserves the new formal data plane and removes old runtime conclusions instead of implementing a dual read, route alias, compatibility bridge, or fallback.

## Destructive-dependency proof

CI performs two tests:

1. a non-empty database is rejected;
2. a fresh database is imported, then the formal package and prepared files are removed; the standalone validator is copied outside the checkout and runs from an isolated directory with no reference/drop/legacy input.

The database validator reads only PostgreSQL and the tiny immutable lock. It proves exact row/digest conservation, zero retired legacy data, zero old conclusions, complete provenance closure, and no tables outside the new schema.

This is the acceptance criterion behind the owner's requirement:

> deleting every old database and residual legacy/reference file immediately after cutover must not affect the new system.

## Production procedure

1. Download the exact sealed formal artifact from the accepted research-data package workflow.
2. Create a brand-new empty PostgreSQL database with new credentials.
3. Run the preparer without `--execute` and archive its proof.
4. Run the preparer with `--execute` against the new database.
5. Move the formal package and every old/reference input out of reach.
6. Run the standalone database validator.
7. Point both `DATABASE_URL` and `WORK_LINEAGE_DATABASE_URL` at the new database. Keep `RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY`, `RADAR_PUBLIC_RECORDS_SCHEMA_READY`, and `RADAR_PUBLIC_RATINGS_SCHEMA_READY` false. With `PAYLOAD_DB_PUSH=true`, start Payload once to create the non-Radar site/account schema; stop it, set `PAYLOAD_DB_PUSH=false`, and never run the historical additive migration chain against this fresh database.
8. Run website formal-read smoke tests. New-flow write smoke tests become mandatory when the first new Discover / Research / Assessment writer is introduced; this migration does not claim that those writers already exist.
9. Cut over production traffic.
10. After the rollback window, delete the old database and legacy/reference residues as a separate, explicitly targeted operation.

The repository scripts do not delete the old database. Database destruction remains a separate operational action because its target name and rollback window are deployment-specific.
