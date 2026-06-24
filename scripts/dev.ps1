$ErrorActionPreference = "Stop"

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env" -ForegroundColor Green
}

docker compose up -d postgres
pnpm install
pnpm dev
