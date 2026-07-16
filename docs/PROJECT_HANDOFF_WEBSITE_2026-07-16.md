# Baihepailei website phase handoff — 2026-07-16

This document is the durable handoff from the AI Radar research/import phase to the website implementation phase.

## 1. Repository state

- Repository: `wtyliangtingRe/baihepailei`
- Website base branch: `wm-ai-radar-v06-generalized-release-v01`
- Research archive branch: `wm-ai-radar-research-archive-v01`
- Research archive PR: `#262 Archive all 25,048 AI Radar research rows internally`
- PR head before this document commit: `a8532528ea69cbe47c71653d8e3ff77c1e238a7a`
- The PR was still open and not merged at handoff time.
- GitHub reported `mergeable: false` at the last check. Inspect the PR UI and resolve that state before merging.

**Important:** do not begin website work that depends on `radar-research-records` from the base branch until PR #262 has been merged, or until the website branch is explicitly based on `wm-ai-radar-research-archive-v01`.

## 2. Completed data work

### 2.1 Research program

- Program ID: `research-program-20260715-155148`
- Import batch: `ai-radar-research-complete-v01`
- Batches: `354`
- Total rows: `25,048`
- Manifest SHA-256: `1291d9c25f501b983ca7ddd885cfb58c6b0b3ed52a97a5d677f24c04dc7371f3`
- Aggregate research package SHA-256: `7a27a519be5d5c81792a4fb09ac983aa9e93ed4e209ce189a15d8e5f5d05b9e0`

Record shapes:

- blocked research rows: `1,441`
- catalog triage rows: `23,607`

Research status totals:

- `resolved`: `13`
- `partial`: `24,561`
- `insufficient`: `474`

Blocked-row next actions:

- `promote_for_reassessment`: `13`
- `retain_block`: `1,424`
- `human_review`: `2`
- `identity_review`: `2`

Catalog next queues:

- `full_assessment`: `2,797`
- `more_research`: `3,228`
- `low_priority`: `17,582`

### 2.2 Approved 13-row promotion

The 13 resolved rows were promoted only as internal pending review data in `Works`.

Only these fields were changed:

- `rank`
- `reviewReasons`
- `evidenceNote`

Safety state remained:

- `status`: draft
- `reviewStatus`: pending
- rating notice: AI synthesized / pending review
- no public publication

Apply session:

```text
D:\0GitHubtest\Baihepailei\data_local\staging\ai-radar\research-promote-apply-v01\apply-20260716-021933
```

### 2.3 Full internal archive import

A dedicated internal Payload collection now stores all 25,048 research rows:

```text
radar-research-records
```

Final apply result:

- pre-existing current records: `1`
- newly created and read-back verified: `25,047`
- final `already_current`: `25,048`
- final blockers: `0`
- Works writes: `false`
- direct PostgreSQL writes: `false`

Successful apply output:

```text
D:\0GitHubtest\Baihepailei\data_local\staging\ai-radar\research-records-import-v04-20260716-121820
```

Final independent dry-run verification:

```text
existingResearchRecordsRead: 25048
planCounts.already_current: 25048
would_create: 0
would_update: 0
blocked: 0
complete: true
```

## 3. Internal collection format

Collection slug:

```text
radar-research-records
```

Access:

- create/read/update/delete: `trustedAndUp`
- no public read path

Identity and provenance:

- `researchKey` — unique `programId|workId|siteId`
- `title` — title snapshot
- `programId`
- `importBatch`
- `batchId`
- `wave`
- `lane`
- `milestone`
- `work` — relationship to `works`
- `workIdSnapshot`
- `workSiteId`
- `sourceResponseSha256`
- `importedAt`
- `recordStatus`

Research content:

- `recordShape` — `blocked` or `catalog`
- `researchStatus`
- `sourceSummary`
- `sources[]`
- `confidencePercent`
- `researchNote`

Blocked-row fields:

- `proposedLikelyGrade`
- `proposedBestGrade`
- `proposedWorstGrade`
- `unresolvedQuestions[]`
- `recommendedNextAction`

Catalog-row fields:

- `yuriRelevance`
- `riskSignals[]`
- `recommendedNextQueue`

Known risk signal values:

- `male_involvement`
- `ntr`
- `futa`
- `otokonoko`
- `ts`
- `prior_male_relationship`
- `abo`
- `other`

## 4. Importer guarantees and fixes

Importer:

```text
scripts/radar/import-ai-radar-research-records-v01.mjs
```

Tests:

```text
tests/ai-radar-research-records.test.mjs
```

Guards:

