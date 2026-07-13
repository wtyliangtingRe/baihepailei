# AI radar Payload apply v0.1

This stage prepares a guarded write path for the first 100 AI radar assessments.

It does not enable writes by itself. The checked-in release gate remains disabled and has no approval token.

## Inputs

The readiness command expects:

- the 100-row honest Payload plan;
- the matching dry-run summary containing the exact plan SHA-256;
- a fresh checkpoint created from the current apply branch and commit;
- a PostgreSQL custom-format dump inside that checkpoint;
- access to the local Payload API.

Default files:

```text
data_local/staging/ai-radar/payload-plan-honest-v01/ai-radar-payload-patch-plan-v01.jsonl
data_local/staging/ai-radar/payload-dryrun-honest-v01/ai-radar-payload-patch-dryrun-v01-summary.json
config/ai-radar-release-gate-v01.json
```

## Required checkpoint

Create the checkpoint only after switching to and pulling the apply branch:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\backup\create-local-checkpoint.ps1 `
  -IncludeDatabase
```

The readiness checker rejects a checkpoint when:

- its status is not `complete`;
- `includesDatabase` is not true;
- the database dump is missing or empty;
- the dump is not listed in the checksum file;
- its commit differs from the current Git commit;
- its branch differs from the current branch;
- it is older than 24 hours by default.

## Exact plan binding

The dry-run script records:

```text
inputSha256
```

The apply readiness command computes the plan hash again and requires an exact match. A plan changed after dry-run is rejected even when its row counts still look correct.

## Readiness mode

Readiness is the default mode and never sends PATCH requests:

```powershell
pnpm radar:apply-readiness -- `
  --url http://localhost:3000 `
  --checkpoint "D:\Baihepailei-backups\Baihepailei-YYYYMMDD-HHMMSS"
```

Expected first-100 state:

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
```

`executionReady` remains false until the release gate is explicitly enabled with the exact plan-bound approval token.

## Per-row checks

Before any write is possible, all 94 ready rows must pass:

- expected action and plan status;
- Payload id and siteId both present;
- no plan blockers;
- allowed patch fields only;
- no X grade;
- honest evidence status versus traceable source count;
- current Payload snapshot hash exactly matches the reviewed plan;
- no newly added human-review protection;
- current changed-field set exactly matches the reviewed changed-field set.

If any row fails, no writes begin.

## Execute mode

The script contains an execute mode, but it remains locked unless all of these are true:

- `--execute` is present;
- `--approval-token` exactly matches the token derived from the reviewed plan SHA-256;
- the release gate has `writeEnabled: true`;
- the release gate stores the same approval token;
- `sourceProvenanceAuditReviewed` is true;
- checkpoint, dry-run hash, counts, and all row preflights pass.

Legacy `--apply` and `--confirm` flags are rejected.

Do not enable the gate or run execute mode before an explicit final approval.

## Write behavior

When eventually approved, writes are:

- existing works only;
- sequential, one PATCH at a time;
- restricted to reviewed changed fields;
- re-checked immediately before each PATCH;
- fetched and verified after each PATCH;
- stopped on the first failure.

Each successful row immediately appends:

- an apply journal entry;
- a rollback-plan entry containing its reviewed previous values.

Automatic rollback is intentionally disabled. A partial failure must be inspected before deciding whether to continue or restore applied rows.

## Outputs

```text
data_local/staging/ai-radar/payload-apply-v01/
  ai-radar-payload-apply-preflight-v01.jsonl
  ai-radar-payload-apply-journal-v01.jsonl
  ai-radar-payload-apply-applied-v01.jsonl
  ai-radar-payload-rollback-plan-v01.jsonl
  ai-radar-payload-apply-summary-v01.json
```

## Tests

```powershell
pnpm test:radar-apply
pnpm test:radar-payload-plan
pnpm test:radar-source-provenance
pnpm test:radar-release-gate
```

Safety expectations:

```text
readiness payload writes: 0
direct PostgreSQL writes: 0
creates works: false
deletes works: false
stops on first failure: true
verifies every patch: true
rollback row per successful patch: true
```
