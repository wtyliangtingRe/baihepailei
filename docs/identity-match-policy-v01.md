# Identity Match Policy v0.1

This document defines the first conservative identity matching policy for the catalog pipeline.

## Scope

- Documentation only.
- Local preview and review only.
- No Payload write.
- No PostgreSQL write.
- No importer action.
- No deletion.
- No automatic production change.

## Core rules

1. Same title is not enough to confirm same identity.
2. Source IDs and official external IDs are stronger than normalized title.
3. Existing Payload Works must not be structurally changed without manual review.
4. Work, child entity, edition, release, and source record boundaries must stay visible.
5. Conflicting evidence must remain visible in review output.
6. Radar grade, adult visibility, relationship labels, and AI notes are not identity proof.
7. All v0.1 identity outputs are review-only.
8. `applyAllowed` must be false for all v0.1 rows.

## Evidence levels

| Level | Meaning | Handling |
|---|---|---|
| strong | stable source ID, official URL, trusted external ID | high-confidence review candidate |
| medium | title plus media type, creator, year, or graph support | review candidate |
| weak | normalized title only, partial title, shared keyword | title-only review candidate |
| conflict | multiple possible Works, boundary mismatch, source ID conflict | priority review |

## Candidate classes

| Class | Meaning |
|---|---|
| auto_identity_evidence | evidence can be recorded locally |
| strong_match_candidate | strong evidence agrees; still preview-only |
| review_match_candidate | useful evidence exists; human review needed |
| weak_title_only_candidate | mostly title evidence; never automatic |
| identity_conflict | conflict is present; priority review |

## Score rules

- Title-only evidence must never become strong.
- Any conflict blocks strong classification.
- Boundary-crossing candidates stay review-only.
- Existing Payload Works are never confirmed by title only.

## Known current case

The Work Graph queue contains four `possible_duplicate_identity` rows for `雨眠`.

Policy:

- Do not combine by title only.
- Preserve all source rows.
- Compare source IDs, URLs, media type, aliases, and existing Payload Work IDs.
- Route to manual review.

## Expected next artifacts

B2 should build local identity evidence files under:

- `data_local/staging/identity/identity-evidence-v01.jsonl`
- `data_local/staging/identity/identity-evidence-v01-summary.json`
- `data_local/staging/identity/identity-evidence-v01.md`

B3 should build local candidate files under:

- `data_local/staging/identity/identity-match-candidates-v01.jsonl`
- `data_local/staging/identity/identity-match-groups-v01.jsonl`
- `data_local/staging/identity/identity-match-candidates-v01-summary.json`
- `data_local/staging/identity/identity-match-candidates-v01.md`

## B-series safety requirements

B-series v0.1 scripts must be:

- read-only
- local staging only
- no Payload write
- no PostgreSQL write
- no importer action
- no deletion
- no automatic production change
- no `data_local` output committed

## Next steps

1. Build identity evidence index.
2. Score identity candidates.
3. Audit identity candidates.
4. Combine graph and identity queues for manual review.
