# Bangumi credits v0.1

Read-only audit for Bangumi creator and organization credits.

Generated local files are written under `data_local/staging/work-source-metadata` and must not be committed.

## Run

```powershell
node "scripts\import\audit-bangumi-credits-v01.mjs"

Get-Content "data_local\staging\work-source-metadata\bangumi-credits-v01-summary.json" -Raw
Get-Content "data_local\staging\work-source-metadata\bangumi-credits-v01-samples.json" -Raw
```

## Safety

- Read-only.
- No Payload write.
- No direct PostgreSQL write.
- No data change.

