# Radar Public Metrics source schema rollback v01

## Scope

This runbook applies only to:

```text
20260803_102741_radar_public_metrics_v01
```

It is a disaster-recovery procedure for a failed or rejected source-schema
execution. It is not part of the normal migration flow.

The schema migration is additive, but rollback is still destructive because it
restores the whole PostgreSQL database to the apply-time checkpoint.

## Absolute boundaries

- Stop the website and every process that can write to PostgreSQL.
- Do not import the 10,563 Public Metrics rows.
- Do not run any historical apply-once package.
- Do not run the migration's `down()` function as an ad hoc repair.
- Do not restore from the older preflight Backup when a newer apply-time Backup
  exists.
- Preserve the failed run directory, migration log, failure receipt, execution
  receipt if present, and both backup SHA-256 values.
- Require a separate explicit rollback authorization.
- Never overwrite or delete the failed database before its own forensic dump is
  created.

## When rollback is required

Rollback is required when the executor reports `executed = true` and any
postcondition fails, including:

- columns are not exactly `44`;
- migration ledger is not exactly `10`;
- the new ledger row is not
  `20260803_102741_radar_public_metrics_v01` batch `4`;
- Works, Public Records, or existing Public Ratings fingerprints changed;
- any metric content field is populated;
- `requires_metric_review` is not `false` for every current rating;
- the source database cannot be opened reliably after migration.

A failure before `pnpm exec payload migrate` does not require database restore.

## Required evidence

Locate the failed run under:

```text
data_local\outputs\radar-public-metrics-source-schema-apply-once-v01\
```

Required files:

- `source-schema-failure.json`;
- `source-migration.log`, when created;
- `source-immediately-before-execute\`;
- `source-after\`, when created;
- `advisory-lock.stdout.txt`;
- `advisory-lock.stderr.txt`.

Locate the apply-time backup under:

```text
data_local\backups\radar-public-metrics-source-schema-apply-once-v01\
```

The exact backup path, bytes, and SHA-256 are recorded in the failure or
execution receipt.

## Recovery strategy

The preferred strategy is a side-by-side restore into a new disposable
PostgreSQL container, verification against the pre-migration snapshot, and only
then replacement of the failed source database.

Do not restore directly over the failed source on the first attempt.

### 1. Freeze writes

Stop the website and all workers. Confirm there are no active write
transactions.

### 2. Preserve the failed state

Create a forensic dump of the failed database and hash it. This dump is not a
rollback source; it preserves evidence.

### 3. Restore apply-time backup to a disposable container

Use the same PostgreSQL image recorded by the candidate:

```text
postgres:17-alpine
```

Bind the temporary container to loopback only.

### 4. Verify restored state

The restored checkpoint must have:

```text
Works:                  35,615
Public Records:         10,563
Public Ratings:         10,563
Public Rating columns:  36
Payload migrations:     9
```

Expected existing fingerprints:

```text
radar_public_ratings_existing_fields  10563  b607ac0e33d44ac384dc4a2cc97413ee
radar_public_records                  10563  ccd652d4790bbeb34279181cd62939be
works                                 35615  07632be7da96bb48129f207d3044c85e
```

The eight metric columns, metric enum, four metric indexes, and target migration
ledger row must be absent.

### 5. Independently authorize replacement

A human reviewer must compare:

- failed-run evidence;
- apply-time backup path, bytes, and SHA-256;
- disposable restore verification;
- original Candidate SHA-256;
- exact failed merged `main`;
- the reason rollback is necessary.

Only then authorize replacement.

### 6. Replace and reverify

Replace the failed source database using the verified apply-time backup.
Immediately rerun the pre-migration snapshot checks.

### 7. Stop

Do not rerun the schema apply-once executor in the same incident. A restored
database may look eligible again, but the historical execution already
occurred. Treat it as a new engineering incident requiring a new reviewed
migration strategy.

## Why `down()` is not the default rollback

The migration's `down()` removes eight columns, four indexes, and one enum. It
does not by itself prove that the Payload migration ledger, concurrent
transactions, application state, or partially completed DDL are restored to the
reviewed checkpoint.

The apply-time full-database backup is the authoritative rollback boundary.
