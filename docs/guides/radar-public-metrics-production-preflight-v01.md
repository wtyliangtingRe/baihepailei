# Radar Public Metrics Production Preflight v01

## Purpose

This guide records the reusable production-readiness preflight for the frozen public metrics overlay:

```text
Release: RADAR-PUBLIC-METRICS-10563-0001
Rows:    10,563
```

The preflight binds the exact website implementation, exact private Research Release, exact source PostgreSQL identity, a fresh backup, a disposable restore rehearsal, and two exact planner results.

It is deliberately **not** a production migration or metric import.

## Locked identities

```text
Website merged main:
b5ffbe006913218d32b96c131074b7740bf827a0

Research Release commit:
c2fe7847ee8b60b439f8e92025437937ceff06d5

Release ID:
RADAR-PUBLIC-METRICS-10563-0001

Migration:
20260803_102741_radar_public_metrics_v01
```

Release SHA-256 values:

```text
manifest.json
  da4b52eae91224a8bab46aebff69734c6a3d2bc3005de415b027a9e4eba6226d

metrics.jsonl
  1bdfda49f4f72a823efc86de42c565d3bdef162136aef697d0dc1d3bb343a946

review-flags.jsonl
  642881e9760e3d1b0000ee5cbfdd28f58a2afc4b6c7a238f1d753f886d1d2ebe

release-index.jsonl
  4768614dfbd4d703f3946ce61507fa7610a93093603ed4632ba8da7d85242d36
```

A later Research commit does not silently replace this input. The preflight creates a detached worktree at the exact Release commit.

## Entry point

```text
scripts/radar/prepare-radar-public-metrics-production-preflight-v01.ps1
```

Required invocation:

```powershell
pwsh `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File ".\scripts\radar\prepare-radar-public-metrics-production-preflight-v01.ps1" `
  -ExpectedToolHead "<exact branch commit>" `
  -Confirm "PREPARE-RADAR-PUBLIC-METRICS-PRODUCTION-PREFLIGHT-V01"
