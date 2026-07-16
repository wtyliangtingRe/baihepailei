# AI radar v0.6 guarded batch release v0.1

This workflow safely moves reviewed v0.6 Radar suggestions from dry-run plans into local Payload, one `RADAR-ASSESS-####` batch at a time.

It is stacked on the package import and dry-run workflow. It does not reuse the incident-bound first-100 resume path.

## Reviewed state

The real full-catalog dry-run reported:

```text
Payload Works: 35,611
reviewed plan rows: 10,805
would update: 9,364
blocked by provenance: 1,441
already current: 0
integrity blockers: 0
Payload PATCH requests: 0
```

The 1,441 blocked rows remain in each batch plan for accounting, but are never candidates for PATCH.

## Release unit

A release candidate covers exactly one existing assessment batch:

```text
RADAR-ASSESS-0001
...
RADAR-ASSESS-0044
```

Each candidate binds:

- the exact batch plan and SHA-256;
- the batch plan summary and SHA-256;
- the reviewed batch dry-run summary and SHA-256;
- the current Git branch and commit;
- a fresh local checkpoint manifest, status, checksum table and PostgreSQL dump;
- the verified `pg_restore --list` evidence for that dump;
- the exact ready, blocked and already-current counts.

## Safety model

For every ready row, current Payload is classified as exactly one of:

```text
pending_original
already_applied
drifted
```

`pending_original` means the current radar fields still equal the exact reviewed `expectedBeforeHash`, and the remaining changed-field set is identical to the reviewed plan.

`already_applied` means Payload already semantically equals the complete target patch. Payload-generated nested row IDs and timezone-equivalent timestamps remain normalized by the existing comparison layer.

Anything else is `drifted` and blocks the entire batch before a PATCH can begin.

Human-reviewed, disputed, deprecated or locked rows are always drifted/blocked even if they changed after planning.

## 1. Tests

```powershell
pnpm test:radar-v06-release
pnpm test:radar-v06-dryrun
pnpm test:radar-v06-package
pnpm test:radar-payload-plan
pnpm test:radar-apply
pnpm exec tsc --noEmit
```

## 2. Create and verify a fresh checkpoint

Create the checkpoint only after switching to the exact release branch/commit. The ordinary `backup:checkpoint` command does not include PostgreSQL, so the release workflow must use the database-specific command:

```powershell
pnpm backup:checkpoint:database
```

Use the path printed by the command:

```powershell
$Checkpoint = "<exact checkpoint directory>"
pnpm backup:verify-database-checkpoint -- -CheckpointPath $Checkpoint
```

The verification command must produce a JSON file recording a successful `pg_restore --list`, the exact dump SHA-256 and a positive list-entry count.

```powershell
$RestoreVerification = "<exact restore verification JSON file>"
```

## 3. Prepare one disarmed candidate

```powershell
$Batch = "RADAR-ASSESS-0001"

pnpm radar:prepare-v06-batch-candidate -- `
  --batch-id $Batch `
  --checkpoint $Checkpoint `
  --restore-verification $RestoreVerification
```

Candidate preparation performs no Payload read and no database write. It creates a disarmed gate with no approval token.

Set the emitted candidate path:

```powershell
$Candidate = "data_local\staging\ai-radar\v06-batch-candidates-v01\radar-assess-0001\candidate-manifest.json"
```

## 4. Disarmed readiness

```powershell
pnpm radar:readiness-v06-batch -- `
  --candidate-manifest $Candidate `
  --checkpoint $Checkpoint `
  --url "http://localhost:3000"
```

The expected first-run state is:

```text
mode: readiness
pendingOriginal: <candidate wouldUpdate>
alreadyApplied: 0
drifted: 0
preflightReady: true
payloadPatchRequests: 0
```

The readiness wrapper rejects `--execute`, `--apply`, `--write`, `--patch` and execute-confirmation flags.

Set the emitted summary path:

```powershell
$Readiness = "data_local\staging\ai-radar\v06-batch-readiness-v01\radar-assess-0001\summary.json"
```

## 5. Compute the local approval token

The token is derived locally from the exact reviewed plan hash and batch ID. Do not store it in Git or paste it into chat/log files.

```powershell
$PlanHash = (Get-Content $Candidate -Raw | ConvertFrom-Json).files.plan.sha256
$Token = "APPLY-$($Batch.ToUpper())-$($PlanHash.Substring(0,16).ToUpper())"
```

## 6. Arm a time-limited local gate

```powershell
pnpm radar:arm-v06-batch -- `
  --candidate-manifest $Candidate `
  --readiness $Readiness `
  --checkpoint $Checkpoint `
  --approval-token $Token `
  --confirmation "ARM-AI-RADAR-V06-BATCH-LOCAL-GATE-ONLY"
```

The token is stored only in ignored `data_local`. The default TTL is 120 minutes and the maximum is 720 minutes.

```powershell
$Gate = "data_local\staging\ai-radar\v06-batch-arms-v01\radar-assess-0001\local-gate-armed.json"
```

## 7. Armed readiness

Run another full preflight after arming:

```powershell
pnpm radar:readiness-v06-batch -- `
  --candidate-manifest $Candidate `
  --checkpoint $Checkpoint `
  --gate $Gate `
  --approval-token $Token `
  --url "http://localhost:3000"
```

This command still cannot write. `executionReady: true` is required before an execution can be considered.

## 8. Execute once

Only after separate explicit final approval, use the exact confirmation printed by the arm command:

```powershell
$ExecuteConfirmation = "<exact EXECUTE-RC-V06-...-N-PATCHES value>"

pnpm radar:execute-v06-batch-once -- `
  --candidate-manifest $Candidate `
  --checkpoint $Checkpoint `
  --gate $Gate `
  --approval-token $Token `
  --execute-confirmation $ExecuteConfirmation `
  --url "http://localhost:3000"
```

Execution behavior:

- performs a full preflight before any PATCH;
- applies only `pending_original` ready rows;
- never applies blocked plan rows;
- writes rollback intent before each PATCH;
- applies sequentially;
- fetches and semantically verifies every PATCH;
- stops on the first failure;
- writes each run to a unique ignored evidence directory;
- never performs direct PostgreSQL writes;
- never automatically rolls back.

## Recovery after a partial stop

Run disarmed readiness again using the same candidate and checkpoint:

```powershell
pnpm radar:readiness-v06-batch -- `
  --candidate-manifest $Candidate `
  --checkpoint $Checkpoint `
  --url "http://localhost:3000"
```

A recoverable partial state has:

```text
pendingOriginal > 0
alreadyApplied > 0
drifted = 0
preflightReady = true
```

If the old gate expired, create a replacement gate using that new readiness summary and `--resume`:

```powershell
pnpm radar:arm-v06-batch -- `
  --resume `
  --candidate-manifest $Candidate `
  --readiness "<new readiness summary>" `
  --checkpoint $Checkpoint `
  --approval-token $Token `
  --confirmation "ARM-AI-RADAR-V06-BATCH-LOCAL-GATE-ONLY"
```

Resume arming is rejected unless at least one row is already applied, at least one remains pending, their sum equals the exact candidate write count, and `drifted` is zero.

## Completion verification

After a batch completes, disarmed readiness should report:

```text
pendingOriginal: 0
alreadyApplied: <candidate wouldUpdate>
drifted: 0
```

After all selected batches complete, rerun the global dry-run. The expected final state for the current delivery is approximately:

```text
wouldUpdate: 0
blocked: 1,441
alreadyCurrent: 9,364
integrityBlockers: []
```

The blocked provenance rows remain pending future evidence repair and are not silently discarded.
