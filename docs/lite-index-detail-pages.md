# Lite index detail pages

This PR adds the first lightweight detail pages for search results.

The pages read from:

```text
public/search-index.json
```

They do not query Payload directly yet. This keeps the Lite public frontend simple and lets search-result links stop returning 404 while the full content pages are still being designed.

## Routes

```text
/works/[slug]
/creators/[slug]
/terms/[slug]
/rules/[slug]
```

## Local test flow

1. Start the site:

```powershell
cd "D:\0GitHubtest\Baihepailei\_repo"

docker compose up -d postgres
pnpm dev
```

2. Generate the search index in another PowerShell:

```powershell
cd "D:\0GitHubtest\Baihepailei\_repo"

$env:PAYLOAD_SEED_EMAIL="your-admin-email@example.com"
$env:PAYLOAD_SEED_PASSWORD="your-admin-password"

pnpm export:lite-search -- --url "http://localhost:3000" --include-drafts
```

3. Open search:

```text
http://localhost:3000/search
```

4. Click any result.

## Current scope

The detail pages show:

- title
- collection type
- rank or category
- aliases
- original title
- creator names
- tags and warnings when available
- legacy XWiki page
- Lite search text preview

## Later upgrades

Future PRs can replace or enrich these pages with Payload-backed full body rendering:

- rich text content
- related works and creators
- media sections
- full archive links
