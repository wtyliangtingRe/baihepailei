# Import pipeline

The old XWiki backup should not be imported directly into Payload.

The safer migration path is:

```text
old XWiki backup
-> audit CSV / clean export
-> staged JSON
-> manual review
-> optional Payload import
```

## Why staged JSON

The old site contains useful content, system pages, user pages, and private or irrelevant metadata. Staged JSON gives us a checkpoint before anything is written into the new database.

## Expected local folders

```text
D:\0GitHubtest\Baihepailei\old_data
D:\0GitHubtest\Baihepailei\_audit_out
D:\0GitHubtest\Baihepailei\_clean_export
D:\0GitHubtest\Baihepailei\_repo\data\staging
D:\0GitHubtest\Baihepailei\_repo\data\seeds
```

`old_data`, `_audit_out`, `_clean_export`, `data/staging/*.json`, and `data/seeds/*.json` should remain local unless explicitly reviewed and sanitized.

## Stage old content

Example:

```powershell
cd "D:\0GitHubtest\Baihepailei\_repo"

pnpm import:xwiki:stage -- `
  --index "D:\0GitHubtest\Baihepailei\_clean_export\clean_export_index.csv" `
  --pages-dir "D:\0GitHubtest\Baihepailei\_clean_export\pages" `
  --out "D:\0GitHubtest\Baihepailei\_repo\data\staging\xwiki-staged.json"
```

The staging script classifies old pages by XWiki full name:

| Old page pattern | New staged bucket |
|---|---|
| `Main.作品.*` | `works` |
| `Main.创作者.*` | `creators` |
| `名词解释.*` | `terms` |
| `排雷原则.*` | `rules` |
| other pages | `rawPages` |

## Review

Open the generated JSON and review it before importing. This is where we remove system leftovers, private fragments, irrelevant old pages, or malformed entries.

## Dry run Payload import

```powershell
pnpm import:xwiki:seed -- `
  --file "D:\0GitHubtest\Baihepailei\_repo\data\staging\xwiki-staged.json" `
  --url "http://localhost:3000" `
  --dry-run
```

## Real Payload import

Start Payload first:

```powershell
docker compose up -d postgres
pnpm dev
```

In another terminal:

```powershell
$env:PAYLOAD_SEED_EMAIL="your-admin-email@example.com"
$env:PAYLOAD_SEED_PASSWORD="your-admin-password"

pnpm import:xwiki:seed -- `
  --file "D:\0GitHubtest\Baihepailei\_repo\data\staging\xwiki-staged.json" `
  --url "http://localhost:3000"
```

## Current limitations

- Relationship fields are intentionally skipped in the first import pass.
- Media attachments are not imported yet.
- Rich text is converted to a simple Lexical paragraph that preserves the raw old page text.
- Slugs are generated automatically and may need manual cleanup.
- Duplicate detection is minimal; repeated imports may create duplicates.

These limitations are intentional for the first migration bridge. Later PRs can add relationship resolution, attachment import, duplicate handling, and better XWiki syntax conversion.
