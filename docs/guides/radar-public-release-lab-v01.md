# Radar Public Release Isolated Lab v01

This stage rehearses the additive `radar-public-records` migration and the first 520-row unrated Public Release import against a disposable PostgreSQL clone. It does not authorize or perform a production migration or production import.

## Locked inputs

The first rehearsal is bound to three independent identities:

- website migration base: `af83019f37354098f884f531ea5fe91d05f50108` plus the final head of the lab PR;
- research repository head: `6ee4051effa95e19370bb0a2f26500293177212a`;
- Public Release manifest source commit: `1555eb3e66cd2f8bb7d5048db1afab969ff819dd`.

The research repository head identifies the committed release package. The manifest source commit identifies the canonical research snapshot from which the release was exported. They are intentionally different and are verified separately.

The package must remain:

- release: `RADAR-PUBLIC-RELEASE-0001`;
- rows: 520;
- records SHA-256: `ecb4440e7e102fd69c5a4ebf1f70970d832944f6a50af924cb9437b3c49dc3e0`;
- rated rows: 0.

## Permanent entrypoints

- `scripts/radar/run-radar-public-release-lab-v01.ps1`
- `scripts/radar/prepare-radar-public-release-lab-database-v01.ps1`
- `scripts/radar/execute-radar-public-release-lab-v01.ps1`
- `scripts/radar/reconcile-radar-public-dev-schema-v01.mjs`
- `scripts/radar/run-public-release-lab-import-v01.mjs`
- `src/app/(payload)/api/radar-public-release-lab-marker/route.ts`
- `tests/radar-public-release-lab-v01.test.mjs`

The one-command runner is the canonical operator entrypoint. The lower-level stages remain deliberately separate: the database preparer may read the source container but cannot migrate or import, while the executor and reconciler may change only the disposable clone and have no source-container parameters or source-database commands.

## One-command source-container behavior

The runner:

1. reuses `baihepailei-postgres` when it is already running;
2. starts that exact container when it exists but is stopped;
3. invokes `docker compose up -d postgres` only when no exact-name source container exists;
4. never removes or recreates the source container.

It also normalizes the generated environment timestamp before Phase 2. PowerShell 7.5 and later may deserialize an ISO JSON timestamp into a `DateTime`; converting that object through a culture-specific string can apply the local timezone offset twice. The runner parses the original ISO value as `DateTimeOffset`, preserves the four-hour freshness boundary, rejects future timestamps, and rewrites only `createdAt` as an RFC 1123 UTC string that remains a JSON string across PowerShell versions.

If Phase 2 fails before the executor reaches its own cleanup block, the runner performs an idempotent fallback cleanup limited to:

- the exact current-run container name matching `baihepailei-radar-public-release-lab-YYYYMMDD-HHMMSS`;
- the current-run dump only when its resolved path is under `data_local/backups/radar-public-release-lab-v01`;
- the current-run credentials-bearing environment file.

The source PostgreSQL container and `.env` are never cleanup targets.

## Safety model

### Phase 1: clone only

The preparer:

1. locks the website and research commits;
2. validates the release manifest and 520-row count;
3. requires the source database to have exactly 35,615 Works and no `radar_public_records` table;
4. records all public-table row counts;
5. records content fingerprints for Works, `_works_v`, the existing `radar_public*` track, and `radar_research_records*`;
6. creates a fresh custom-format `pg_dump` using read-only PostgreSQL operations;
7. restores it into a randomly named PostgreSQL container bound only to `127.0.0.1:31000-31999`;
8. requires the restored clone to match the source row counts and protected fingerprints;
9. reruns source row counts and fingerprints and requires the source to remain unchanged;
10. writes a short-lived local environment file under `data_local`.

It does not run `payload migrate`, start the website, call the Public Release importer, or write any database rows.

### Historical schema reconciliation

The restored clone contains an old `radar_public*` schema created by an earlier development push while `payload_migrations` contains a single `dev / -1` marker instead of the two accepted July Radar migration rows.

The reconciler:

1. requires that exact known migration state and table boundary;
2. creates a second disposable reference database from the restored clone;
3. removes the old Radar schema only from the reference database;
4. executes the locked historical migrations only in the reference database;
5. compares exact normalized signatures for relations, columns, defaults, enums, constraints, indexes, sequences, triggers, policies and grants;
6. only after byte-exact equality, removes one `dev / -1` marker and registers the two equivalent historical migrations in the main disposable clone;
7. destroys the reference database in all paths.

