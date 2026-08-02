# Radar Unified Rating Release 0575 Isolated Lab v01

## Purpose

This lab rehearses the accepted private research release against a disposable PostgreSQL clone:

```text
RADAR-UNIFIED-RATING-RELEASE-0575-0001
```

It creates two separate public projections:

- 575 `radar-public-records` fact/evidence records;
- 575 `radar-public-ratings` machine-rating records.

It does not authorize or perform a production migration or production import.

## Locked inputs

- research repository: `wtyliangtingRe/baihepailei-research-data`;
- research commit: `728ad2da5f7d3aba03f652b9fd701157b06793ee`;
- records: 575;
- ratings: 575;
- facts: 2,387;
- evidence: 678;
- grades: B 476 / D 97 / E 2;
- all human review states: blank, `unreviewed`, non-blocking.

The website lock file pins the manifest, records, ratings and release-index SHA-256 values. Phase 1 refuses any byte drift.

## Why this is a fresh-state rehearsal

The real source database has never received the old 520-row Public Records release. It has neither `radar_public_records` nor `radar_public_ratings`.

The actual isolated rehearsal therefore expects:

```text
fact creates     575
rating creates   575
fact updates       0
rating updates     0
```

The separate offline planner still proves the hypothetical old-520 transition:

```text
fact updates     520
fact creates      55
rating creates   575
```

That is a future compatibility test, not the current database starting state.

## One-command entrypoint

Run from PowerShell 7 with the normal development server stopped:

```powershell
Set-Location "D:\0GitHubtest\Baihepailei"

git fetch origin
git switch "agent/radar-unified-release-lab-0575-v01"
git pull --ff-only origin "agent/radar-unified-release-lab-0575-v01"

$Head = (git rev-parse HEAD).Trim()

pwsh `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File ".\scripts\radar\run-radar-unified-release-lab-0575-v01.ps1" `
  -ExpectedWebsiteHead $Head `
  -Confirm "RUN-ISOLATED-RADAR-UNIFIED-RELEASE-LAB-0575-V01"
```

The wrapper preserves local generated changes to `next-env.d.ts` and `payload-types.ts` and rejects every other unexpected dirty path.

## Phase 1: source-readonly clone

The preparer:

1. locks the exact website and research commits;
2. verifies all four Release hashes;
3. requires 35,615 Works;
4. requires both public projection tables to be absent in the source;
5. fingerprints Works, versions and all old Radar tracks;
6. creates a fresh custom-format dump;
7. restores it into a random loopback-only PostgreSQL container;
8. requires restored counts and fingerprints to equal the source;
9. rereads the source and requires it to remain byte-equivalent;
10. writes a short-lived local environment file containing only disposable credentials.

It performs no migration and no import.

## Historical schema reconciliation

The source database contains the old public Radar schema created by development schema push, represented by one `dev / -1` migration marker.

The reconciler operates only inside the disposable clone:

1. creates a second disposable reference database;
2. removes the old Radar schema only in the reference;
3. runs the accepted formal migration in the reference;
4. compares normalized `pg_dump --schema-only` output for the complete old Radar table family;
5. requires exact equality;
6. replaces the clone's one development marker with the two equivalent July migration registrations;
7. leaves the Records and Ratings migrations unapplied;
8. destroys the reference database in every path.

The source container is not an accepted parameter and cannot be accessed by the reconciler.

## Phase 2: disposable migration and import

The executor:

1. applies the two Public Records migration entries and one Public Ratings migration only to the disposable clone;
2. requires all seven formal migration names;
3. starts Next/Payload on a random loopback port with a nonce-bound marker;
4. authenticates using an existing administrator account whose password remains in process memory;
5. validates the unified Release again;
6. creates facts and ratings sequentially through the two dedicated Payload collections;
7. performs no Works API write, PUT or DELETE;
8. rereads both collections;
9. requires 575 fact plans and 575 rating plans to be `already_current`;
10. checks every new main/child table count;
11. requires old protected fingerprints to remain unchanged;
12. destroys the app and disposable database;
13. deletes the temporary dump and environment file;
14. writes a checksum-bound evidence ZIP without database bytes or credentials.

## Exact expected deltas

```text
new projection tables           14
public fact records             575
public rating records           575
audit events added            1,150
authentication sessions added    1
formal migration rows added       5
development markers removed       1
payload_migrations net change     4
Works mutations                   0
human assessment mutations        0
legacy AI assessment mutations    0
old public conclusion mutations   0
source database writes             0
```

All nine Public Ratings child arrays and all three Public Records child-table totals are taken from the validated Release plan and checked against PostgreSQL after import.

## Failure behavior

A failed run is never resumed. The next run starts from a new source dump and a new random container.

Cleanup is restricted to:

- the current-run container name;
- the current-run dump under `data_local/backups/radar-unified-release-lab-0575-v01`;
- the current-run environment file.

The source container, source database, `.env` files and normal site data are never cleanup targets.

## Acceptance is not production authorization

A successful receipt still records:

```text
SourceDatabaseWrite     : False
ProductionAuthorization : False
```

Production requires a separate candidate with a fresh backup, exact read-only preflight, apply-once lock, post-apply readback, rollback package and explicit authorization.
