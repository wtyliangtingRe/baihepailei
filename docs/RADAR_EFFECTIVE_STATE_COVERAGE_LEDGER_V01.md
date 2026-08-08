# Radar Effective-State Coverage Ledger v01

This is a **read-only website coverage/integrity audit**. It does not migrate the production database, write Payload/PostgreSQL rows, rewrite historical releases, rerate existing Public Ratings, or generate new Research/Assessment data.

## Canonical unit and authority

The canonical unit is one `Works` row. Every Work is assigned exactly one effective bucket:

```text
Human
  > Published
  > Candidate
  > Research
  > Legacy
  > TrulyUnassessed
```

Selection is **presence-first / validation-second / fail-closed**. A malformed higher-authority state still owns its bucket and produces `effectiveValid=false`; it is never repaired by silently falling through to Research or Legacy.

`Published` is the paired current `RadarPublicRecords` + `RadarPublicRatings` projection. Any current half-pair counts as Published presence and therefore fails closed if the pair is incomplete or duplicated.

`Candidate` is the current `RadarPublicConclusions` projection.

`Research` preserves all matching `RadarResearchRecords` as immutable history. `historicalObservationCount` counts every observation and `effectiveResearchObservation` is a separate deterministic projection. Current observations are preferred as the selection pool; if none is current, history remains the Research authority while the ledger emits `research_no_current_observation`.

Research selection is **quality/status-first, not latest-wins**. The deterministic priority is review state, research status, assessment readiness, confidence, source quality, milestone, then timestamp and stable identity/hash tie-breakers. A malformed observation whose priority is at or above the best valid observation blocks the effective Research selection instead of silently falling through to the lower valid observation. The chosen projection records `selectionReason` and `selectionBlocked`. Historical Research rows are never deduplicated away.

`Legacy` is only the lower-authority compatibility state on `Works` (`radarAssessment` / `rank`).

## Conclusion semantics

The ledger imports and delegates conclusion interpretation to:

```text
src/lib/radar/conclusionNormalizer.mjs
```

It does **not** define a second grade/range semantics. The ledger adds persistence and lineage invariants around that normalizer, including:

- explicit conclusion-mode mismatch;
- invalid/missing bounded range;
- fixed-grade conflicts;
- `labels_only` / `blocked` ghost grades;
- machine `X` protection on Candidate/Published state;
- policy-version diagnostics;
- Public Record/Public Rating pair binding consistency.

## Identity and conservation checks

The audit checks at least:

- duplicate canonical Work ids;
- duplicate `Works.siteId` bindings;
- orphan relationship/snapshot references;
- `workIdSnapshot` / `workSiteId` mismatch;
- `identityKey` mismatch;
- `publicationKey` mismatch;
- duplicate current Published/Candidate/Research claims;
- malformed higher-authority state;
- Research history/effective projection separation;
- strict conservation:

```text
Human
+ Published
+ Candidate
+ Research
+ Legacy
+ TrulyUnassessed
= canonical Works universe
```

Strict conservation additionally requires one unique canonical Work id per ledger row.

## Frozen snapshot input

The CLI intentionally consumes a frozen read-only export instead of connecting to production by itself. This keeps production authorization separate from audit semantics and lets a later production preflight/exporter provide the data without giving this tool write capability.

Snapshot JSON shape:

```json
{
  "works": [],
  "radarPublicRecords": [],
  "radarPublicRatings": [],
  "radarPublicConclusions": [],
  "radarResearchRecords": []
}
```

Run:

```bash
node scripts/radar/audit-radar-effective-state-coverage-v01.mjs \
  --snapshot /path/to/read-only-snapshot.json \
  --output-dir /path/to/audit-output \
  --strict
```

Outputs are deterministic for identical parsed input:

- `audit.json`
- `ledger.jsonl`
- `violations.jsonl`
- `SUMMARY.md`
- `SHA256SUMS`

No wall-clock timestamp is inserted into these files.

## Ledger row contract

Each canonical Work row includes:

- `effectiveBucket`
- `effectiveValid`
- `violations`
- `effectiveViolations`
- `authorityPresence`
- `historicalObservationCount`
- `effectiveResearchObservation`
- `effectiveConclusion`

`violations` keeps lower/shadowed defects visible. `effectiveViolations` contains the canonical + selected-authority defects that decide `effectiveValid`.

## Validation

Focused regression command:

```bash
node --test tests/radar-effective-state-coverage-ledger.test.mjs
```

The final website-wide gate is intentionally owner-controlled and exact-head-bound because GitHub-hosted CI is unavailable under the current billing/spending limitation. It must cover the focused ledger regressions, TypeScript no-emit, production build, and `git diff --check` before this Draft PR is eligible to merge.
