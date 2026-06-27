# Source import plan

This document describes the first external candidate import workflow for Baihepailei.

The first phase only prepares the workspace and rules. It does not fetch real source data, does not import candidates, and does not assign ratings.

## Goal

Build a repeatable path for increasing the candidate base of works, creators, and organizations while keeping public Baihepailei content curated and reviewable.

The first import pipeline should answer:

- What is the work?
- What media type is it?
- When was it first published, aired, or released?
- Who are the creators?
- Which organizations are involved?
- Which external sources refer to it?
- Is it a candidate for later Baihepailei review?

It should not answer:

- What final rank should this work receive?
- Is the work safe or unsafe?
- What do user comments say verbatim?
- Should the work be publicly visible immediately?

## Source registry

External sources are tracked in:

```text
tools/source_import/source_registry.example.json
```

Each source entry records:

- source key and name
- base URL
- intended fetch method
- allowed use
- restricted use
- public display policy
- license notes
- rate limit notes

Before adding a new source adapter, add or update its registry entry.

## Local data layout

All real fetched data should live under `data_local/`, which is ignored by Git.

For local development, `data_local/` may be a junction that points to a larger non-SSD data drive, for example:

```powershell
cmd /c mklink /J data_local E:\data\baihepailei\data_local
```

```text
data_local/
  raw/
    bangumi/
    anilist/
    vndb/
    wikidata/
    wikipedia/
  normalized/
    candidate-works.jsonl
    candidate-creators.jsonl
    candidate-organizations.jsonl
    source-claims.jsonl
  deduped/
    works.deduped.jsonl
    creators.deduped.jsonl
    organizations.deduped.jsonl
    conflicts.jsonl
  import_ready/
    payload-candidates.json
  reports/
    import-summary.md
    dedupe-conflicts.md
```

## Pipeline stages

### 1. Raw Source

Cache the source response or manual export without treating it as Baihepailei content.

Recommended wrapper:

```json
{
  "source": "bangumi",
  "sourceRecordId": "12345",
  "sourceUrl": "https://bgm.tv/subject/12345",
  "fetchedAt": "2026-06-27T00:00:00+08:00",
  "raw": {}
}
```

Raw Source files are local only.

### 2. Normalized Candidate

Convert source records into a common candidate shape.

Recommended work candidate fields:

```json
{
  "siteId": null,
  "title": "",
  "originalTitle": "",
  "aliases": [],
  "mediaType": "unknown",
  "format": "unknown",
  "firstPublishedAt": null,
  "firstPublishedPrecision": "unknown",
  "firstPublishedLabel": "",
  "externalIds": {},
  "candidateSources": [],
  "yuriCandidateScore": null,
  "status": "draft",
  "reviewStatus": "pending",
  "evidenceStrength": "unassessed"
}
```

### 3. Dedupe and conflict report

Candidate dedupe should prefer stable identifiers first:

1. `siteId`
2. trusted external IDs
3. normalized title/name plus media type and date context
4. slug

Low-confidence matches should go to a conflict report instead of being merged automatically.

### 4. Payload draft seed

Candidate imports should default to draft/unreviewed values:

```text
rank = unknown
reviewStatus = pending
evidenceStrength = unassessed
status = draft
hasEvidence = false
isLiteVisible = false
isFullVisible = false
```

First imports should stay out of public frontend views until reviewed.

### 5. Payload candidate import

Candidate import-ready files can contain only `works`:

```json
{
  "works": []
}
```

Use `--collections works` to avoid requiring legacy clean seed collections such as rules, terms, and creators.

Dry-run first:

```powershell
node scripts/import/direct-seed-clean-data.mjs --file "E:\data\baihepailei\data_local\import_ready\bangumi-yuri-tagged.payload.json" --collections works --dry-run
```

Real import requires a local Payload server and seed user credentials:

```powershell
$env:PAYLOAD_SEED_EMAIL="you@example.com"
$env:PAYLOAD_SEED_PASSWORD="your-password"

node scripts/import/direct-seed-clean-data.mjs --file "E:\data\baihepailei\data_local\import_ready\bangumi-yuri-tagged.payload.json" --url "http://localhost:3000" --collections works --update-existing
```

Existing work match priority for candidate imports:

1. `siteId`
2. external IDs such as `externalIds.bangumiSubjectId`, `externalIds.anilistMediaId`, `externalIds.vndbId`, `externalIds.wikidataQid`
3. `slug`
4. `title + mediaType + firstPublishedLabel`

Imported candidates remain draft, hidden, pending review, and unrated unless the seed explicitly says otherwise.

## Source notes

### Bangumi

Use as a high-value source for Chinese titles, aliases, tags, and subject links. Do not publicly republish user comment text. Use source links and derived summaries only.

### AniList

Use as a structured source for anime and manga metadata, staff, studios, genres, and tags.

### VNDB

Use as a structured source for visual novels, producers, staff, tags, and traits.

### Wikidata

Use for open structured metadata, external IDs, aliases, and cross-source alignment.

### Wikipedia

Use mostly as seed lists and source links. Avoid copying long article text into records.

## Future PRs

Suggested next PRs:

1. Frontend display for media type and first publication date.
2. Additional external adapters such as AniList, VNDB, and Wikidata.
3. Review workflow improvements for candidate acceptance and publication.