The historical migration is not weakened with `IF NOT EXISTS`, and any structural difference blocks the rehearsal.

### Phase 2: disposable clone only

The executor:

1. accepts only a lab environment less than four hours old;
2. accepts only the generated container prefix, database name, loopback connection and port range;
3. verifies the website head, research head and manifest source commit again;
4. reconciles the historical development-push schema only inside the disposable container;
5. applies the two accepted August migration entries only to the disposable clone;
6. starts Next/Payload on a random loopback port from 32000 through 39999;
7. requires a nonce-protected marker that reports the expected temporary database and all three commit identities;
8. requires the initial planner result to be 520 `ready_create`, zero updates, zero current rows and zero blockers;
9. creates records sequentially through the authenticated Payload API;
10. re-reads all records and requires 520 `already_current`;
11. requires exactly four new `radar_public_records*` tables;
12. requires four formal migration rows added, one development marker removed, a net migration increase of three and 520 audit events;
13. requires every other pre-existing table row count to remain unchanged;
14. requires protected Works and old Radar table fingerprints to remain unchanged;
15. destroys the temporary website process and PostgreSQL container;
16. deletes the temporary database credentials file and local database dump;
17. produces a checksum-bound evidence ZIP that excludes the database dump and credentials.

## REST payload compatibility

The migration stores `radar_public_records.work_id` as an integer foreign key and fact values as `jsonb`.

The importer therefore:

- sends the exact matched Works primary key as a positive safe integer;
- rejects malformed or unsafe relationship IDs before any write request;
- preserves source fact values exactly, including strings, objects, arrays, booleans and numbers;
- uses an explicit JSON-safe field validator so primitive fact values are accepted without wrapping or rewriting;
- keeps source record hashes and release hashes unchanged.

The write-capable Node importer still rejects:

- non-loopback hosts;
- HTTPS or remote URLs;
- port 3000;
- ports outside 31000-39999;
- a missing or incorrect confirmation string;
- a missing nonce-protected lab marker;
- commit or database mismatches;
- blockers in either mode;
- PUT or DELETE behavior.

The first release uses strict `initial` mode. Later releases may use guarded `incremental` mode as documented in `radar-public-release-incremental-upsert-v01.md`.

## Current validation head

The current rehearsal candidate is:

`c946507e2a57cfc2e37a7dd91418c6b32def01db`

Automated validation:

- Public Records Plan run `30705978662`: success;
- Public Records Migration run `30705978661`: success;
- Public Release Lab run `30705978659`: success.

The latest real local run successfully completed fresh clone verification, historical schema reconciliation, the formal migration and isolated application startup. It stopped on the first API create because the relationship ID was serialized as text and primitive JSON facts used Payload's default object-oriented validation. No source write occurred, and bounded cleanup removed the disposable database, dump and environment file. The current candidate contains the type-preserving fixes and regressions for both inputs.

## Local execution

Keep the normal `pnpm dev` process stopped before running the lab.

```powershell
Set-Location "D:\0GitHubtest\Baihepailei"

git switch "agent/radar-public-release-lab-v01"
git pull --ff-only origin "agent/radar-public-release-lab-v01"

pwsh `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File ".\scripts\radar\run-radar-public-release-lab-v01.ps1" `
  -ExpectedWebsiteHead "c946507e2a57cfc2e37a7dd91418c6b32def01db" `
  -Confirm "RUN-ISOLATED-RADAR-PUBLIC-RELEASE-LAB-V01"
```

Expected terminal receipt:

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

The evidence archive is written under `exports/RADAR-PUBLIC-RELEASE-LAB-<timestamp>.zip` with a printed SHA-256.

## Failure behavior

Phase 1 removes the disposable container, local dump and temporary environment file if clone preparation fails.

Phase 2 always attempts to stop the isolated website, remove the disposable database container, delete the database dump and delete the credentials-bearing environment file. The one-command runner adds the same bounded cleanup when validation fails before the executor enters its normal cleanup scope. Non-secret logs under `data_local` are retained for diagnosis.

A failed lab must be restarted from Phase 1. It must never be resumed against a partially imported clone.

## Acceptance boundary

A successful lab proves that the accepted additive migration and the 520-row release can be applied together without changing Works, human assessments, AI assessment fields, the old public conclusion track or research records.

It still does not authorize production. The next stage must independently prepare a one-shot production candidate with a fresh backup, exact production preflight, apply-once lock, post-apply 520 `already_current` verification, rollback instructions and an explicit human execution gate.
