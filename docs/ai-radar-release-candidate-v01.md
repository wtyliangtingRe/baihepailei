# AI radar release candidate v0.1

This stage freezes the final read-only evidence needed before any Payload write is considered.

It does not arm the release gate, store an approval token, or send PATCH requests.

## Bound evidence

A release candidate is accepted only when all of the following refer to the same final branch, commit, plan and checkpoint:

1. the 100-row honest Payload plan and its SHA-256;
2. the 94-update / 6-protected dry-run summary and its SHA-256;
3. the final 94/94 apply-readiness summary and its SHA-256;
4. the zero-blocker honest source-provenance audit and its SHA-256;
5. a fresh complete checkpoint for the current branch and commit;
6. the PostgreSQL dump SHA-256 recorded in the checkpoint checksum table;
7. a successful `pg_restore --list` verification of that exact dump.

Generated release-candidate files live under `data_local`, which is ignored by Git. No database dump, local gate, manifest or approval material is committed.

## Local workflow

Switch to the release-candidate branch:

```powershell
cd "D:\0GitHubtest\Baihepailei"

git fetch origin
git switch -c wm-ai-radar-release-candidate-v01 `
  --track origin/wm-ai-radar-release-candidate-v01
```

Run tests:

```powershell
pnpm test:radar-release-candidate
pnpm test:radar-apply
pnpm test:radar-payload-plan
pnpm test:radar-source-provenance
pnpm exec tsc --noEmit
```

Re-run the honest dry-run immediately before creating the final checkpoint:

```powershell
$HonestPlan = "data_local\staging\ai-radar\payload-plan-honest-v01\ai-radar-payload-patch-plan-v01.jsonl"

pnpm radar:dryrun-payload -- `
  --url http://localhost:3000 `
  --input $HonestPlan `
  --out-dir "data_local\staging\ai-radar\payload-dryrun-honest-v01"
```

Create a new checkpoint after the branch is fully pulled and tests pass:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File ".\scripts\backup\create-local-database-checkpoint.ps1"
```

Select the newest complete checkpoint with a non-empty database dump:

```powershell
$Checkpoint = Get-ChildItem "D:\Baihepailei-backups" -Directory |
  Sort-Object LastWriteTime -Descending |
  Where-Object {
    $StatusFile = Join-Path $_.FullName "checkpoint-status.json"
    $DumpFile = Join-Path $_.FullName "payload-postgresql.dump"
    if (-not (Test-Path $StatusFile) -or -not (Test-Path $DumpFile)) { return $false }
    $Status = Get-Content $StatusFile -Raw | ConvertFrom-Json
    $Status.state -eq "complete" -and (Get-Item $DumpFile).Length -gt 0
  } |
  Select-Object -First 1 -ExpandProperty FullName

$Checkpoint
```

Verify that the dump archive is readable without restoring it:

```powershell
pnpm backup:verify-database-checkpoint -- `
  -CheckpointPath $Checkpoint
```

This performs `pg_restore --list` either with local PostgreSQL tools or in the running `baihepailei-postgres` container. It does not connect to, restore into, or modify a database.

Run final readiness from the release-candidate branch and checkpoint:

```powershell
pnpm radar:apply-readiness -- `
  --url http://localhost:3000 `
  --checkpoint $Checkpoint
```

Required readiness state:

```text
planRowsRead: 100
readyPlanRows: 94
protectedPlanRows: 6
preflightRowsChecked: 94
preflightReadyRows: 94
preflightBlockedRows: 0
preflightReady: true
executionReady: false
payloadPatchRequests: 0
appliedAndVerified: 0
staticBlockers: []
```

Build the disarmed release candidate:

```powershell
pnpm radar:prepare-release-candidate -- `
  --checkpoint $Checkpoint
```

Expected result:

```text
ok: true
candidateReady: true
preflightReadyRows: 94
preflightBlockedRows: 0
localGateWriteEnabled: false
approvalTokenStored: false
payloadPatchRequests: 0
```

## Outputs

```text
data_local/staging/ai-radar/release-candidate-v01/
  database-restore-list-v01.txt
  database-restore-verification-v01.json
  ai-radar-release-candidate-manifest-v01.json
  ai-radar-release-gate-local-disarmed-v01.json
  ai-radar-release-candidate-summary-v01.json
```

The manifest stores only an SHA-256 fingerprint of the future plan-bound approval token. The token itself is not stored.

## Deliberate stopping point

After this stage:

- the checked-in release gate remains disabled;
- the generated local gate remains disabled;
- no approval token is stored;
- no Payload PATCH has been sent;
- no database restore or direct PostgreSQL write has occurred.

Arming the local gate and running execute mode require a separate explicit final approval after reviewing the release-candidate manifest.
