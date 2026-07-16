# AI Radar research archive v0.1

This workflow stores the complete 25,048-row research plan in a dedicated internal Payload collection.

It intentionally does **not** treat partial or insufficient research as a public rating and does not modify `Works.rank` during the full archive import.

## Collection

`radar-research-records`

Each record is keyed by:

```text
research-program-20260715-155148|workId|siteId
```

The collection preserves:

- exact Work relationship and identity snapshots;
- research program, batch, wave, lane and milestone;
- research status;
- blocked-lane grade range and unresolved questions;
- catalog yuri relevance and risk signals;
- source summary and traceable links;
- confidence and recommended next queue/action;
- source response SHA-256.

Read/create/update/delete access is restricted to trusted users and above. The collection has no public access path.

## Safety

The importer:

- verifies 354 installed batch responses against `completion-manifest.json`;
- requires exactly 25,048 unique research keys;
- reads all current Works and requires exact `workId + siteId` identity agreement;
- never updates, creates or deletes Works;
- defaults to dry-run;
- writes only `radar-research-records` with an explicit apply confirmation;
- journals every intended write;
- re-reads and semantically verifies every create/update;
- is idempotent and can safely resume after a partial stop;
- performs no direct PostgreSQL write and no automatic rollback.

Write normalization includes:

- numeric relationship IDs for Payload;
- omission of empty optional select fields;
- UTC timestamp normalization before semantic verification;
- normalization of Payload-generated array IDs and expanded relationship objects.

## Completed import

Program:

```text
research-program-20260715-155148
```

Manifest:

```text
batches: 354
rows: 25048
manifest SHA-256: 1291d9c25f501b983ca7ddd885cfb58c6b0b3ed52a97a5d677f24c04dc7371f3
```

Successful apply:

```text
pre-existing current records: 1
created and read-back verified: 25047
final already_current: 25048
final blockers: 0
Works writes: false
direct PostgreSQL writes: false
```

Apply output:

```text
D:\0GitHubtest\Baihepailei\data_local\staging\ai-radar\research-records-import-v04-20260716-121820
```

Final independent dry-run verification:

```text
existingResearchRecordsRead: 25048
planCounts.already_current: 25048
planCounts.would_create: 0
planCounts.would_update: 0
planCounts.blocked: 0
complete: true
```

Regression validation:

```text
node tests: 5 passed, 0 failed
TypeScript: passed
```

## Database recovery point

Preferred post-import checkpoint:

```text
D:\Baihepailei-backups\Baihepailei-20260716-135829
payload-postgresql.dump SHA-256: fff0484eceafc908c79ad791be9ae303e0c4197fabc8c8fca03e0bf623353294
pg_restore archive entries: 882
PostgreSQL: 17.10
restore-list verification: passed
```

Keep this checkpoint and the successful import journals until the website phase has been deployed and independently backed up.

## Local verification

Use the formal batches directory so backup snapshots are not discovered as duplicate response files:

```powershell
Set-Location "D:\0GitHubtest\Baihepailei"

node scripts\radar\import-ai-radar-research-records-v01.mjs `
  --url "http://localhost:3000" `
  --program "D:\Baihepailei-analysis\research-program-20260715-155148\batches"
```

Expected current result:

```text
sourceBatches: 354
sourceRows: 25048
existingResearchRecordsRead: 25048
planCounts.already_current: 25048
blockers: 0
researchCollectionWrite: false
worksWrite: false
complete: true
```

## Apply command

Apply is normally no longer required for this completed program. For recovery or a clean database rebuild, create and verify a fresh database checkpoint first, then use:

```powershell
node scripts\radar\import-ai-radar-research-records-v01.mjs `
  --url "http://localhost:3000" `
  --program "D:\Baihepailei-analysis\research-program-20260715-155148\batches" `
  --apply `
  --confirm "IMPORT-AI-RADAR-RESEARCH-25048"
```

A successful final verification requires:

```text
finalCounts.already_current: 25048
finalCounts.would_create: 0
finalCounts.would_update: 0
finalCounts.blocked: 0
```

## Project boundary

- Do not bulk-copy proposed research grades into `Works.rank`.
- Do not publish partial or insufficient research as a confirmed rating.
- Do not overwrite human-verified data.
- Do not match Works by title alone.
- Keep `radar-research-records` internal-only.

The website-phase handoff is documented in:

```text
docs/PROJECT_HANDOFF_WEBSITE_2026-07-16.md
```
