# AI radar full-catalog preparation v0.1

The first reviewed batch is complete:

```text
100 reviewed plan rows
94 AI radar assessments applied and semantically verified
6 protected rows left unchanged
0 drifted rows
0 fetch errors
```

This document defines the next stage: accounting for every current Work and preparing deterministic, resumable queues. This stage is read-only.

## Why the full catalog is queued instead of written at once

The current Payload catalog contains tens of thousands of Works with very different evidence quality and identity confidence. Treating all rows as one batch would mix:

- already assessed rows;
- human-reviewed or locked rows;
- identity and exact-summary anomalies;
- rows with enough local evidence;
- rows that require external research.

The catalog preparation stage therefore assigns every Work to exactly one queue before any new assessment or write workflow is designed.

## One-command preparation

```powershell
pnpm radar:prepare-catalog -- --url http://localhost:3000
```

A smoke run can use:

```powershell
pnpm radar:prepare-catalog -- --url http://localhost:3000 --limit 500
```

The command performs these read-only stages:

1. builds evidence packets from Payload Works;
2. audits missing summaries, series families and source records;
3. isolates exact-summary duplicates across different identities;
4. classifies every row into one catalog queue;
5. writes deterministic, series-aware batch files and SHA-256 manifests.

## Queues

```text
ready_for_ai_assessment
external_research
identity_review
already_ai_assessed
protected_or_manual_review
invalid_record
unclassified
```

`already_ai_assessed` includes the completed first batch and future rows carrying the AI radar marker.

`protected_or_manual_review` includes human-reviewed, disputed, deprecated, locked, human-verified or explicitly manual records.

`identity_review` includes series outliers, exact-summary duplicates and identity-related review reasons. These rows are never mixed into normal automatic assessment batches.

## Default batch sizes

```text
ready AI assessment: 250 rows
external research:    100 rows
identity review:      100 rows
```

The splitter keeps a normal series family together even when doing so makes a batch slightly larger than its target size.

Batch sizes can be changed during preparation:

```powershell
pnpm radar:prepare-catalog -- `
  --url http://localhost:3000 `
  --batch-size 500 `
  --research-batch-size 150 `
  --identity-batch-size 100
```

The initial recommendation is 250 assessment rows. Increase to 500 only after several generalized batches complete without recovery incidents.

## Outputs

```text
data_local/staging/ai-radar/catalog-v01/
  raw/
  audit/
  queue/
    catalog-inventory-v01.jsonl
    catalog-ready-for-ai-assessment-v01.jsonl
    catalog-external-research-v01.jsonl
    catalog-identity-review-v01.jsonl
    catalog-already-ai-assessed-v01.jsonl
    catalog-protected-or-manual-review-v01.jsonl
    catalog-batch-manifest-v01.json
    catalog-queue-summary-v01.json
    batches/
```

The summary must report:

```text
rowsRead == inventoryRows == accountedRows
allRowsAccountedFor: true
payloadWrite: false
payloadPatchRequests: 0
```

## Next implementation stage

After the real catalog distribution is known, the first-100-specific workflow will be generalized to accept:

- arbitrary batch IDs;
- arbitrary reviewed row counts;
- batch-specific plan hashes and approval tokens;
- resumable status ledgers;
- unique evidence directories;
- semantic post-write verification;
- no fixed 100 / 94 / 6 constants.

No full-catalog write should use the incident-bound `radar:resume-first100` command.

## Resume directory fix

`radar:resume-first100` now runs through a safety wrapper that creates its ignored evidence root before invoking the incident-bound resume script. This permanently addresses the missing-parent-directory failure seen during the completed first batch.

## Safety

```text
Payload read: yes, unless --file is used
Payload write: no
Payload PATCH requests: 0
PostgreSQL writes: 0
Work creation: no
Work deletion: no
credentials exported: no
```
