# AI radar apply recovery v0.1

This recovery path addresses the interrupted first-100 AI radar write attempt.

## Incident state

The first request updated work `3739` (`伊王野女王的爱情`) but the old verifier treated two Payload representation details as data differences:

- `2026-07-13T00:00:00+08:00` and `2026-07-12T16:00:00Z` represent the same instant;
- Payload adds internal `id` values to array rows such as `matchedRules`.

The business fields were written correctly. The remaining 93 eligible rows stayed at their original reviewed snapshots. Six protected rows remain blocked.

## Semantic comparison fix

Payload comparison now:

- ignores generated nested `id` values;
- canonicalizes `radarAssessment.assessedAt` to an ISO UTC instant before comparison.

This allows the already-written first row to be classified as `already_applied` instead of partial drift.

## One-shot recovery executor

`pnpm radar:resume-first100` is intentionally bound to this incident. It requires exactly:

```text
100 plan rows
94 originally eligible rows
6 protected rows
1 semantically already applied row
93 rows still at their exact original snapshots
0 unsafe or drifted rows
```

The command requires:

- a fresh database checkpoint bound to the current branch and commit;
- the exact plan-derived approval token;
- `--execute`;
- the exact confirmation `RESUME-AI-RADAR-FIRST-100-93-PATCHES`.

For every remaining row it:

1. refetches and validates the original snapshot;
2. persists rollback intent before PATCH;
3. sends one minimal PATCH;
4. verifies semantic equality with retry delays;
5. stops immediately on the first failure.

Every run uses an isolated evidence directory under ignored `data_local`.

## Gate duration for future batches

The normal local arm flow now defaults to 120 minutes and allows up to 720 minutes. Expiry is checked before an execution starts; it does not interrupt a sequential execution already in progress.

## Safety

```text
direct PostgreSQL writes: false
creates works: false
deletes works: false
automatic rollback: false
resume scope broadening: forbidden
```
