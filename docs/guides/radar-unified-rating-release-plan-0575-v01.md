# Radar Unified Rating Release Plan 0575 v01

## Locked release

```text
Release: RADAR-UNIFIED-RATING-RELEASE-0575-0001
Research commit: 728ad2da5f7d3aba03f652b9fd701157b06793ee
Records: 575
Ratings: 575
Grades: B 476 / D 97 / E 2
```

The exact manifest and data-file hashes are stored in:

```text
config/radar-unified-rating-release-0575-v01.lock.json
```

## Two public projections

The website keeps two separate projections:

1. `radar-public-records` — facts, evidence and research status;
2. `radar-public-ratings` — machine grades, public rule classes, tag hints, unresolved dimensions and future human-review state.

Both use the same stable publication key:

```text
work:<Works database ID>
```

The rating projection must not overwrite:

- `Works.radarAssessment`;
- `Works.humanAssessment`;
- legacy `Works.rank`;
- Radar public conclusions;
- public fact arrays.

## Expected transition modes

### Fresh isolated database

```text
facts:   ready_create = 575
ratings: ready_create = 575
```

### Database containing the old 520-row Public Release

```text
facts:   ready_update = 520
facts:   ready_create = 55
ratings: ready_create = 575
```

The 520 fact updates are expected because release provenance advances from `RADAR-PUBLIC-RELEASE-0001` to the unified release even though their public fact objects remain unchanged.

### Fully converged database

```text
facts:   already_current = 575
ratings: already_current = 575
```

## Offline command

The planner reads local files only. It performs no HTTP, Payload or PostgreSQL operation.

```powershell
node scripts/radar/plan-unified-rating-release-v01.mjs `
  --release-dir "D:\path\to\baihepailei-research-data\releases\public\radar-unified-rating-release-0575-0001\v01" `
  --works-file "D:\path\to\works-export.jsonl" `
  --current-records-file "D:\path\to\current-public-records.jsonl" `
  --current-ratings-file "D:\path\to\current-public-ratings.jsonl" `
  --output-dir "data_local\staging\radar-unified-rating-release-plan-v01"
```

`--current-records-file` and `--current-ratings-file` may be omitted for a fresh-state plan.

Outputs:

```text
plan.json
plan-rows.jsonl
summary.json
```

## Human review

Release rows must enter the site with:

```text
status = unreviewed
blocksAnalysis = false
blocksPublication = false
```

Future volunteer review updates the public rating projection through a separately designed permission and moderation workflow. Empty review fields are normal and do not block release.

## Next stage

This PR defines and validates the read-only transition contract only. The following stage may add:

- the additive `radar-public-ratings` collection and migration;
- a disposable-database lab using the locked 575-row release;
- exact table-count and protected-fingerprint gates;
- POST/PATCH-only import execution;
- full post-apply idempotence checks.

No production import is authorized here. PR #325 remains independent, draft and unmodified.