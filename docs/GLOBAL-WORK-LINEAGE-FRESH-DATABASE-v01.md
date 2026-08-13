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

## Sealed production lock

The production lock is bound to the complete deterministic package built from the accepted research-data migration package source:

| Proof | Value |
| --- | --- |
| package ID | `GLOBAL-WORK-LINEAGE-V01-TERMINAL-MIGRATION-PACKAGE-20260814-01` |
| formal `SHA256SUMS` SHA-256 | `e603381b729e2af703b01ebad436544c3f7097403959e76ca6e6e6557eaa6376` |
| formal WorkLineage JSONL SHA-256 | `a88b14fb46ae981278374e33ad13b597ecb61527ef678fdf4ec241c27795c822` |
| OutputManifest hash | `sha256:4579ea518b58bb84bda65c39519e502d75efc60aed69fe594991a2be6628ef18` |
| provenance root | `sha256:9da191a48e7b91a360329b731fc9b82d2ddbef0decf5f61fab96282855fa03d9` |
| database document-set SHA-256 | `407b60033d85cda0848238bfaba69c699b59099c5f054dcd9a4120bc0155600a` |
| database provenance-object-set SHA-256 | `fc7b67954f0af0f96a07e6bb0c7a023aa029c07976dbc6069f65d94ce4abc465` |

The complete package was built twice and compared byte-for-byte. The real formal package was then prepared for the website twice and compared byte-for-byte. The website prepare proof SHA-256 is `ba636bfc0f759f15bb39ebda33ce6317c644df45eabb0aa485aa6dbf09f909ad`.

## Freshness guard

`apply.sql` aborts before creating anything unless the target database contains zero persistent user relations (tables, partitioned tables, views, materialized views, foreign tables, and sequences). The schema also uses no `IF NOT EXISTS`; accidental reuse cannot silently blend old and new state.

The old Payload database remains a separate database. Production cutover changes the website connection to the new database only after validation. It is never attached through foreign-data wrappers, views, cross-database links, or runtime APIs.

For local development, `docker-compose.yml` uses a new `baihepailei_v01` database and a separate `postgres-v01-data` volume. The historical `postgres-data` volume is not mounted, so deleting it after the rollback window cannot affect the new database.

The new runtime repository requires `WORK_LINEAGE_DATABASE_URL`; it has no default to the historical Payload/Radar readers. It exposes exact `workId` lookup and a title/Work-ID presentation search through `/api/work-lineage/works`. Search never constructs identity authority. Missing configuration or a malformed row fails closed with an unavailable response.

The homepage, browse page, Work list, Work detail, and search read the new repository directly. Public legacy rating, Radar, evidence, recommendation, and update routes expose an explicit empty/retired state instead of reading the historical Payload collections or generated `search-index.json` / `detail-index.json`. Creator and organization routes remain empty until the new process creates formal entities; the migration does not infer them from old fields. Direct historical Radar downloads return `410 Gone`.

This UI cutover is deliberately lossy. It preserves the new formal data plane and removes old runtime conclusions instead of implementing a dual read, route alias, compatibility bridge, or fallback.

## Destructive-dependency proof

CI performs three tests:

1. a non-empty database is rejected;
2. an unexpected third relation inside the new schema is rejected, including a view that could act as a compatibility bridge;
3. a fresh database is imported, then the formal package and prepared files are removed; the standalone validator is copied outside the checkout and runs from an isolated directory with no reference/drop/legacy input.

The database validator reads only PostgreSQL and the tiny immutable lock. It proves exact row/digest conservation, zero retired legacy data, zero old conclusions, complete provenance closure, exactly the two intended target relations, and no persistent relations outside the new schema.

This is the acceptance criterion behind the owner's requirement:

> deleting every old database and residual legacy/reference file immediately after cutover must not affect the new system.

## Production procedure

1. Download the exact sealed formal artifact from the accepted research-data package workflow, or rebuild it from the exact accepted research-data commit and require the committed lock to match every digest.
2. Create a brand-new empty PostgreSQL database with new credentials.
3. Run the one-time cutover command below. It verifies the package, prepares twice, requires byte-identical outputs, imports with plain INSERT into the empty database, removes every generated import derivative, and runs the standalone database-only validator from an isolated temporary directory.
4. Move the formal package and every old/reference input out of reach. The cutover command deliberately does not delete caller-owned package files or any database.
5. Point both `DATABASE_URL` and `WORK_LINEAGE_DATABASE_URL` at the new database. Keep `RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY`, `RADAR_PUBLIC_RECORDS_SCHEMA_READY`, and `RADAR_PUBLIC_RATINGS_SCHEMA_READY` false. With `PAYLOAD_DB_PUSH=true`, start Payload once to create the non-Radar site/account schema; stop it, set `PAYLOAD_DB_PUSH=false`, and never run the historical additive migration chain against this fresh database.
6. Run website formal-read smoke tests. New-flow write smoke tests become mandatory when the first new Discover / Research / Assessment writer is introduced; this migration does not claim that those writers already exist.
7. Cut over production traffic.
8. After the rollback window, delete the old database and legacy/reference residues as a separate, explicitly targeted operation.

From PowerShell, with `WORK_LINEAGE_DATABASE_URL` already set to the newly created empty database:

```powershell
python scripts/work-lineage/run_fresh_global_work_lineage_cutover_v01.py `
  --formal-package "D:\path\to\global-work-lineage-v01-terminal-migration-20260814\package\formal" `
  --database-url $env:WORK_LINEAGE_DATABASE_URL `
  --expected-database-name "baihepailei_v01" `
  --proof-dir ".\artifacts\global-work-lineage-v01-cutover-proof"
```

Success is exactly `PASS_CUTOVER_COMPLETE`. The proof directory contains deterministic prepare/import proofs, the database-only proof, and a credential-free cutover summary.

The repository scripts do not delete the old database. Database destruction remains a separate operational action because its target name and rollback window are deployment-specific.
