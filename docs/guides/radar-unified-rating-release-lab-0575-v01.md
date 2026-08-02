# Radar Public Release Isolated Lab v01

This stage rehearses the additive `radar-public-records` migration and the first 520-row unrated Public Release import against a disposable PostgreSQL clone. It does not authorize or perform a production migration or production import.

## Locked inputs

- website migration base: `af83019f37354098f884f531ea5fe91d05f50108` plus the current PR head supplied at execution time;
- research repository head: `6ee4051effa95e19370bb0a2f26500293177212a`;
- Public Release manifest source commit: `1555eb3e66cd2f8bb7d5048db1afab969ff819dd`;
- release: `RADAR-PUBLIC-RELEASE-0001`;
- rows: 520;
- records SHA-256: `ecb4440e7e102fd69c5a4ebf1f70970d832944f6a50af924cb9437b3c49dc3e0`;
- rated rows: 0.

The research head identifies the committed package. The manifest source commit identifies the canonical snapshot from which it was exported. They are intentionally different and are verified separately.

## Permanent entrypoints

- `scripts/radar/run-radar-public-release-lab-v01.ps1`
- `scripts/radar/prepare-radar-public-release-lab-database-v01.ps1`
- `scripts/radar/execute-radar-public-release-lab-v01.ps1`
- `scripts/radar/reconcile-radar-public-dev-schema-v01.mjs`
- `scripts/radar/run-public-release-lab-import-v01.mjs`
- `src/app/(payload)/api/radar-public-release-lab-marker/route.ts`
- `tests/radar-public-release-lab-v01.test.mjs`

The one-command runner is the canonical operator entrypoint. The preparer may read the source container but cannot migrate or import. The executor and reconciler may change only the disposable clone and have no source-container parameters or source-database commands.

## Source-container behavior

The runner:

1. reuses `baihepailei-postgres` when already running;
2. starts that exact container when it exists but is stopped;
3. invokes `docker compose up -d postgres` only when no exact-name source container exists;
4. never removes or recreates the source container.

It securely preflights the existing Payload administrator credentials before cloning, keeps the password only in process memory, and normalizes the generated environment timestamp using `DateTimeOffset` so the four-hour freshness gate remains stable across PowerShell versions.

Fallback cleanup is limited to the exact current-run disposable container, the current-run dump under `data_local/backups/radar-public-release-lab-v01`, and the current-run credentials-bearing environment file. The source PostgreSQL container and `.env` are never cleanup targets.

## Phase 1: clone only

The preparer:

1. locks website and research commits;
2. validates the manifest and 520-row count;
3. requires exactly 35,615 Works and no source `radar_public_records` table;
4. records public-table counts and protected fingerprints;
5. creates a fresh custom-format read-only `pg_dump`;
6. restores it into a random disposable PostgreSQL container bound to `127.0.0.1:31000-31999`;
7. requires clone counts and fingerprints to match;
8. reruns source checks and requires the source to remain unchanged;
9. writes a short-lived local environment file.

It performs no migration or import.

## Historical schema reconciliation

The restored clone contains an old `radar_public*` schema created by a development push while `payload_migrations` has one `dev / -1` marker instead of the two accepted July Radar rows.

The reconciler:

1. requires that exact migration and table boundary;
2. creates a second disposable reference database from the clone;
3. removes the old Radar schema only in the reference;
4. executes the locked historical migrations only in the reference;
5. compares byte-exact normalized signatures for relations, columns, defaults, enums, constraints, indexes, sequences, triggers, policies and grants;
6. only after equality, replaces one development marker with the two equivalent historical registrations in the main disposable clone;
7. destroys the reference in every path.

No historical migration is weakened with `IF NOT EXISTS`.

## Phase 2: disposable clone only

The executor:

1. accepts only a fresh generated lab environment, fixed container/database identity and loopback port;
2. verifies website, research and release-source identities again;
3. runs historical reconciliation only inside the disposable container;
4. applies the accepted August migration only to the clone;
5. starts Payload on loopback port 32000-39999 with a nonce-bound marker;
6. requires 520 initial `ready_create` and zero blockers, updates or current rows;
7. creates records sequentially through the authenticated Payload API;
8. replans and requires 520 `already_current`;
9. requires four new `radar_public_records*` tables, four formal migration additions, one development marker removal, net migration +3 and 520 audit events;
10. requires all other counts and protected fingerprints unchanged;
11. removes the temporary app, database, dump and credentials file;
12. creates a checksum-bound evidence ZIP without database bytes or credentials.

## REST payload compatibility

The migration stores `work_id` as an integer foreign key and fact values as `jsonb`.

The importer therefore:

- sends the exact matched Works primary key as a positive safe integer;
- blocks malformed relationship IDs before any write;
- preserves fact values exactly, including strings, objects, arrays, booleans and numbers;
- applies explicit JSON-safe validation so primitive values are not wrapped or rewritten;
- keeps source record and release hashes unchanged.

It still rejects remote hosts, HTTPS, port 3000, out-of-range ports, missing confirmation, marker or identity mismatches, blockers, PUT and DELETE.

## Validated runtime baseline

REST compatibility code head:

`c946507e2a57cfc2e37a7dd91418c6b32def01db`

Accepted automated runs:

- Plan `30705978662`: success;
- Migration `30705978661`: success;
- Lab `30705978659`: success.

The latest real local run completed clone verification, historical reconciliation, formal migration and isolated startup. It stopped on the first create because the relationship ID was text and primitive facts used default JSON validation. No source write occurred and bounded cleanup completed. The branch now contains type-preserving fixes and regressions for both inputs.

Documentation-only commits may advance the PR head without changing this runtime baseline. Execution must always supply the current exact PR head from `git rev-parse HEAD`.

## Local execution

Keep the normal `pnpm dev` process stopped.

```powershell
Set-Location "D:\0GitHubtest\Baihepailei"
git switch "agent/radar-public-release-lab-v01"
git pull --ff-only origin "agent/radar-public-release-lab-v01"

pwsh `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File ".\scripts\radar\run-radar-public-release-lab-v01.ps1" `
  -ExpectedWebsiteHead "<CURRENT_PR_HEAD_SHA>" `
  -Confirm "RUN-ISOLATED-RADAR-PUBLIC-RELEASE-LAB-V01"
```

Expected receipt:

```text
SourceDatabaseWrite      : False
MigrationTarget          : IsolatedTemporaryContainer
PublicRecordsCreated     : 520
PostImportAlreadyCurrent : 520
WorksMutation            : False
HumanAssessmentMutation  : False
RadarAssessmentMutation  : False
ProductionAuthorization  : False
```

A failed lab must restart from Phase 1 and never resume a partially imported clone.

A successful lab still does not authorize production. Production requires a separately reviewed candidate with fresh backup, exact preflight, apply-once locking, post-apply verification, rollback instructions and explicit human authorization.
