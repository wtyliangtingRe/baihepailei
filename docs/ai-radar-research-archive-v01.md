# AI Radar research archive v0.1

This workflow stores the complete 25,048-row research plan in a dedicated internal Payload collection.

It intentionally does **not** treat partial or insufficient research as a public rating and does not modify `Works.rank`.

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

## Local run

Create and verify a fresh database checkpoint before switching to this branch and restarting Payload.

```powershell
Set-Location "D:\0GitHubtest\Baihepailei"

git fetch origin
git switch wm-ai-radar-research-archive-v01
git pull --ff-only origin wm-ai-radar-research-archive-v01

pnpm generate:types
pnpm generate:importmap
node --test tests/ai-radar-research-records.test.mjs
```

Restart the local server so Payload registers the new collection, then run the dry-run:

```powershell
node scripts/radar/import-ai-radar-research-records-v01.mjs `
  --url http://localhost:3000
```

Expected first dry-run:

```text
sourceBatches: 354
sourceRows: 25048
planCounts.would_create: 25048
planCounts.blocked: 0
researchCollectionWrite: false
worksWrite: false
```

Apply only after reviewing `summary.json` and `blocked.jsonl`:

```powershell
node scripts/radar/import-ai-radar-research-records-v01.mjs `
  --url http://localhost:3000 `
  --apply `
  --confirm IMPORT-AI-RADAR-RESEARCH-25048
```

A successful final verification reports:

```text
finalCounts.already_current: 25048
finalCounts.would_create: 0
finalCounts.would_update: 0
finalCounts.blocked: 0
```

Outputs are written under:

```text
data_local/staging/ai-radar/research-records-import-v01
```

Keep the database checkpoint and write journals until final verification is complete.
