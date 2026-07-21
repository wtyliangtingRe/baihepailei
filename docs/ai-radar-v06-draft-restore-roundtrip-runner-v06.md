# AI Radar v0.6 Draft-Restore Roundtrip Runner

## Verified laboratory result

The isolated Payload 3.86.0 laboratory verified this exact sequence for Work `3839`:

1. restore version `8744` through REST with `?draft=true`;
2. publish the allowlisted Radar patch;
3. restore original draft version `79558` through REST with `?draft=true`.

The successful run produced three Payload write requests and verified all of the following:

- the first restore did not alter published/main;
- the clean draft equaled published content except for root `_status`;
- the Radar patch matched both published and the latest version after publication;
- unrelated published state was preserved;
- human-review state was preserved;
- the original latest draft was restored exactly;
- the published Radar patch remained after restoring the original draft;
- no generic restore without `draft=true` was used;
- no whole-document draft PATCH was used;
- no Local API restore was used;
- no direct PostgreSQL write was used;
- the formal database was not targeted.

## Closed runner

The session-independent wrapper is:

```text
scripts/radar/run-ai-radar-v06-draft-restore-roundtrip-lab-v06.ps1
```

It restores non-secret constants and helper functions on every invocation, discovers the one active laboratory database, checks formal-database isolation, validates the candidate and checkpoint hashes, prompts for the Payload password without displaying it, and always runs read-only inspect before any execute path.

The password is stored only in the current process environment while the wrapper runs. It is not written to `.env`, output files, Git, or command-line arguments.

## Read-only invocation

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File scripts/radar/run-ai-radar-v06-draft-restore-roundtrip-lab-v06.ps1
```

The default mode is `Inspect`. It performs no Payload write.

## Execute invocation

Execute mode is laboratory-only and requires a newly restored database with exactly the reviewed baseline:

```text
versions read:             7
clean content version:     8744
original draft version:    79558
```

A previously executed or otherwise mutated laboratory database is rejected by this freshness gate.

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File scripts/radar/run-ai-radar-v06-draft-restore-roundtrip-lab-v06.ps1 `
  -Mode Execute `
  -Confirmation "EXECUTE-V06-DRAFT-RESTORE-ROUNDTRIP-LAB-V06-ONLY"
```

The wrapper performs the following before delegating the verified v0.5 engine exactly once:

- checks the PR #288 laboratory branch;
- rejects unexpected local changes;
- runs syntax and focused tests;
- validates the seven-field Radar allowlist;
- rejects human-review fields;
- validates candidate, checkpoint, and expected SHA-256 values;
- requires zero formal-database connections;
- requires one active lab database and at least one application connection;
- requires port `3100`;
- requires 83 public tables;
- performs read-only inspect;
- requires the reviewed seven-version baseline;
- creates a fresh proof under `data_local`;
- executes the three-stage roundtrip;
- requires exactly two REST restore-as-draft requests and one partial published patch;
- requires a successful final summary.

## Safety boundary

This runner does not create, restore, drop, or mutate PostgreSQL databases directly. Database restoration remains a separately reviewed preparation step.

This runner is not a production executor. It only accepts loopback port `3100` and an approved `baihepailei_radar_lab_*` database. PR #288 remains Draft until the wrapper tests and a fresh restored-database rehearsal have been reviewed.
