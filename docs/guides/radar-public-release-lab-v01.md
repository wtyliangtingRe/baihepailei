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
- `scripts/radar/run-public-release-lab-import-v01.mjs`
- `src/app/(payload)/api/radar-public-release-lab-marker/route.ts`
- `tests/radar-public-release-lab-v01.test.mjs`

The one-command runner is the normal operator entrypoint. It safely reuses an already running `baihepailei-postgres` container, starts that exact container if it exists but is stopped, and calls Docker Compose only when the named container does not exist. It never removes or recreates an existing source container.

The two internal PowerShell stages remain deliberately separate. The database preparer may read the source container but cannot migrate or import. The executor may migrate and import the disposable clone but has no source-container parameters or source-database commands.

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

### Phase 2: disposable clone only

The executor:

1. accepts only a lab environment less than four hours old;
2. accepts only the generated container prefix, database name, loopback connection and port range;
3. verifies the website head, research head and manifest source commit again;
4. applies the two accepted migration entries only to the disposable clone;
5. starts Next/Payload on a random loopback port from 32000 through 39999;
6. requires a nonce-protected marker that reports the expected temporary database and all three commit identities;
7. runs the importer in strict `initial` mode and requires 520 `ready_create`, zero updates, zero current rows and zero blockers;
8. creates records sequentially through the authenticated Payload API;
9. re-reads all records and requires 520 `already_current`;
10. requires exactly four new `radar_public_records*` tables;
11. requires exactly two new migration rows and 520 audit events;
12. requires every other pre-existing table row count to remain unchanged;
13. requires protected Works and old Radar table fingerprints to remain unchanged;
14. destroys the temporary website process and PostgreSQL container;
15. deletes the temporary database credentials file and local database dump;
16. produces a checksum-bound evidence ZIP that excludes the database dump and credentials.

The write-capable Node importer rejects:

- non-loopback hosts;
- HTTPS or remote URLs;
- port 3000;
- ports outside 31000-39999;
- a missing or incorrect confirmation string;
- a missing nonce-protected lab marker;
- commit or database mismatches;
- identity, duplicate or schema blockers;
- `PUT`, `DELETE`, rollback or withdrawal behavior.

The importer also contains a guarded `incremental` mode for later releases. That mode permits only exact-identity `ready_create`, `ready_update` and `already_current` rows, performs POST/PATCH/skip respectively, and requires the whole package to converge to `already_current`. PR #325 still invokes strict initial mode. See `docs/guides/radar-public-release-incremental-upsert-v01.md`.

## Local execution

Keep the normal `pnpm dev` process stopped before running the lab.

Use the final PR head in this single command:

```powershell
Set-Location "D:\0GitHubtest\Baihepailei"

pwsh `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File ".\scripts\radar\run-radar-public-release-lab-v01.ps1" `
  -ExpectedWebsiteHead "<FINAL_PR_HEAD_SHA>" `
  -Confirm "RUN-ISOLATED-RADAR-PUBLIC-RELEASE-LAB-V01"
```

The runner handles branch synchronization, source-container reuse/start/create, clone preparation, environment-file selection and isolated execution. Do not precede it with an unconditional `docker compose up -d postgres`, because an existing container with the canonical name may belong to an older Compose project while still being the correct source database.

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

Phase 2 always attempts to stop the isolated website, remove the disposable database container, delete the database dump and delete the credentials-bearing environment file. Non-secret logs under `data_local` are retained for diagnosis.

A failed lab must be restarted from Phase 1. It must never be resumed against a partially imported clone.

The canonical source container is never deleted by the runner or either phase.

## Acceptance boundary

A successful lab proves that the accepted additive migration and the 520-row release can be applied together without changing Works, human assessments, AI assessment fields, the old public conclusion track or research records.

It still does not authorize production. The next stage must independently prepare a one-shot production candidate with a fresh backup, exact production preflight, apply-once lock, post-apply 520 `already_current` verification, rollback instructions and an explicit human execution gate.

After initial launch, recurring releases use the separate incremental upsert policy: immutable release package, read-only plan, disposable cloned-database rehearsal, exact create/update/current partition, zero blockers, full post-apply convergence, then a separately armed production candidate.
