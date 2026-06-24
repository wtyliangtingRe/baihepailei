# XWiki import scripts

These scripts prepare old XWiki exports for the new Payload CMS site.

The import process is intentionally staged:

```text
old XWiki audit/export CSV
-> staged JSON files
-> manual review
-> optional Payload REST import
```

The staged JSON files may contain private old-site content, so they are ignored by Git by default.

## 1. Generate staged JSON

Example using a clean export index:

```powershell
pnpm import:xwiki:stage -- `
  --index "D:\0GitHubtest\Baihepailei\_clean_export\clean_export_index.csv" `
  --pages-dir "D:\0GitHubtest\Baihepailei\_clean_export\pages" `
  --out "D:\0GitHubtest\Baihepailei\_repo\data\staging\xwiki-staged.json"
```

You can also point `--index` at `xwiki_docs_inventory.csv` if it has enough fields.

The script tries to classify pages by XWiki full name:

- `Main.作品.*` -> `works`
- `Main.创作者.*` -> `creators`
- `名词解释.*` -> `terms`
- `排雷原则.*` -> `rules`
- anything else -> `rawPages`

## 2. Review staged JSON

Open the generated JSON before importing. Delete or edit anything that should not enter the new Payload database.

## 3. Import reviewed JSON into Payload

Start the local app first:

```powershell
docker compose up -d postgres
pnpm dev
```

In a second PowerShell:

```powershell
$env:PAYLOAD_SEED_EMAIL="your-admin-email@example.com"
$env:PAYLOAD_SEED_PASSWORD="your-admin-password"

pnpm import:xwiki:seed -- `
  --file "D:\0GitHubtest\Baihepailei\_repo\data\staging\xwiki-staged.json" `
  --url "http://localhost:3000"
```

The seed script logs in through the Payload REST API and creates documents collection by collection.

## Safety

- Do not commit generated staged JSON unless it has been reviewed and intentionally sanitized.
- Do not commit old SQL dumps, tar archives, certificates, keys, or XWiki data directories.
- Do not migrate old XWiki users or passwords.
