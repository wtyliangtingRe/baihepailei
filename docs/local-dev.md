# Local development

This project is being rebuilt with Payload, Next.js, and a local Postgres container.

## Requirements

- Node.js 20.9 or newer
- pnpm
- Docker Desktop
- Git

## First run

From the repository root:

```powershell
cd "D:\0GitHubtest\Baihepailei\_repo"
Copy-Item .env.example .env
docker compose up -d postgres
pnpm install
pnpm dev
```

Open:

```text
http://localhost:3000/admin
```

On the first visit, Payload will ask you to create the first admin user.

## Helper script

You can also run:

```powershell
pnpm dev:setup
```

## Local private data

Do not commit these folders:

```text
old_data/
_audit_out/
_clean_export/
_clean_attachments/
```

They may contain old backups, private pages, certificates, or local export results.
