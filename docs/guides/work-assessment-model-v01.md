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

A Work exposes two fully independent reference tracks:

1. Human assessment track
2. Public AI Radar assessment track

Neither track is presented as an absolute verdict. Both retain evidence, uncertainty, source coverage, contradictions, and assessment provenance when available.

Every canonical Work must converge to exactly one current public AI Radar conclusion. A human grade, human verification state, low source count, low confidence, lifecycle state, or visibility state must not suppress, delete, overwrite, or prevent the AI track. The AI track likewise must not mutate the human track.

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

### Display and search grade

The primary grade shown in Work windows and search results is derived in this order:

1. A valid human assessment grade whose state is assessed or disputed.
2. Otherwise, a current public AI Radar grade.
3. Otherwise, `unknown`.

This precedence is a presentation and search rule only. It may drive cards, filters, sorting, aggregation, and compatibility output, but it does not control whether either track is stored, published, updated, or considered current.

The stored legacy `rank` field is not an assessment source. During transition, public exports may continue emitting `rank`, but it is recomputed from the display rule above and marked compatibility-only.

A pending human grade remains visible as reference material but does not replace the current public AI grade. When valid human and AI grades disagree, both tracks remain visible and independently auditable; only the primary display grade prefers human.

### Historical rank preservation

Retiring `rank` does not authorize silent data loss.

Every non-`unknown` historical `rank` must first be classified:

- `canonical_human`: backed by a valid canonical human assessment;
- `private_ai_requires_publication_review`: backed only by a private Works Radar suggestion and therefore not yet public;
- `legacy_rank_provenance_unknown`: no canonical human or private AI source is currently identifiable;
- `no_effective_grade_source`: no usable grade source.

`legacy_rank_provenance_unknown` must not automatically become a human assessment or a public AI conclusion. It remains a migration-review candidate until import batch, source metadata, historical policy, or an explicit decision establishes its provenance.

### Public AI isolation

Public AI conclusions remain in `radar-public-conclusions` and never publish, patch, or restore Works drafts.

A private or stale `works.radarAssessment` value is not a public AI conclusion. Only the current record in `radar-public-conclusions` may become the public AI track.

Evidence shortage changes uncertainty metadata, not AI-track existence. A single-source or low-confidence conclusion must retain its true source count, lower confidence and coverage, warnings, and `requiresHumanReview`, while still producing the required current AI conclusion for the canonical Work. Noncanonical merge-out records are covered by their explicit canonical Work rather than receiving duplicate current records.

Every canonical Work must receive at least one standardized multilingual external research scan. The scan attempts Chinese, Japanese, and English queries across official material, structured databases, walkthroughs, Wikis, long reviews, and community discussion. A bootstrap AI conclusion may exist before that scan is complete, but it must expose explicit uncertainty and remain queued for research supersession; `no discussion found` must never be confused with `not searched`.

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

## Audit integrity

Candidate reports are valid migration evidence only when:

- PostgreSQL JSON is converted to UTF-8 inside PostgreSQL;
- cross-process transport uses Base64 ASCII;
- PowerShell decodes with UTF-8;
- every decoded row passes JSON parsing;
- `validation.json` records the verified transport;
- file SHA-256 values are included in `manifest.json`.

A report with mojibake or invalid JSON may be retained for incident analysis but cannot be used as a source of before-values, titles, notes, or migration decisions.

## Database migration phases

### Phase 0 — read-only proof

Produce exact IDs, before-values, proposed after-values, counts, checksums, JSON validation proof, and rank provenance classes. No database write.

### Phase 1 — human data normalization

Copy non-conflicting meaningful legacy human values into `humanAssessment`. Isolate conflicts for manual review. Do not drop columns yet.

### Phase 2 — verification

Re-run value, count, conflict, encoding, and provenance audits. Confirm no meaningful value exists only in legacy fields and no historical rank was silently discarded.

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

After all readers consume `effectiveGrade` and all historical rank candidates have explicit provenance decisions, stop storing or editing `rank`. Keep a derived compatibility property only as long as an older client still requires it.

## Safety gates

No phase may:

- infer Payload `_status` from legacy `status`;
- promote a Works draft;
- overwrite a canonical human value with a disagreeing legacy value;
- treat `rank` as independent evidence;
- silently discard a non-`unknown` historical rank;
- promote an unknown-provenance rank into the human track;
- expose a private Works AI draft as a public AI conclusion;
- use mojibake or invalid JSON audit output as migration evidence;
- execute database writes without a fresh verified backup and reviewed SQL.
