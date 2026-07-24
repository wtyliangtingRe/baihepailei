param(
  [switch]$CommitAndPush
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

throw @'
Radar public conclusion migration generation is paused.

The read-only schema audit proved that the committed migration snapshot is older than the actual PostgreSQL schema. Do not generate or run a migration until the Work normalization candidates, legacy human-field mapping, schema retirement SQL, and current-schema baseline have been reviewed.

Next safe command:
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\radar\run-and-package-work-normalization-audit-v01.ps1

This wrapper uses the UTF-8/Base64 v02 audit transport, validates every JSON row, and packages only verified artifacts.

No database write or migration was performed.
'@
