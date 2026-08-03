# Radar Public Metrics Overlay v01

## Purpose

This guide records the reusable website-side workflow for adding and validating the frozen public Radar metrics overlay:

- `confidencePercent` — agreement between the current machine rating decision and retained evidence; it is **not** the probability that a work is safe;
- `evidenceCoveragePercent` — weighted completion of relevant Radar evidence dimensions; it is **not** a source-count percentage or research-task completion percentage.

The workflow keeps these values inside the existing Radar AI presentation track. It must not create a second rating centre, overwrite `Works.humanAssessment`, or derive numbers from the legacy `high / medium / low` label.

## Canonical inputs

Current canonical metric Release:

```text
Research repository: wtyliangtingRe/baihepailei-research-data
Release ID:           RADAR-PUBLIC-METRICS-10563-0001
Release directory:    releases/public/radar-public-metrics-10563-0001/v01
Rows:                 10,563
Public policy:        radar-public-metrics-policy-v01
```

Required Release files:

```text
manifest.json
metrics.jsonl
review-flags.jsonl
release-index.jsonl
SHA256SUMS
```

The Release authorizes website schema planning and import dry-run only. It does not authorize Payload, PostgreSQL, or production writes.

## Website schema contract

`radar-public-ratings` adds these optional fields:

```text
confidencePercent
evidenceCoveragePercent
metricsPolicyVersion
sourceMetricsPolicyVersion
relationshipEvidenceState
metricsSourceReleaseId
metricsCalculationBasisSha256
requiresMetricReview
```

The first two fields are integers from 0 through 100. Existing rows remain valid while the fields are null.

`relationshipEvidenceState` accepts only:

```text
covered
partial
uncovered
```

`requiresMetricReview` is a nonblocking calibration flag. It does not change the rating grade or human-review state.

## Current migration

```text
Migration name: 20260803_102741_radar_public_metrics_v01
TypeScript:     src/migrations/20260803_102741_radar_public_metrics_v01.ts
Snapshot:       src/migrations/20260803_102741_radar_public_metrics_v01.json
Target table:   public.radar_public_ratings
```

The generated `up` migration may only:

- add the eight metric columns;
- add the relationship-evidence enum;
- add indexes belonging to `radar_public_ratings`.

It must not contain data DML, create or drop unrelated tables, alter Works, change either assessment track, or modify existing rating values.

## Read-only planner

Planner:

```text
scripts/radar/plan-radar-public-metrics-overlay-v01.mjs
```

Inputs:

```text
--release-dir
--database-snapshot
--database-columns
--output-dir
```

Outputs:

```text
summary.json
plan.jsonl
summary.md
SHA256SUMS
```

Statuses:

- `alreadyCurrent` — all metric fields already match;
- `wouldUpdate` — exact current rating exists and one or more metric fields differ;
- `missingRating` — no current rating has the exact publication key;
- `identityMismatch` — the publication key resolves but the exact identity key differs;
- `blocked` — schema or inventory safety gate prevents an update plan.

Matching rules:

- exact `publicationKey = work:<workId>` only;
- exact `identityKey` only;
- no title matching;
- no identity substitution;
- no omission-means-delete behavior.

The planner contains no Payload create/update/delete operation and no SQL mutation statement.

## Reusable validation sequence

### 1. Validate the canonical Release

Before reading the database:

1. require the exact Release ID;
2. require frozen policy status;
3. require exactly 10,563 metric rows for this Release version;
4. verify `metrics.jsonl` SHA-256 against `manifest.json`;
5. require `websiteWrite`, `payloadWrite`, `postgresqlWrite`, and `productionAuthorization` to remain false.

For a future Release, replace the locked ID, row count, manifest hash, and policy version rather than silently reusing the current values.

### 2. Export a source read-only snapshot

Use a PostgreSQL session with:

```text
default_transaction_read_only=on
PAYLOAD_DB_PUSH=false
```

Export:

- all `radar_public_ratings` column names;
- all current rating rows as JSONL;
- source row count and content fingerprint;
- `payload_migrations` state.

The source container must not be removed, recreated, migrated, or written during planning.

### 3. Run the pre-schema plan

Before applying the additive migration, the expected current result for this version is:

```text
releaseRows:             10,563
databaseCurrentRows:     10,563
schemaReady:             false
missingRating:           0
identityMismatch:        0
wouldUpdateAfterSchema:  10,563
```

Rows are blocked only because the metric columns do not yet exist.

### 4. Generate the migration without executing it

Use `payload migrate:create` with:

```text
PGOPTIONS=-c default_transaction_read_only=on ...
PAYLOAD_DB_PUSH=false
RADAR_PUBLIC_RATINGS_SCHEMA_READY=true
```

After generation:

