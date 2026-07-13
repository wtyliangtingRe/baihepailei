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

## pg_dump resolution

The wrapper resolves `pg_dump` in this order:

1. an existing `pg_dump.exe` in `PATH`;
2. common PostgreSQL, Scoop, and Chocolatey installation directories;
3. the running project PostgreSQL container, defaulting to `baihepailei-postgres`.

For the Docker fallback, the wrapper runs the PostgreSQL image's own `pg_dump`, writes a custom-format dump to a temporary path inside the container, copies it into the checkpoint, verifies that the host file is non-empty, and removes the temporary container file. The system `PATH` is changed only for the lifetime of the wrapper process.

A different container name can be supplied explicitly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File ".\scripts\backup\create-local-database-checkpoint.ps1" `
  -PostgresContainer "another-postgres-container"
```

The wrapper then calls `create-local-checkpoint.ps1` with database inclusion enabled. The resulting checkpoint must contain:

```text
checkpoint-manifest.json
checkpoint-status.json
sha256-checksums.csv
payload-postgresql.dump
repository.bundle
```

A failed or incomplete checkpoint must never be used by radar apply readiness.
