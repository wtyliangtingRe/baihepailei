# Source download preflight runbook

This runbook is the final local-only checkpoint before downloading real external source data for Baihepailei candidate imports.

It does not download data, import data, publish candidates, or change runtime behavior.

## Scope

Use this checklist before the first real source fetch from Bangumi, AniList, VNDB, Wikidata, Wikipedia, or manual exports.

The first source download should stay conservative:

- small sample only
- metadata and aggregate signals only
- no public candidate visibility
- no copied user comments
- no raw source files in Git
- no automatic Baihepailei rating decisions

Candidate source data is only a review queue input. It must not be treated as final rank, evidence strength, review status, or publication approval.

## Local data root

Recommended real data location on Windows:

```text
E:\data\baihepailei\data_local
```

Recommended repository location:

```text
D:\0GitHubtest\Baihepailei\_repo\data_local
```

The repository path should be a local junction pointing to the real E: drive location.

## Create local directories

Run from PowerShell:

```powershell
$Repo = "D:\0GitHubtest\Baihepailei\_repo"
$DataRoot = "E:\data\baihepailei\data_local"

$dirs = @(
  "$DataRoot",
  "$DataRoot\raw",
  "$DataRoot\raw\bangumi",
  "$DataRoot\raw\anilist",
  "$DataRoot\raw\vndb",
  "$DataRoot\raw\wikidata",
  "$DataRoot\raw\wikipedia",
  "$DataRoot\normalized",
  "$DataRoot\deduped",
  "$DataRoot\import_ready",
  "$DataRoot\reports",
  "$DataRoot\archive"
)

foreach ($dir in $dirs) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

Set-Location $Repo

if (-not (Test-Path ".\data_local")) {
  cmd /c mklink /J data_local "$DataRoot"
} else {
  Write-Host "data_local already exists. Not touching it." -ForegroundColor Yellow
}
```

## Git safety checks

Run from the repository root:

```powershell
git check-ignore -v data_local/
git status --ignored --short data_local
```

Expected result:

```text
.gitignore:<line>:data_local/    data_local/
!! data_local
```

Do not continue if `data_local/` is not ignored.

Also check that no real exports or raw files are staged:

```powershell
git status --short
```

Stop if the status output includes real source dumps, generated payload seeds, `.env` files, tokens, SQL dumps, archives, or generated frontend indexes.

## Required local tests before fetch

Run these local tests before the first real download:

```powershell
pnpm test:source-import
pnpm test:source-bangumi
pnpm test:source-bangumi-fetch
pnpm test:source-dedupe-report
pnpm test:payload-candidate-import
pnpm test:payload-preview-report
pnpm test:media-groups
```

Stop if any test fails.

## First Bangumi smoke download

The first real fetch should be deliberately small. This is a smoke test for the local-only workflow, not a real expansion run.

```powershell
pnpm source:fetch:bangumi -- `
  --tags "百合" `
  --types "2" `
  --limit 5 `
  --pages 1 `
  --delay-ms 1500 `
  --out "E:\data\baihepailei\data_local\raw\bangumi\bangumi-yuri-smoke.jsonl" `
  --report "E:\data\baihepailei\data_local\reports\bangumi-yuri-smoke-summary.json"
```

Expected outputs:

```text
E:\data\baihepailei\data_local\raw\bangumi\bangumi-yuri-smoke.jsonl
E:\data\baihepailei\data_local\reports\bangumi-yuri-smoke-summary.json
```

After the smoke fetch, run the Git safety checks again.

## Normalize smoke data

```powershell
pnpm source:normalize:bangumi -- `
  --in "E:\data\baihepailei\data_local\raw\bangumi\bangumi-yuri-smoke.jsonl" `
  --out "E:\data\baihepailei\data_local\normalized\bangumi-yuri-smoke.candidate-works.jsonl"
```

## Dedupe and conflict report

```powershell
pnpm source:dedupe -- `
  --in "E:\data\baihepailei\data_local\normalized\bangumi-yuri-smoke.candidate-works.jsonl" `
  --out "E:\data\baihepailei\data_local\deduped\bangumi-yuri-smoke.works.deduped.jsonl" `
  --conflicts "E:\data\baihepailei\data_local\deduped\bangumi-yuri-smoke.conflicts.jsonl" `
  --report "E:\data\baihepailei\data_local\reports\bangumi-yuri-smoke-dedupe.md"
```

Review the conflict report before converting to a Payload seed. Low-confidence matches should stay unresolved instead of being merged automatically.

## Build Payload candidate seed

```powershell
pnpm source:to-payload -- `
  --in "E:\data\baihepailei\data_local\deduped\bangumi-yuri-smoke.works.deduped.jsonl" `
  --out "E:\data\baihepailei\data_local\import_ready\bangumi-yuri-smoke.payload.json"
```

The generated candidate seed must keep imported works as draft, hidden, pending, unassessed, and unrated unless a later human review explicitly changes them.

## Generate preview report

```powershell
pnpm source:report:payload -- `
  --in "E:\data\baihepailei\data_local\import_ready\bangumi-yuri-smoke.payload.json" `
  --out "E:\data\baihepailei\data_local\reports\bangumi-yuri-smoke-payload-preview.md"
```

Before import, review the preview report and confirm:

- all works are `draft`
- `isLiteVisible` is false
- `isFullVisible` is false
- no candidate is treated as a final Baihepailei rating
- duplicate titles, aliases, and source IDs look reasonable
- localized titles are candidate metadata only and still need review

## Dry-run import only

Run a dry-run before any real local import:

```powershell
node scripts/import/direct-seed-clean-data.mjs `
  --file "E:\data\baihepailei\data_local\import_ready\bangumi-yuri-smoke.payload.json" `
  --collections works `
  --dry-run
```

Do not run a real import until the dry-run and preview report are both acceptable.

## Real local import gate

Only after the smoke workflow passes, run a real import against a local Payload server:

```powershell
$env:PAYLOAD_SEED_EMAIL="you@example.com"
$env:PAYLOAD_SEED_PASSWORD="your-password"

node scripts/import/direct-seed-clean-data.mjs `
  --file "E:\data\baihepailei\data_local\import_ready\bangumi-yuri-smoke.payload.json" `
  --url "http://localhost:3000" `
  --collections works `
  --update-existing
```

After import, export the Lite and detail indexes only when needed for local frontend review. Generated indexes remain local-only.

## Stop conditions

Stop immediately if any of these happen:

- `data_local/` is not ignored by Git
- raw data appears in `git status`
- generated Payload seed files appear in `git status`
- frontend generated indexes appear in `git status`
- source data includes copied user comment text
- candidates become Lite-visible or Full-visible by default
- candidate tags are being interpreted as final Baihepailei rankings
- dedupe produces surprising merges
- dry-run import creates unexpected collection changes

## What not to do before the smoke test passes

Do not:

- run full-source fetches
- fetch or store user comment text for public use
- import candidates directly into public fields
- submit raw source data, generated import files, or reports with real data to GitHub
- edit old XWiki backups
- delete old backups
- turn candidate source tags into final review decisions

## Next step after a successful smoke test

If the Bangumi smoke workflow passes, the next safe expansion is a slightly larger Bangumi run using the default tags and media types, still writing only to `data_local/` and still requiring preview report plus dry-run before any import.
