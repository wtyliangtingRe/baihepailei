# Demo fixtures

This directory contains safe fake data for local development.

The demo fixture is intentionally separate from real migrated XWiki data.

Rules:

- All demo slugs start with `demo-`.
- Demo data is safe to commit.
- Real imported content should stay outside the repository.
- Real screenshots and real covers should be uploaded through Payload later.

Dry run:

```powershell
pnpm import:demo -- --dry-run
```

Real local import:

```powershell
$env:PAYLOAD_SEED_EMAIL="your-admin-email"
$env:PAYLOAD_SEED_PASSWORD="your-admin-password"

pnpm import:demo -- --url "http://localhost:3000" --update-existing
```
