# Direct clean data seed

This is the simple import path for the small reviewed old-site dataset.

It reads a local `payload_seed_direct_v2_clean.json` file and writes the documents directly into the local Payload CMS database through the REST API.

The seed JSON is **not committed** because it contains real old-site content.

## Expected local file

Download or place the cleaned seed at:

```text
D:\0GitHubtest\Baihepailei\_clean_real_data\payload_seed_direct_v2_clean.json
```

Expected counts:

```text
rules: 2
terms: 6
creators: 2
works: 11
```

## Start Payload

In the first PowerShell:

```powershell
cd "D:\0GitHubtest\Baihepailei\_repo"

docker compose up -d postgres
pnpm dev
```

Leave this terminal running.

## Dry run

In a second PowerShell:

```powershell
cd "D:\0GitHubtest\Baihepailei\_repo"

pnpm import:clean-seed -- `
  --file "D:\0GitHubtest\Baihepailei\_clean_real_data\payload_seed_direct_v2_clean.json" `
  --url "http://localhost:3000" `
  --dry-run
```

## Real import

Set your local Payload admin login in the second PowerShell:

```powershell
$env:PAYLOAD_SEED_EMAIL="your-admin-email@example.com"
$env:PAYLOAD_SEED_PASSWORD="your-admin-password"
```

Then run:

```powershell
pnpm import:clean-seed -- `
  --file "D:\0GitHubtest\Baihepailei\_clean_real_data\payload_seed_direct_v2_clean.json" `
  --url "http://localhost:3000"
```

The script imports in this order:

```text
rules -> terms -> creators -> works
```

It checks for existing documents by `slug`.

By default, existing documents are skipped. To overwrite matching slugs, add:

```powershell
--update-existing
```

## Current scope

This direct seed only creates base documents.

It intentionally does not handle:

- media attachment upload;
- work-to-creator relationship resolution;
- term/warning/tag relationship resolution;
- XWiki syntax conversion beyond preserving raw text in rich text fields.

Those can be handled after the content is visible and reviewable in Payload.