- verifies all 354 response hashes against the completion manifest;
- requires exactly 25,048 unique research keys;
- requires exact `workId + siteId` agreement;
- never title-matches identities;
- dry-run by default;
- apply requires exact confirmation `IMPORT-AI-RADAR-RESEARCH-25048`;
- journals intended writes;
- reads every created/updated record back and semantically verifies it;
- is idempotent and resumable;
- never creates, updates or deletes Works;
- never writes PostgreSQL directly.

Production-tested normalization fixes:

1. Payload relationship IDs are sent as numbers rather than numeric strings.
2. Empty optional select fields are omitted from POST/PATCH bodies.
3. Equivalent UTC timestamps are normalized before semantic comparison.
4. Payload-generated array IDs and expanded relationship objects are ignored by semantic drift checks.

Regression suite at handoff:

```text
tests: 5
pass: 5
fail: 0
TypeScript: pass
```

## 5. Database checkpoints

Pre-full-import checkpoint:

```text
D:\Baihepailei-backups\Baihepailei-20260716-105331
SHA-256: 743e6e0410d8c0ed6e3ba48d5a58ff068d8c7db537f61cb35e931cd9cf97f804
```

Post-full-import checkpoint — preferred recovery point:

```text
D:\Baihepailei-backups\Baihepailei-20260716-135829
Dump: payload-postgresql.dump
SHA-256: fff0484eceafc908c79ad791be9ae303e0c4197fabc8c8fca03e0bf623353294
Archive entries: 882
Verification method: docker_pg_restore
PostgreSQL: 17.10
```

Keep the post-import checkpoint and the successful import output directory until the website phase has been deployed and independently backed up.

## 6. Safety boundaries that must remain true

- Research rows are internal evidence/triage, not public ratings.
- Never bulk-copy all 25,048 proposed values into `Works.rank`.
- Never publish `partial` or `insufficient` research as a confirmed rating.
- Never replace human-verified data with automated suggestions.
- Never match a Work by title alone.
- Public pages must continue to use confirmed/public visibility rules.
- The new collection must remain inaccessible to unauthenticated public users.
- Website filters may expose aggregate workflow state to trusted staff, but should not leak internal notes or source-review uncertainty publicly.

## 7. Recommended website phase

### Phase A — merge and baseline

1. Resolve the mergeability state of PR #262.
2. Merge PR #262 into `wm-ai-radar-v06-generalized-release-v01`.
3. Pull the merged base branch locally.
4. Run `pnpm generate:types`, tests and TypeScript checks.
5. Start all website work from the merged base or a new branch based on it.

### Phase B — internal review workbench

Highest-value first UI:

- collection navigation for `radar-research-records`;
- filters for `researchStatus`, `recordShape`, `recommendedNextAction`, `recommendedNextQueue`, `riskSignals`, confidence and lane;
- direct navigation from a research record to its linked Work;
- clear badges distinguishing research status from formal rating status;
- compact source and unresolved-question panels;
- default sort that surfaces `promote_for_reassessment`, `human_review` and `identity_review` first.

Suggested priority views:

1. `promote_for_reassessment` — 13 rows
2. `human_review` — 2 rows
3. `identity_review` — 2 rows
4. `full_assessment` — 2,797 rows
5. `more_research` — 3,228 rows
6. `retain_block` and `low_priority` after the higher-value queues

### Phase C — public website integration

Public pages should only consume formal, approved Work fields. The internal archive can support staff decisions, but should not be rendered as a public verdict.

Possible later public-facing additions after human approval:

- clearer evidence summaries;
- rating confidence/explanation components;
- preference-profile warnings;
- audit-friendly change history;
- separate labels for confirmed rating, pending review and insufficient evidence.

## 8. Quick next-session verification

```powershell
Set-Location "D:\0GitHubtest\Baihepailei"

git fetch origin
git status --short

git ls-remote origin refs/heads/wm-ai-radar-research-archive-v01
```

For database verification while the research archive schema is available:

```powershell
node scripts\radar\import-ai-radar-research-records-v01.mjs `
  --url "http://localhost:3000" `
  --program "D:\Baihepailei-analysis\research-program-20260715-155148\batches"
```

Expected:

```text
existingResearchRecordsRead: 25048
already_current: 25048
blocked: 0
complete: true
```

## 9. Concise handoff statement

The research phase is complete. All 25,048 rows are stored in an internal-only, identity-safe, idempotently imported Payload collection; 13 resolved rows remain internal pending Work ratings; final read-back verification and a post-import database checkpoint both passed. The next project milestone is to merge PR #262 and build the staff-facing website review workflow without weakening public visibility or human-review boundaries.
