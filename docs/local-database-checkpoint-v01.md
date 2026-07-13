# Local database checkpoint

Payload uses `DATABASE_URL` as its canonical PostgreSQL connection environment variable.

The older generic checkpoint script consumes `DATABASE_URI` internally. Use the database-aware wrapper so the project configuration and backup workflow stay aligned:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File ".\scripts\backup\create-local-database-checkpoint.ps1"
```

The wrapper resolves the connection in this order:

1. process `DATABASE_URL`;
2. process `DATABASE_URI` for legacy compatibility;
3. `.env.development.local`;
4. `.env.local`;
5. `.env.development`;
6. `.env`.

Within each file, `DATABASE_URL` is preferred over `DATABASE_URI`.

The connection value is never printed. Only the source key/file name is shown.

The wrapper then calls `create-local-checkpoint.ps1` with database inclusion enabled. The resulting checkpoint must contain:

```text
checkpoint-manifest.json
checkpoint-status.json
sha256-checksums.csv
payload-postgresql.dump
repository.bundle
```

If `pg_dump` is not available in `PATH`, install or expose the PostgreSQL client tools before retrying. A failed/incomplete checkpoint must never be used by radar apply readiness.
