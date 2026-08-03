# Radar Public Metrics source schema apply-once v01

## Status

This package develops the **source PostgreSQL schema migration executor only**.

It does **not** authorize or implement the 10,563-row Public Metrics import.

Locked identities:

- merged PR #335 baseline: `b74ca37648688cb8f475acdbf304186ac36753ff`
- historical preflight candidate base: `b5ffbe006913218d32b96c131074b7740bf827a0`
- historical preflight tool head: `978a893e6f72bea8bb292c5dff99dfefb957e22e`
- research head: `c2fe7847ee8b60b439f8e92025437937ceff06d5`
- Release: `RADAR-PUBLIC-METRICS-10563-0001`
- migration: `20260803_102741_radar_public_metrics_v01`
- Candidate SHA-256: `825294f1a7562dfb2a94ca9d37f7efd79a9300d1af17ae6598db3f3ac02f7d13`
- independent-review ZIP SHA-256: `35d14fb183a0e8ae34525ad6234a3a0e03ba42f28e6091598eef1ddf369694d0`
- preflight Backup SHA-256: `d1721811438194b4783d0d05dbb9681d5ed8c2cc052145f09fb0747fcc4abe2f`
- preflight Backup bytes: `37,207,203`

The candidate was generated before PR #335 was merged. Its historical `toolHead`
is therefore intentionally different from the final merged `main`. The
executor locks both identities and separately verifies the SHA-256 of the
migration, migration snapshot, migration index, and collection schema.

## Safety contract

The executor is default-deny:

- default mode is `DryRun`;
- the repository must be clean;
- the current commit must descend from the exact merged PR #335 baseline;
- only this package's five files may differ from that baseline;
- Candidate, independent-review ZIP, preflight Backup, Research Release, and
  critical source files must match exact SHA-256 values;
- the source PostgreSQL container ID, image, database, user, row counts,
  existing-column order, migration ledger, and existing-data fingerprints must
  match the reviewed candidate;
- one or two Docker Desktop IPv4/IPv6 port bindings are accepted only when all
  addresses are from the reviewed allowlist, every binding resolves to one
  unique host port, and an IPv4 binding remains reachable through `127.0.0.1`;
- a two-key PostgreSQL advisory lock is held throughout source inspection and
  any source migration;
- the lock session uses a server-safe `application_name` of at most 63 ASCII
  bytes, captures its PostgreSQL backend PID, verifies the exact two-key lock
  row (`objsubid = 2`), and releases that exact PID during cleanup;
- the target migration, its eight columns, enum, and four indexes must all be
  absent before execution;
- `pnpm exec payload migrate` appears in one shared function and can run only
  after the exact nine-row ledger is verified;
- a disposable loopback PostgreSQL clone is restored and migrated before any
  production execution;
- execution requires a newly created authorization JSON bound to the exact
  merged `main`;
- execution also requires a long confirmation string and a maintenance-window
  confirmation;
- a new apply-time PostgreSQL backup is created immediately before execution;
- post-verification requires `36 -> 44` columns and `9 -> 10` migrations;
- Works, Public Records, and all existing Public Ratings fields must retain
  their exact fingerprints;
- all seven nullable metric fields must remain `NULL`, while
  `requires_metric_review` must remain `false` for all 10,563 current rows;
- a prior successful execution receipt or an already-applied migration causes a
  hard failure;
- **Never rerun**.

There is no metrics import implementation in this package. There is no
`INSERT`, content `UPDATE`, content `DELETE`, Payload create/update/delete, or
historical apply-once integration.

## Files

- executor:
  `scripts/radar/run-radar-public-metrics-source-schema-apply-once-v01.ps1`
- tests:
  `tests/radar-public-metrics-source-schema-apply-once.test.mjs`
- CI:
  `.github/workflows/validate-radar-public-metrics-source-schema-apply-once-v01.yml`
- rollback:
  `docs/guides/radar-public-metrics-source-schema-rollback-v01.md`

## Development validation

From:

```text
D:\0GitHubtest\Baihepailei
```

run:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-StrictMode -Version Latest

    node --test `
      .\tests\radar-public-metrics-source-schema-apply-once.test.mjs

    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
      (Resolve-Path `
        '.\scripts\radar\run-radar-public-metrics-source-schema-apply-once-v01.ps1'),
      [ref]$null,
      [ref]$errors
    ) | Out-Null

    if ($errors.Count -gt 0) {
        $errors | ForEach-Object { Write-Error $_.Message }
        throw 'PowerShell parse failed'
    }

    git diff --check
}
```

## DryRun

DryRun performs all binding checks, reads the source database in read-only mode,
acquires the advisory lock, restores the exact reviewed Backup into a
disposable loopback PostgreSQL container, executes the migration there, verifies
the complete post-state, then proves the source database remained unchanged.

It does **not** migrate the source database.

After committing the five package files on the engineering branch, run:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-StrictMode -Version Latest

    Set-Location 'D:\0GitHubtest\Baihepailei'

    $ToolHead = (git rev-parse HEAD).Trim()

    pwsh `
      -NoProfile `
      -ExecutionPolicy Bypass `
      -File `
        '.\scripts\radar\run-radar-public-metrics-source-schema-apply-once-v01.ps1' `
      -Mode DryRun `
      -ExpectedToolHead $ToolHead `
      -CandidatePath `
        '.\data_local\outputs\radar-public-metrics-production-preflight-v01\preflight-20260803-212558\production-preflight-candidate.json' `
      -IndependentReviewZipPath `
        '.\data_local\review-packages\radar-public-metrics-production-preflight-v01\preflight-20260803-212558-independent-review-v01.zip' `
      -BackupPath `
        '.\data_local\backups\radar-public-metrics-production-preflight-v01\source-before-radar-public-metrics-20260803-212558.dump' `
      -Confirm `
        'DRY-RUN-RADAR-PUBLIC-METRICS-SOURCE-SCHEMA-APPLY-ONCE-V01'
}
```

Expected DryRun boundaries:

```text
Source migration : false
Metric import    : false
Authorization    : false
```

The generated receipt is under:

```text
data_local\outputs\radar-public-metrics-source-schema-apply-once-v01\
```

DryRun completion is required before opening or merging the PR.

## PR and merge gate

The PR must contain only the five package files listed above.

Before merge:

1. PowerShell parsing passes.
2. the dedicated Node test passes;
3. CI passes;
4. the disposable-database DryRun passes;
5. the DryRun receipt is independently reviewed;
6. there are no unresolved review threads;
7. no source migration has occurred;
8. no metrics import has occurred.

Merging the PR still does not authorize execution.

## New production authorization

After the PR is merged, resolve the exact new `main` SHA. A separate local,
untracked authorization file must then be created only after an explicit human
decision.

Example shape:

```json
{
  "schemaVersion": "radar-public-metrics-source-schema-authorization-v01",
  "productionAuthorization": true,
  "scope": "source-schema-migration-only",
  "authorizedMainHead": "<EXACT_MERGED_MAIN_SHA>",
  "releaseId": "RADAR-PUBLIC-METRICS-10563-0001",
  "candidateSha256": "825294f1a7562dfb2a94ca9d37f7efd79a9300d1af17ae6598db3f3ac02f7d13",
  "independentReviewSha256": "35d14fb183a0e8ae34525ad6234a3a0e03ba42f28e6091598eef1ddf369694d0",
  "backupSha256": "d1721811438194b4783d0d05dbb9681d5ed8c2cc052145f09fb0747fcc4abe2f",
  "migrationName": "20260803_102741_radar_public_metrics_v01",
  "metricImportAuthorized": false,
  "historicalApplyOnceRerun": false,
  "approvedAt": "<UTC ISO-8601>",
  "approvalStatement": "AUTHORIZE SOURCE SCHEMA MIGRATION ONLY; DO NOT IMPORT RADAR PUBLIC METRICS; NEVER RERUN"
}
```

Do not commit this file. Keep it under `data_local`.

## Execute

Execution is intentionally not ready merely because this code exists or the PR
is merged. It requires the later authorization described above.

The exact confirmation string is:

```text
EXECUTE-ONCE-RADAR-PUBLIC-METRICS-SOURCE-SCHEMA-V01::<EXACT_MERGED_MAIN_SHA>::RADAR-PUBLIC-METRICS-10563-0001::825294f1a7562dfb2a94ca9d37f7efd79a9300d1af17ae6598db3f3ac02f7d13::d1721811438194b4783d0d05dbb9681d5ed8c2cc052145f09fb0747fcc4abe2f::20260803_102741_radar_public_metrics_v01::NO-METRIC-IMPORT
```

The maintenance confirmation is:

```text
SOURCE-WRITES-PAUSED-FOR-RADAR-PUBLIC-METRICS-SCHEMA-V01
```

The Execute command is deliberately omitted from the development PR workflow.
It should be assembled only after the exact merged `main`, authorization file,
maintenance state, DryRun evidence, and rollback readiness are reviewed again.

## Expected successful source transition

```text
Works:                  35,615 -> 35,615
Public Records:         10,563 -> 10,563
Public Ratings:         10,563 -> 10,563
Public Rating columns:  36 -> 44
Payload migrations:     9 -> 10
Existing fingerprints:  unchanged
Metric content rows:    0
Metric import:           false
```

## Rollback

Do not run the migration's `down()` function as an improvised rollback.

Use the separately documented restore procedure:

```text
docs/guides/radar-public-metrics-source-schema-rollback-v01.md
```

The apply-time backup path and SHA-256 are written into the execution receipt.
