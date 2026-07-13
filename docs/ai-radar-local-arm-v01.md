# AI radar local arm v0.1

This stage adds a local-only, time-limited arming step for the reviewed first-100 AI radar release candidate.

It does not arm the checked-in release gate and does not send Payload PATCH requests.

## Security boundary

The checked-in file remains disabled:

```text
config/ai-radar-release-gate-v01.json
writeEnabled: false
approvalToken: null
```

A locally armed gate is written only below ignored `data_local` and is valid for 30 minutes by default.

The arming command requires all of the following:

- a release-candidate manifest generated on the current branch and commit;
- a fresh checkpoint from the same branch and commit;
- exact SHA-256 matches for the plan, dry-run, disarmed readiness, source audit, checkpoint metadata, database dump and restore verification;
- the exact plan-bound approval token;
- the exact local-arm confirmation phrase;
- an output path below `data_local`.

The arming command does not connect to Payload or PostgreSQL.

## Tests

```powershell
pnpm test:radar-local-arm
pnpm test:radar-release-candidate
pnpm test:radar-apply
pnpm exec tsc --noEmit
```

## Prepare a final candidate on this commit

Because checkpoint and candidate files are commit-bound, create them after switching to the final local-arm branch and pulling its latest commit.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File ".\scripts\backup\create-local-database-checkpoint.ps1"

pnpm backup:verify-database-checkpoint -- `
  -CheckpointPath $Checkpoint

pnpm radar:apply-readiness -- `
  --url http://localhost:3000 `
  --checkpoint $Checkpoint

pnpm radar:prepare-release-candidate -- `
  --checkpoint $Checkpoint
```

The release candidate must still be disarmed:

```text
candidateReady: true
preflightReadyRows: 94
preflightBlockedRows: 0
executionReady: false
payloadPatchRequests: 0
```

## Local arming

Do not run this step without an explicit final arming approval.

```powershell
$ApprovalToken = "<exact plan-bound token>"
$ArmConfirmation = "ARM-AI-RADAR-FIRST-100-LOCAL-GATE-ONLY"

pnpm radar:arm-local -- `
  --checkpoint $Checkpoint `
  --approval-token $ApprovalToken `
  --confirmation $ArmConfirmation
```

Outputs:

```text
data_local/staging/ai-radar/release-arm-v01/
  ai-radar-release-gate-local-armed-v01.json
  ai-radar-release-arm-summary-v01.json
```

The summary never prints the approval token. The gate stores it locally because the apply command must compare the exact value.

Default lifetime:

```text
30 minutes
```

Allowed range:

```text
5 to 60 minutes
```

## Armed readiness

Armed readiness is still read-only. It must use a separate output directory so it cannot overwrite the disarmed readiness summary bound into the candidate manifest.

```powershell
$Manifest = "data_local\staging\ai-radar\release-candidate-v01\ai-radar-release-candidate-manifest-v01.json"
$ArmedGate = "data_local\staging\ai-radar\release-arm-v01\ai-radar-release-gate-local-armed-v01.json"
$ArmedOut = "data_local\staging\ai-radar\payload-apply-armed-readiness-v01"

pnpm radar:apply-readiness -- `
  --url http://localhost:3000 `
  --checkpoint $Checkpoint `
  --gate $ArmedGate `
  --candidate-manifest $Manifest `
  --approval-token $ApprovalToken `
  --require-execution-ready `
  --out-dir $ArmedOut
```

Expected stopping state:

```text
mode: armed_readiness
preflightRowsChecked: 94
preflightReadyRows: 94
preflightBlockedRows: 0
preflightReady: true
executionReady: true
payloadPatchRequests: 0
appliedAndVerified: 0
```

If the gate expires or any candidate-bound file changes, armed readiness fails with a non-zero exit code.

## Execute boundary

Actual execution requires all armed-readiness conditions plus:

- `--execute`;
- the exact approval token;
- the original candidate manifest;
- the same checkpoint;
- the unexpired local armed gate;
- a candidate-specific confirmation string of the form:

```text
EXECUTE-RC-<20 HEX DIGITS>-94-PATCHES
```

No execute command should be run until a separate explicit final approval is given after the armed-readiness summary is reviewed.