- inspect `up` and `down` separately;
- require all eight expected columns;
- require only `radar_public_ratings` table alterations;
- reject DML;
- reject unrelated table or enum operations;
- compare source Schema and `payload_migrations` before and after generation.

Do **not** run `payload migrate` against the source database in this stage.

### 5. Rehearse in an isolated database clone

Create a fresh `pg_dump` of the source and restore it into a newly created temporary PostgreSQL container on loopback.

Required clone checks before migration:

```text
Public Ratings rows: 10,563
Columns:             36
Data fingerprint:    exact source match
```

Temporarily point `DATABASE_URL` to the clone, verify the parsed host, port, and database name, then run `pnpm payload migrate` only against the clone.

Required result for the current migration:

```text
Columns:             36 -> 44
payload_migrations:  +1 exact row
Existing row content unchanged
```

Re-export the cloned ratings and rerun the planner. Required result:

```text
schemaReady:       true
alreadyCurrent:    0
wouldUpdate:       10,563
missingRating:     0
identityMismatch:  0
blocked:           0
```

Finally:

- rerun targeted tests and TypeScript;
- prove source Schema, source data fingerprint, and source migration state are unchanged;
- remove the temporary container and volume;
- remove all database dump bytes;
- retain only text evidence and checksums.

## Accepted local rehearsal receipt

The current implementation was accepted locally on 2026-08-03 with:

```text
Website branch:        agent/radar-public-metrics-schema-dryrun-v01
Implementation commit: 3621357e9b2033552cd071bce2218af9260c60b8
Source container:      baihepailei-postgres
Source image:          postgres:17-alpine
Source ratings:        10,563
Temporary columns:     36 -> 44
Temporary migrations:  9 -> 10
Planner wouldUpdate:   10,563
Planner missing:       0
Planner identity error:0
Planner blocked:       0
Targeted tests:        14 / 14 passed
TypeScript:            passed
Production build:      passed
Source database write: false
Metric import:         false
Temporary container:   removed
Database dump retained:false
```

Local evidence directories are intentionally untracked under `data_local/` and may contain machine-specific paths. Do not commit database dumps, credentials, database URLs, or secret environment values.

## Test suite

The reusable targeted suite is:

```text
tests/radar-live-pages.test.mjs
tests/collection-list-visual-headings.test.mjs
tests/radar-public-rating-bridge.test.mjs
tests/radar-public-metrics-schema.test.mjs
tests/radar-public-metrics-plan.test.mjs
tests/radar-public-metrics-migration.test.mjs
```

Required checks include:

- existing single AI panel remains the presentation target;
- numeric metrics are read only when explicitly present;
- no legacy label-to-number conversion;
- schema fields and provenance exist;
- migration is registered exactly once;
- migration only adds the expected fields;
- planner has no mutation implementation;
- exact identity and publication-key classification works.

Also run:

```text
pnpm exec tsc --noEmit --pretty false
pnpm build
git diff --check
```

## Evidence package

A reusable run should retain text-only evidence such as:

```text
summary.json
source-schema-before.txt
source-schema-after.txt
source-fingerprint-before.txt
source-fingerprint-after.txt
source-migrations-before.json
source-migrations-after.json
temporary-schema-after.txt
temporary-fingerprint-before.txt
temporary-fingerprint-after.txt
temporary-migrations-before.json
temporary-migrations-after.json
planner-after-schema.log
plan-after-schema/summary.json
plan-after-schema/plan.jsonl
tests.log
typescript-check.log
SHA256SUMS.txt
```

Database dump bytes are temporary transport for the isolated clone and must be deleted after the rehearsal.

## Authorization boundary

Merging the schema, migration, planner, tests, and this guide does not execute a migration or import metrics.

The following remain separate future gates:

1. review and merge the website PR;
2. prepare a source/production migration candidate bound to the exact merged `main` commit;
3. take a fresh backup and perform a same-window disposable restore rehearsal;
4. explicitly authorize the additive source migration;
5. rerun the planner against the migrated source and require 10,563 `wouldUpdate` rows with zero missing, mismatch, or blocked rows;
6. independently implement and review the metric update executor;
7. rehearse metric updates in a disposable clone and require a second plan of 10,563 `alreadyCurrent` rows;
8. only then consider a separately confirmed production apply-once operation.

Never reuse the completed historical 575/9,988 production importer for this overlay. Never rerun a completed apply-once release.

## Future Release reuse rules

For a future metric Release:

- create a new immutable Release ID;
- preserve the previous Release and policy versions;
- update the planner lock and expected inventory explicitly;
- require exact identity convergence before planning updates;
- generate a new candidate and evidence receipt;
- do not treat changed metric values as permission to change grades;
- keep human assessment independent;
- keep review flags nonblocking unless a future reviewed policy explicitly changes that contract;
- use a new migration only when the website field contract itself changes;
- use a separately reviewed update executor when only data values change.
