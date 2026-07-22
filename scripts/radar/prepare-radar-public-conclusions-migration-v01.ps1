param(
  [switch]$CommitAndPush
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

throw @'
Radar public conclusion migration generation is paused.

The read-only schema audit proved that the committed migration snapshot is older than the actual PostgreSQL schema. Do not generate or run a migration until the Work normalization candidates, legacy human-field mapping, schema retirement SQL, and current-schema baseline have been reviewed.

Next safe command:
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\radar\audit-work-normalization-candidates-v01.ps1

No database write or migration was performed.
'@
