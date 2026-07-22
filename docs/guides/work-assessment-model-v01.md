# Work assessment and schema normalization model v0.1

Status: design locked, database migration not executed.

## Canonical principles

### Work lifecycle

Only two lifecycle concepts remain authoritative:

- `catalogStatus`: `active | temporary | archived`
- Payload `_status`: `draft | published`

The legacy business `status` column is retired. It must not be read, written, exported, or used to infer `_status` or `catalogStatus`.

### Removed legacy fields

`legacy_x_wiki_page` is retired permanently. It has no remaining business meaning and must not be copied into any replacement field.

### Assessment tracks

A Work can expose two independent reference tracks:

1. Human assessment track
2. Public AI Radar assessment track

Neither track is presented as an absolute verdict. Both retain evidence, uncertainty, source coverage, contradictions, and assessment provenance when available.

The public presentation shape is identical for both tracks:

- `track`
- `state`
- `grade`
- `summary`
- `sourceSummary`
- `sourceLinks`
- `evidenceStatus`
- `evidenceStrength`
- `confidencePercent`
- `evidenceCoveragePercent`
- `sourceCount`
- `policyVersion`
- `assessmentBatch`
- `decisiveRuleCode`
- `decisiveRuleReason`
- `matchedRules`
- `contradictions`
- `requiresHumanReview`
- `assessedAt`
- `assessedBy`
- `bestGrade`
- `likelyGrade`
- `worstGrade`
- `provenance`

A missing value remains empty. Missing fields are not converted into zero, false, or a fabricated conclusion.

### Effective grade

The effective public grade is derived in this order:

1. A valid human assessment grade whose state is assessed or disputed.
2. Otherwise, a current public AI Radar grade.
3. Otherwise, `unknown`.

The stored legacy `rank` field is not an assessment source. During transition, public exports may continue emitting `rank`, but it is recomputed from the rule above and marked compatibility-only.

A pending human grade remains visible as reference material but does not override a current public AI grade.

### Public AI isolation

Public AI conclusions remain in `radar-public-conclusions` and never publish, patch, or restore Works drafts.

A private or stale `works.radarAssessment` value is not a public AI conclusion. Only the current record in `radar-public-conclusions` may become the public AI track.

## Human assessment normalization

Canonical human data lives under `humanAssessment`.

Legacy fields to retire after normalization:

- `reviewStatus`
- `humanReviewNote`
- `humanReviewedAt`
- `humanReviewedBy`

Transition rules:

1. When only canonical data exists, keep it.
2. When only meaningful legacy data exists, copy it into the corresponding canonical field.
3. Default-only legacy `pending` values are not evidence and are not copied by themselves.
4. When canonical and legacy values agree, keep canonical data and record the migration provenance.
5. When canonical and legacy values differ, never overwrite automatically. Emit a manual-review conflict row.
6. Source-link child tables currently contain no rows; no link reconciliation is required for the first normalization.

Known pre-migration exceptions from the read-only audit:

- one `rank` versus human-grade mismatch;
- one new-versus-legacy human-note disagreement;
- one invalid legacy `status = archived` value relative to the old draft/published enum;
- no non-null `legacy_x_wiki_page` values.

Exact Work IDs must be included in the migration dry-run report before any write is approved.

## Database migration phases

### Phase 0 — read-only proof

Produce exact IDs, before-values, proposed after-values, counts, and checksums. No database write.

### Phase 1 — human data normalization

Copy non-conflicting meaningful legacy human values into `humanAssessment`. Isolate conflicts for manual review. Do not drop columns yet.

### Phase 2 — verification

Re-run value, count, and conflict audits. Confirm no meaningful value exists only in legacy fields.

### Phase 3 — legacy retirement

After backup and explicit approval, drop:

- `works.status` and its version mirror;
- `legacy_x_wiki_page` and its version mirror;
- old human-review columns and their version mirrors;
- obsolete enum types only when no remaining column depends on them.

Keep:

- `catalog_status`;
- Payload `_status` and version `_status`;
- canonical `humanAssessment`;
- independent public AI Radar conclusions.

### Phase 4 — rank retirement

After all readers consume `effectiveGrade`, stop storing or editing `rank`. Keep a derived compatibility property only as long as an older client still requires it.

## Safety gates

No phase may:

- infer Payload `_status` from legacy `status`;
- promote a Works draft;
- overwrite a canonical human value with a disagreeing legacy value;
- treat `rank` as independent evidence;
- expose a private Works AI draft as a public AI conclusion;
- execute database writes without a fresh verified backup and reviewed SQL.