```

The local website branch and its remote tracking branch must both equal the supplied exact tool commit. The website worktree must be clean.

## Source database boundary

The source PostgreSQL container is read through sessions with:

```text
default_transaction_read_only=on
TimeZone=UTC
```

The preflight requires the current source state:

```text
Public Records:  10,563 current rows
Public Ratings:  10,563 current rows
Rating columns:  36
payload_migrations rows: 9
Metric columns present: 0
```

It records and later compares:

- the exact `radar_public_ratings` column sequence;
- the exact `payload_migrations` sequence;
- full Works fingerprints;
- full Public Records fingerprints;
- Public Ratings fingerprints excluding the eight not-yet-present metric columns.

The source container is never removed, recreated, or pointed at the Payload migration command.

## Pre-schema planner gate

The first planner run reads the source snapshot before any migration exists.

Required result:

```text
releaseRows:             10,563
databaseCurrentRows:     10,563
schemaReady:             false
blocked:                 10,563
wouldUpdateAfterSchema:  10,563
missingRating:           0
identityMismatch:        0
wouldUpdate:             0
```

Every matched row is blocked only because the eight additive metric columns are absent.

## Fresh backup

The source database is copied with a fresh custom-format `pg_dump`:

```text
format:       custom
owner data:   excluded
privileges:   excluded
destination:  data_local/backups/
```

The candidate records its local path, byte count, and SHA-256.

The dump is retained locally only. It is not included in the text evidence package, committed to Git, uploaded to GitHub, or embedded into a candidate JSON file.

## Disposable restore rehearsal

The preflight starts a newly named PostgreSQL container using the exact source image and a randomly selected loopback port.

The temporary database uses no reusable credential and is reachable only through:

```text
127.0.0.1:<temporary port>
```

Before migration, the restored database must match the source exactly:

```text
Public Ratings:      10,563
Rating columns:      36
payload_migrations:  9
Existing fingerprints: exact source match
```

The script then temporarily sets `DATABASE_URL` to the loopback clone and runs exactly one command:

```text
pnpm exec payload migrate
```

The URL is parsed and rejected unless its hostname is exactly `127.0.0.1`, it has an explicit port, and it names a database.

## Temporary migration acceptance

Required isolated result:

```text
Rating columns:      36 -> 44
payload_migrations:  9 -> 10
New migration:       20260803_102741_radar_public_metrics_v01
Existing row data:   unchanged
Source database:     untouched
```

All eight columns must exist:

```text
confidence_percent
evidence_coverage_percent
metrics_policy_version
source_metrics_policy_version
relationship_evidence_state
metrics_source_release_id
metrics_calculation_basis_sha256
requires_metric_review
```

The temporary migration may update only the disposable database Schema and its own `payload_migrations` ledger.

## Post-schema planner gate

The second planner run reads the migrated disposable clone.

Required result:

```text
releaseRows:          10,563
databaseCurrentRows:  10,563
schemaReady:          true
wouldUpdate:          10,563
alreadyCurrent:       0
missingRating:        0
identityMismatch:     0
blocked:              0
```

This proves the additive Schema is ready for a later separately reviewed metric update executor. It does not execute that update.

## Source unchanged proof

After all temporary work, the script rereads the source database and requires byte-equivalent text representations of:

```text
columns before == columns after
migrations before == migrations after
protected fingerprints before == protected fingerprints after
```

The accepted receipt must state:

```text
sourceMigrationExecuted = false
metricImportExecuted = false
productionAuthorization = false
```

## Candidate and evidence

Expected output root:

```text
data_local/outputs/radar-public-metrics-production-preflight-v01/
```

A successful run contains text evidence including:

```text
production-preflight-candidate.json
production-preflight-receipt.json
source-before/summary.json
source-before/columns.json
source-before/migrations.tsv
source-before/fingerprints.tsv
source-before/ratings-current.jsonl
source-after/summary.json
source-after/columns.json
source-after/migrations.tsv
source-after/fingerprints.tsv
temporary-before-migration/*
temporary-after-migration/*
plan-before-schema/*
plan-after-schema/*
temporary-migration.log
SHA256SUMS.txt
```

The evidence directory is scanned for database URLs, passwords, Payload/JWT secrets, and private-key markers before its checksum manifest is written.

The candidate binds:

- exact website base and tool commit;
- exact Research commit and Release file hashes;
- exact source container ID and image;
- source row, column, migration, and fingerprint state;
- fresh backup SHA-256;
- exact disposable migration result;
- exact pre-schema and post-schema planner results;
- SHA-256 values for critical code and migration files;
- all false production authorization gates.

## Cleanup

On success or failure, the runner removes:

- the disposable PostgreSQL container;
- its anonymous volume;
- the detached Research worktree.

The source container is not stopped or removed.

The fresh local backup is intentionally retained for independent review. Failed runs retain a failure receipt and require inspection before retry.

## Authorization boundary

This stage authorizes only an independently reviewable preflight candidate.

It does **not** authorize:

- migration of the source database;
- update of any Public Rating row;
- changes to Works;
- changes to `Works.radarAssessment`;
- changes to `Works.humanAssessment`;
- rerunning either historical unified Release apply-once;
- automatic retry;
- automatic rollback.

Never rerun a completed apply-once release. The 575-row and 9,988-row production importers are historical completed operations and are not part of this metrics workflow.

The next stage, after independent candidate review, is a separate source-Schema migration authorization. Metric import remains a later independent implementation and review stage.

## Reuse for a future metric Release

A future release must update all locked values deliberately:

1. website merged base;
2. Research commit;
3. Release ID and directory;
4. all Release SHA-256 values;
5. expected row inventory;
6. expected source migration count;
7. migration name and expected column transition;
8. planner acceptance counts;
9. tests, CI, and this guide.

Do not reuse this candidate for a different Release, database state, website commit, backup, or migration.
