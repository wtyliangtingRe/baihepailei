# AI radar v0.6 package import v0.1

This workflow ingests the reviewed `RADAR-ASSESS-0001-to-0044-v0.6-generalized-dryrun` delivery without re-resolving it through the older v0.4 resolver.

The package contains 10,805 provisional assessments under `radar-rating-policy-v0.6-generalized-dryrun`. The workflow treats its final grade calibration as an audited artifact, while continuing to trust identity, write protection and local source records only from the current canonical catalog batches.

## Why the old resolver is not used

The existing resolver imports the v0.4 policy registry and would recalculate the lowest-grade result. The v0.6 delivery contains 586 deliberate calibration changes, including the stricter S gate, multi-route cleanup and female-NTR threshold cleanup. Running those rows through the old resolver could undo the reviewed v0.6 result.

The v0.4 registry is used only as the stable 55-rule code/grade dictionary. In particular, the historical mapping `D-ABO -> E` remains enforced.

## Tests

```powershell
pnpm test:radar-v06-package
pnpm test:radar-v06-dryrun
pnpm test:radar-payload-plan
pnpm exec tsc --noEmit
```

## Extract the package

Keep the ZIP out of Git. Extract it under ignored `data_local`:

```powershell
$Zip = "<path-to>\RADAR-ASSESS-0001-to-0044-v0.6-generalized-dryrun.zip"
$ExtractRoot = "data_local\staging\ai-radar\v06-package-source"
Remove-Item -Recurse -Force $ExtractRoot -ErrorAction SilentlyContinue
Expand-Archive -LiteralPath $Zip -DestinationPath $ExtractRoot
$PackageDir = Join-Path $ExtractRoot "RADAR-ASSESS-0001-to-0044-v0.6-generalized-dryrun"
```

## Validate and import

```powershell
pnpm radar:import-v06-package -- --package-dir $PackageDir
```

The importer:

- verifies every file in `CHECKSUMS.json`;
- verifies the fixed v0.6 manifest, 44 batches, 433 response files and 433 validation files;
- verifies all current local catalog batch SHA-256 values;
- requires the exact 10,805-work identity set in catalog, responses and resolutions;
- preserves canonical `workId`, `siteId`, existing state and write protection only from the local catalog;
- validates every final rule code against the 55-rule registry;
- preserves all 698 publication-guard rows as AI-pending review records;
- combines package sources with canonical source links before accepting `single_secondary_supported` or `multiple_secondary_supported` provenance;
- blocks rows whose source claim remains unsupported after the canonical merge.

No Payload or PostgreSQL read/write occurs.

## Build current-Payload plans

```powershell
$env:RADAR_PAYLOAD_EMAIL="<Payload email>"
$env:RADAR_PAYLOAD_PASSWORD="<Payload password>"
pnpm radar:plan-v06-payload -- --url http://localhost:3000
```

This reads current Payload once, protects reviewed/locked rows, and creates one isolated plan directory per `RADAR-ASSESS-####` batch.

The first real run on the corrected 35,611-work catalog reported:

```text
assessment rows: 10,805
ready for dry-run: 9,364
blocked before dry-run: 1,441
already current: 0

multiple_secondary_requires_two_traceable_sources: 1,238
missing_source_summary: 203
```

The blocked rows remain in the review outputs and are not forced into a patch plan.

## Run all 44 dry-runs once

```powershell
pnpm radar:dryrun-v06-payload -- --url http://localhost:3000
```

This command:

- verifies the batch manifest and every per-batch plan SHA-256;
- loads the current 35,611-work Payload catalog once, not 44 times;
- re-resolves every target by stable Payload `id` and `siteId`;
- rechecks human-review protection;
- blocks stale snapshots created by any change after planning;
- writes isolated results for every batch plus one aggregate summary;
- has no PATCH path and rejects execute/apply/write flags.

Default aggregate summary:

```text
data_local/staging/ai-radar/v06-payload-dryrun-v01/
  ai-radar-v06-payload-dryrun-v01-summary.json
  ai-radar-v06-payload-dryrun-v01-batches.json
  ai-radar-v06-payload-dryrun-v01-would-update.jsonl
  ai-radar-v06-payload-dryrun-v01-blocked.jsonl
  ai-radar-v06-payload-dryrun-v01-already-current.jsonl
  batches/
```

A single batch can be rerun for investigation:

```powershell
pnpm radar:dryrun-v06-payload -- `
  --url http://localhost:3000 `
  --batch-id RADAR-ASSESS-0001
```

The aggregate dry-run must be reviewed before a generalized apply stage is implemented. In particular, confirm:

```text
complete: true
planRowsRead: 10,805
wouldUpdate + blocked + alreadyCurrent: 10,805
integrityBlockers: []
payloadPatchRequests: 0
```

Any new stale snapshot, identity mismatch, or human-protection blocker must remain blocked. Do not use `radar:resume-first100`; it is permanently bound to the completed first-100 incident state.

## Publication semantics

Every imported result remains:

```text
ratingNotice = ai_synthesized_pending_review
reviewStatus = pending
requiresHumanReview = true
```

Publication-guard rows additionally receive:

```text
radar_publication_guard
radar_guard_<reason>
```

The guard does not erase the provisional grade. It prevents the system from presenting weak evidence as a final human-reviewed conclusion.

## Credential hygiene

Do not paste a real Payload password into logs or chat. If a credential is exposed, rotate it immediately and clear the current PowerShell process variables:

```powershell
Remove-Item Env:RADAR_PAYLOAD_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:PAYLOAD_EXPORT_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:PAYLOAD_SEED_PASSWORD -ErrorAction SilentlyContinue
```

## Safety

```text
package import Payload read: false
package import Payload write: false
planning Payload read: true
planning Payload write: false
dry-run Payload read: true
dry-run Payload write: false
Payload PATCH requests: 0
PostgreSQL write: false
title-only matching: false
human-reviewed overwrite: false
plan hashes revalidated: true
stale snapshots blocked: true
first-100 resume path reused: false
```

A generalized apply/release candidate should be added only after the aggregate and per-batch dry-run counts and blockers are reviewed.
