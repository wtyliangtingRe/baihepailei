# Lite search index export

This document describes the first search-index export path for the Lite text-first site.

The generated search index is local output and should not be committed yet because it may contain real content.

## Output

Default output:

```text
public/search-index.json
```

This path is ignored by Git.

## Start Payload

In the first PowerShell:

```powershell
cd "D:\0GitHubtest\Baihepailei\_repo"

docker compose up -d postgres
pnpm dev
```

Leave this terminal running.

## Export published-only index

In a second PowerShell:

```powershell
cd "D:\0GitHubtest\Baihepailei\_repo"

pnpm export:lite-search -- --url "http://localhost:3000"
```

This only exports published documents visible to public readers.

## Export draft and published local index

During local development, most imported records may still be drafts. To export them, set the local Payload admin credentials and pass `--include-drafts`:

```powershell
$env:PAYLOAD_EXPORT_EMAIL="your-admin-email@example.com"
$env:PAYLOAD_EXPORT_PASSWORD="your-admin-password"

pnpm export:lite-search -- --url "http://localhost:3000" --include-drafts
```

The script also accepts the existing seed environment variables as fallbacks:

```powershell
$env:PAYLOAD_SEED_EMAIL="your-admin-email@example.com"
$env:PAYLOAD_SEED_PASSWORD="your-admin-password"
```

## Custom output

```powershell
pnpm export:lite-search -- `
  --url "http://localhost:3000" `
  --include-drafts `
  --out "D:\0GitHubtest\Baihepailei\_local_exports\search-index.json"
```

## Included collections

The exporter reads:

```text
works
creators
terms
rules
```

It skips documents where:

```text
isLiteVisible = false
```

When `--include-drafts` is not provided, it only exports:

```text
status = published
```

## Search document shape

Each item contains a compact normalized search document:

```json
{
  "id": "works:example-slug",
  "collection": "works",
  "typeLabel": "作品",
  "title": "Example",
  "slug": "example-slug",
  "url": "/works/example-slug",
  "rank": "A",
  "aliases": [],
  "legacyXWikiPage": "Main.作品.A级作品.Example.WebHome",
  "searchText": "..."
}
```

This is designed for the next frontend search PR.
