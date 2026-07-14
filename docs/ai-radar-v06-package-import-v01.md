# AI radar v0.6 package import v0.1

This workflow ingests the reviewed `RADAR-ASSESS-0001-to-0044-v0.6-generalized-dryrun` delivery without re-resolving it through the older v0.4 resolver.

The package contains 10,805 provisional assessments under `radar-rating-policy-v0.6-generalized-dryrun`. The workflow treats its final grade calibration as an audited artifact, while continuing to trust identity, write protection and local source records only from the current canonical catalog batches.

## Why the old resolver is not used

The existing resolver imports the v0.4 policy registry and would recalculate the lowest-grade result. The v0.6 delivery contains 586 deliberate calibration changes, including the stricter S gate, multi-route cleanup and female-NTR threshold cleanup. Running those rows through the old resolver could undo the reviewed v0.6 result.

The v0.4 registry is used only as the stable 55-rule code/grade dictionary. In particular, the historical mapping `D-ABO -> E` remains enforced.

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

This reads current Payload once, protects reviewed/locked rows, and creates one isolated plan directory per `RADAR-ASSESS-####` batch. Each batch summary contains its exact dry-run command.

Run dry-runs batch by batch. Do not use `radar:resume-first100`; it is permanently bound to the completed first-100 incident state.

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

## Safety

```text
package import Payload read: false
package import Payload write: false
planning Payload read: true
planning Payload write: false
Payload PATCH requests: 0
PostgreSQL write: false
title-only matching: false
human-reviewed overwrite: false
first-100 resume path reused: false
```

A generalized apply/release candidate should be added only after the real per-batch dry-run counts and blockers are reviewed.
