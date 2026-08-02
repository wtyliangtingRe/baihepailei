# Radar Unified Release 0575 production gate v01

## Locked release

```text
release             RADAR-UNIFIED-RATING-RELEASE-0575-0001
accepted lab head   069e2d54055c8c8099ac8f37092e2bdb2b3e060c
merged lab main     6cdc29e28236f487a6e762a5c8871c681a870810
research head       728ad2da5f7d3aba03f652b9fd701157b06793ee
evidence SHA-256    59dc908a447500adb39ef9f72bde306268fdf24ec85fdaaeb418dee0fb9be09f
candidate SHA-256   0b18c33987abe2c2eb0c2280acee789415396903d697aface2523312a334de31
P1 backup SHA-256   ea0b1cb68c9f1fde91e5e9f10c12957469b30c37a29097c57cb18fa8b5b13751
```

The isolated rehearsal and P1 read-only candidate are independently accepted. Neither acceptance authorizes a source-database write.

## P1 — read-only candidate

Canonical command:

```text
scripts/radar/prepare-radar-unified-release-production-0575-v01.ps1
```

P1 verifies the locked evidence and Release, reads the exact source state, creates the local custom-format backup, proves backup-before/after source equality, and emits the unprivileged candidate.

```text
SourceDatabaseWrite      false
MigrationApplied         false
PublicRecordsWritten     0
PublicRatingsWritten     0
ProductionAuthorization  false
```

## P2 — merged-main authorization

Canonical authorizer:

```text
scripts/radar/authorize-radar-unified-release-production-0575-v02.ps1
```

It runs only after PR #330 is merged and only when local `main`, `origin/main`, and the supplied full SHA are identical. It rechecks:

- candidate, evidence, Release and P1 backup hashes;
- current source counts, protected fingerprints and migration rows;
- absence of both projection families and the apply-control table;
- a content-hash manifest covering every production-critical script, test, workflow, route and guide.

It writes a local authorization receipt under `data_local`. The receipt is still non-writing and reports:

```text
ReadyForExplicitApply    true
SourceDatabaseWrite      false
ProductionAuthorization  false
```

## P2 — apply-once executor

Canonical executor:

```text
scripts/radar/execute-radar-unified-release-production-0575-v01.ps1
```

Before the first source write it:

1. requires exact merged `main` and the authorization code manifest;
2. stops application writer containers while leaving PostgreSQL running;
3. verifies the exact source state;
4. creates a fresh same-window local backup;
5. restores that backup into a disposable PostgreSQL container;
6. reproduces the accepted legacy-schema signature;
7. creates the apply marker in the disposable database;
8. reconciles historical migration metadata and runs formal migrations;
9. runs exact `575 + 575` plan, apply and verify through a nonce-bound loopback Payload process;
10. verifies all row counts and protected fingerprints;
11. destroys the disposable database;
12. proves the source state is still unchanged;
13. asks for the complete Release-and-main confirmation string.

Only after the interactive confirmation does it create the source apply marker and continue.

## Write surface

The production importer permits:

```text
GET   collection reads
POST  Payload login
POST  radar-public-records create
POST  radar-public-ratings create
```

It contains no update path and rejects PATCH, PUT, DELETE, incremental mode, remote URLs and non-loopback ports.

Expected importer result:

```text
record creates                  575
rating creates                  575
record updates                    0
rating updates                    0
post records already_current    575
post ratings already_current    575
blockers                          0
```

## Apply-once control

The first write is one transaction that:

- acquires `pg_try_advisory_xact_lock` for the fixed Release ID;
- requires the apply-control table to be absent;
- creates `public.radar_unified_release_apply_control`;
- inserts one `started` row bound to main, candidate, evidence, code manifest, P1 backup and fresh backup hashes.

The durable row then owns concurrency protection.

```text
started    automatic retry forbidden
failed     automatic retry forbidden
completed  second apply forbidden
```

A failed production run attempts only to mark the row `failed`. It does not automatically retry or restore.

## Expected successful database deltas

```text
new projection tables                     14
new apply-control tables                    1
public records                            575
public ratings                            575
audit events added                      1,150
authentication sessions added              1
formal migration rows added                 7
development marker removed                  1
payload_migrations net change               6
apply-control rows                           1
Works mutations                              0
human assessment mutations                  0
legacy AI assessment mutations              0
old public conclusion mutations             0
research record mutations                    0
```

## Evidence and backup boundary

The production evidence ZIP contains receipts, plans, logs, counts, fingerprints, manifests and hashes. It excludes:

- database dump bytes;
- PostgreSQL URLs;
- passwords;
- JWTs;
- private keys.

The P1 backup and same-window fresh backup remain local under `data_local/backups`.

## Failure and rollback

No automatic rollback is permitted after the durable source marker is created.

On a post-marker failure:

- application writer containers remain paused;
- the stage receipt and fresh backup remain local;
- normal rerun is blocked;
- an operator must independently review the exact failed stage;
- restore requires a separate reviewed destructive recovery command.

Do not manually delete the apply-control table or marker to force a retry.

## Current authorization

```text
P1 read-only preflight        complete
P1 independent audit         accepted
P2 implementation            committed to Draft PR #330
P2 CI and code review         required
Production migration         false
Production import            false
Production rollback          false
```

PR #330 must remain Draft until CI, static review and a real local disposable rehearsal of the merged candidate are accepted.
