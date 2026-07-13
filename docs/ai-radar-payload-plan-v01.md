# AI Radar Payload Patch Plan v0.1

This stage converts the reviewed first-100 staging assessment into a deterministic Payload patch plan and a read-only dry-run.

It does **not** contain an apply mode and does **not** send PATCH requests.

## Commands

```powershell
pnpm test:radar-payload-plan
pnpm radar:plan-payload -- --url http://localhost:3000
pnpm radar:dryrun-payload -- --url http://localhost:3000
```

Payload credentials can be supplied through:

```text
RADAR_PAYLOAD_EMAIL
RADAR_PAYLOAD_PASSWORD
```

The existing `PAYLOAD_EXPORT_*` and `PAYLOAD_SEED_*` variables are also accepted.

For offline fixtures, both commands support:

```text
--works-file path/to/works.json
```

## Default input

```text
data_local/staging/ai-radar/first100-complete-v01/ai-radar-first100-resolved-v01.jsonl
data_local/staging/ai-radar/first100-complete-v01/ai-radar-first100-metrics-v01.json
```

## Planned Payload fields

```text
rank
ratingNotice
reviewStatus
reviewReasons
evidenceStrength
radarAssessment
```

`radarAssessment` preserves:

```text
confidencePercent
evidenceCoveragePercent
evidenceStatus
sourceSummary
sourceCount
policyVersion
assessmentBatch
suggestedGrade
decisiveRuleCode
decisiveRuleReason
matchedRules
contradictions
requiresHumanReview
assessedAt
```

All matched rules are preserved. The lowest safety grade determines `rank`, but does not discard positive or additional risk rules.

## Identity matching

The planner never updates a work from a title-only match.

It uses Payload `id` and stable `siteId`:

- when both resolve to the same work, the target is accepted;
- when they resolve to different works, the row is blocked;
- when only one identifier resolves and the title does not agree, the row is blocked;
- when both stable identifiers agree but the display title changed, the row is retained with a warning.

## Protection rules

Rows are blocked when any of the following applies:

```text
identity or series conflict
exact-summary duplicate conflict
assessment write protection
source contradiction
existing manual-reviewed notice
existing reviewed/disputed/deprecated status
existing humanVerified/locked flag
X-grade suggestion
invalid or missing rule metadata
```

`external_research_insufficient` is intentionally a warning rather than a blocker. Such works remain visible as conservative `D` / insufficient-evidence records, matching the site's open-catalog principle.

## Snapshot guard

Every ready plan stores a hash of the current relevant Payload fields. The dry-run reads Payload again and blocks a row if those fields changed after plan generation.

This prevents a stale plan from silently overwriting newer edits.

## Outputs

Plan outputs:

```text
data_local/staging/ai-radar/payload-plan-v01/
  ai-radar-payload-patch-plan-v01.jsonl
  ai-radar-payload-patch-plan-v01-ready.jsonl
  ai-radar-payload-patch-plan-v01-blocked.jsonl
  ai-radar-payload-patch-plan-v01-already-current.jsonl
  ai-radar-payload-patch-plan-v01-preview.csv
  ai-radar-payload-patch-plan-v01-summary.json
```

Dry-run outputs:

```text
data_local/staging/ai-radar/payload-dryrun-v01/
  ai-radar-payload-patch-dryrun-v01.jsonl
  ai-radar-payload-patch-dryrun-v01-would-update.jsonl
  ai-radar-payload-patch-dryrun-v01-blocked.jsonl
  ai-radar-payload-patch-dryrun-v01-already-current.jsonl
  ai-radar-payload-patch-dryrun-v01-summary.json
```

## Safety

```text
payloadRead: true when using the local API
payloadWrite: false
payloadPatchRequests: 0
directPostgresqlWrite: false
titleOnlyMatchingAllowed: false
humanReviewedRowsProtected: true
staleSnapshotsBlocked: true
applyModeExists: false
```

A separate apply command must not be added until the plan and dry-run outputs have been reviewed and the user explicitly approves the write stage.
