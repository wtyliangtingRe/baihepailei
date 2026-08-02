# Radar Unified Release 0575 production gate v01

## Scope

This stage prepares the production apply gate for:

```text
RADAR-UNIFIED-RATING-RELEASE-0575-0001
```

Locked inputs:

```text
accepted lab head   069e2d54055c8c8099ac8f37092e2bdb2b3e060c
merged lab main     6cdc29e28236f487a6e762a5c8871c681a870810
research head       728ad2da5f7d3aba03f652b9fd701157b06793ee
evidence SHA-256    59dc908a447500adb39ef9f72bde306268fdf24ec85fdaaeb418dee0fb9be09f
```

The accepted isolated evidence proves 575 Public Records creates, 575 Public Ratings creates, exact post-import convergence, protected-table stability and no source-database write.

## Stage P0 — independently accepted evidence

Complete.

The evidence archive has a closed-world manifest and SHA256SUMS. All 575 records and ratings were created in a disposable clone and replanned as `already_current`. The source-before, source-after, restored-clone and post-import protected fingerprints are identical.

## Stage P1 — read-only production candidate preflight

Implemented by:

```text
scripts/radar/prepare-radar-unified-release-production-0575-v01.ps1
```

It may only:

- verify the production-preflight tool head and accepted-lab ancestry;
- verify the evidence ZIP and locked Release hashes;
- verify the research repository head;
- read the source PostgreSQL state;
- require 35,615 Works and absence of both new projection tables;
- require the exact known `payload_migrations` starting state;
- compare current source counts and protected fingerprints with the accepted lab evidence;
- create a fresh custom-format PostgreSQL backup;
- re-read counts and fingerprints after the backup;
- emit an unprivileged candidate receipt under `data_local`.

It must report:

```text
SourceDatabaseWrite    : False
MigrationApplied       : False
PublicRecordsWritten   : 0
PublicRatingsWritten   : 0
ProductionAuthorization: False
```

A P1 candidate is not an authorization to apply.

## Stage P2 — write-capable apply-once gate

Not implemented yet.

It must be added only after a real P1 candidate and backup are inspected. It must include:

- exact merged `main` head binding;
- candidate and backup SHA binding;
- a database-resident apply-once marker acquired under an exclusive lock;
- failure-closed behavior: an interrupted marker blocks automatic retry;
- historical migration metadata reconciliation only after schema equivalence is re-proven;
- formal migrations against the source database;
- a nonce-bound loopback-only production marker;
- strict fresh-mode POST-only creation of 575 records and 575 ratings;
- zero update, PUT and DELETE requests;
- exact post-import convergence;
- exact row-count and protected-fingerprint verification;
- a production evidence bundle without database bytes or credentials;
- an explicit typed human confirmation immediately before the first database write.

## Expected successful production deltas

The apply-once marker adds one durable migration-control row beyond the isolated rehearsal:

```text
new projection tables           14
public fact records             575
public rating records           575
audit events added            1,150
authentication sessions added    1
formal migration rows added       7
development marker removed        1
apply-once marker added            1
payload_migrations net change     7
Works mutations                   0
human assessment mutations        0
legacy AI assessment mutations    0
old public conclusion mutations   0
research record mutations         0
```

## Failure and rollback boundary

No automatic retry is permitted after the apply-once marker is acquired.

Before a retry, an operator must independently decide between:

1. inspect and resume from an explicitly supported state; or
2. stop the application and restore the exact P1 backup through a separately reviewed destructive recovery command.

The backup file is never placed in an evidence ZIP, committed to Git or uploaded by the production tooling.

## Current authorization

```text
Read-only production preflight: allowed after review
Production migration:           false
Production import:              false
Production rollback:            false
```
