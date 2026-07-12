# Baihepailei Site UI and Rules Checkpoint

Date: 2026-07-12

This checkpoint records the first consolidated public-facing site state after the rules, notices, navigation, search scope, visual assets, creator anomaly guards, and backup workflow were integrated.

## Included public features

- Public search limited to works, creators, and organizations.
- Unified site guide entry for page notices, terminology, and radar rules.
- Full S / A / B / C / D / E / F / X radar rule presentation.
- Updated work grading guide including F and X.
- Public presentation of severe ratings instead of hiding them.
- Compact page-notice icons and standardized work placeholder thumbnails.
- Dark and light theme treatment for generated purple visual assets.
- Homepage, search, creators, organizations, works, rules, and site-guide copy refreshed.
- Known creator records that are actually work-title or role fragments blocked from public lists and search even when a stale index is present.
- Payload-safe manual creator anomaly hide workflow retained for data cleanup.

## Data-safety principles

- No direct PostgreSQL writes from cleanup scripts.
- No physical deletion of creator, organization, or work records.
- Entity cleanup uses visibility flags and preserved audit markers.
- Apply workflows require explicit confirmation tokens.
- Public UI guards do not mutate Payload data.

## Visual assets

Source PNG files are stored locally under:

```text
D:\0GitHubtest\Baihepailei\data_local\uipic
```

Generated website assets are produced with:

```powershell
pnpm ui:install-visual-assets
```

The generated WebP files are written to:

```text
public/ui
```

## Local checkpoint backup

Create a source, data, generated-assets, and Git history backup:

```powershell
pnpm backup:checkpoint
```

Default output directory:

```text
D:\Baihepailei-backups\Baihepailei-YYYYMMDD-HHMMSS
```

Include local `.env` files only when the backup storage is private and encrypted:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup\create-local-checkpoint.ps1 -IncludeSecrets
```

Include a PostgreSQL read-only dump when `pg_dump` is installed and `DATABASE_URI` is configured:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup\create-local-checkpoint.ps1 -IncludeSecrets -IncludeDatabase
```

## Recovery

Recover Git history from the bundle:

```powershell
git clone "D:\Baihepailei-backups\Baihepailei-YYYYMMDD-HHMMSS\repository.bundle" Baihepailei-restored
```

The `workspace` folder in the checkpoint also contains a direct copy of the working tree, including local data and generated assets, except `.git`, `node_modules`, `.next`, and secrets unless explicitly requested.

## Stable remote branch

A dedicated remote checkpoint branch is created from this state:

```text
checkpoint/site-ui-rules-2026-07-12
```

Do not continue normal development directly on that branch. Use it only as a restore point or comparison baseline.
