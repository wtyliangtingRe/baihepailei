param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][string]$StorageBundle,
  [Parameter(Mandatory = $true)][string]$SchemaReviewBundle,
  [Parameter(Mandatory = $true)][ValidateSet('RUN-ISOLATED-RADAR-PUBLIC-CONCLUSIONS-STORAGE-LAB-V01')][string]$Confirm,
  [string]$ExpectedStorageSHA256 = '642E43B9CBAC02C75D2D473293C7B57B8B0197594262DFA96B065015E89C135E',
  [string]$ExpectedSchemaReviewSHA256 = '297FED9AB54675748E5AE0DD812CFA4AC367966D12E7732541913223D74AC0FB',
  [string]$SourcePostgresContainer = 'baihepailei-postgres',
  [string]$SourceDatabase = 'baihepailei',
  [string]$SourceDatabaseUser = 'baihe',
  [int]$ReadyTimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot
$innerRunner = Join-Path $PSScriptRoot 'run-and-package-radar-public-conclusions-storage-lab-and-gate-v01.ps1'
if (-not (Test-Path -LiteralPath $innerRunner -PathType Leaf)) { throw "缺少 v01 runner：$innerRunner" }

function Write-JsonFile([string]$Path, [object]$Value) {
  [System.IO.File]::WriteAllText(
    $Path,
    (($Value | ConvertTo-Json -Depth 100).TrimEnd() + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Write-EvidenceManifest([string]$Directory, [string[]]$ExcludedNames = @()) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
  $files = @(
    Get-ChildItem -LiteralPath $Directory -Recurse -File |
      Where-Object { $_.Name -ne 'manifest.json' -and $ExcludedNames -notcontains $_.Name } |
      Sort-Object FullName
  )
  $manifest = @($files | ForEach-Object {
    $relative = [System.IO.Path]::GetRelativePath($Directory, $_.FullName).Replace('\', '/')
    $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
    [ordered]@{ file = $relative; bytes = $_.Length; sha256 = $hash.Hash.ToLowerInvariant() }
  })
  Write-JsonFile $manifestPath $manifest
  foreach ($entry in $manifest) {
    $file = Join-Path $Directory ([string]$entry.file)
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "manifest 文件不存在：$($entry.file)" }
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    if ((Get-Item -LiteralPath $file).Length -ne [long]$entry.bytes -or $hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
      throw "manifest 校验失败：$($entry.file)"
    }
  }
}

function New-EvidenceZip([string]$SourceDirectory, [string]$DestinationZip, [string[]]$ExcludedNames = @()) {
  $packRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('radar-evidence-pack-' + [Guid]::NewGuid().ToString('N'))
  try {
    New-Item -ItemType Directory -Path $packRoot -Force | Out-Null
    Get-ChildItem -LiteralPath $SourceDirectory -Force |
      Where-Object { $ExcludedNames -notcontains $_.Name } |
      ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $packRoot -Recurse -Force }
    Remove-Item -LiteralPath $DestinationZip -Force -ErrorAction SilentlyContinue
    Compress-Archive -Path (Join-Path $packRoot '*') -DestinationPath $DestinationZip -CompressionLevel Optimal -Force
    if (-not (Test-Path -LiteralPath $DestinationZip -PathType Leaf)) { throw "ZIP 未生成：$DestinationZip" }
    return Get-FileHash -LiteralPath $DestinationZip -Algorithm SHA256
  } finally {
    Remove-Item -LiteralPath $packRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Get-OutputValue([object[]]$Lines, [string]$Name) {
  foreach ($line in $Lines) {
    $text = [string]$line
    if ($text -match ('^' + [regex]::Escape($Name) + '\s*:\s*(.+)$')) { return $Matches[1].Trim() }
  }
  throw "v01 runner 没有输出 $Name。"
}

& docker version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker 不可用。' }
$postgresImage = ([string](& docker inspect -f '{{.Config.Image}}' $SourcePostgresContainer)).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($postgresImage)) { throw '无法读取 PostgreSQL 镜像。' }

$shimRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('radar-pg-restore-shim-' + [Guid]::NewGuid().ToString('N'))
$shimPath = Join-Path $shimRoot 'pg_restore.ps1'
$oldPath = [Environment]::GetEnvironmentVariable('PATH', 'Process')
$oldImage = [Environment]::GetEnvironmentVariable('RADAR_PG_RESTORE_IMAGE', 'Process')
New-Item -ItemType Directory -Path $shimRoot -Force | Out-Null
$shim = @'
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
$ErrorActionPreference = 'Stop'
if ($Arguments.Count -ne 2 -or $Arguments[0] -ne '--list') {
  throw 'The pg_restore shim accepts only: --list <archive>'
}
$archive = (Resolve-Path -LiteralPath $Arguments[1]).Path
$directory = Split-Path -Parent $archive
$fileName = Split-Path -Leaf $archive
$image = [Environment]::GetEnvironmentVariable('RADAR_PG_RESTORE_IMAGE', 'Process')
if ([string]::IsNullOrWhiteSpace($image)) { throw 'RADAR_PG_RESTORE_IMAGE is missing.' }
$mount = "${directory}:/backup:ro"
& docker run --rm --network none -v $mount $image pg_restore --list "/backup/$fileName"
exit $LASTEXITCODE
'@
[System.IO.File]::WriteAllText($shimPath, $shim.TrimStart(), [System.Text.UTF8Encoding]::new($false))

try {
  [Environment]::SetEnvironmentVariable('RADAR_PG_RESTORE_IMAGE', $postgresImage, 'Process')
  [Environment]::SetEnvironmentVariable('PATH', ($shimRoot + [System.IO.Path]::PathSeparator + $oldPath), 'Process')

  $runnerOutput = [System.Collections.Generic.List[string]]::new()
  & $innerRunner `
    -ExpectedBranchHead $ExpectedBranchHead `
    -StorageBundle $StorageBundle `
    -SchemaReviewBundle $SchemaReviewBundle `
    -Confirm $Confirm `
    -ExpectedStorageSHA256 $ExpectedStorageSHA256 `
    -ExpectedSchemaReviewSHA256 $ExpectedSchemaReviewSHA256 `
    -SourcePostgresContainer $SourcePostgresContainer `
    -SourceDatabase $SourceDatabase `
    -SourceDatabaseUser $SourceDatabaseUser `
    -ReadyTimeoutSeconds $ReadyTimeoutSeconds *>&1 |
      ForEach-Object {
        $text = [string]$_
        $runnerOutput.Add($text)
        Write-Host $text
      }
  if ($LASTEXITCODE -ne 0) { throw "v01 storage lab/gate runner 失败：$LASTEXITCODE" }

  $outputDirectory = Get-OutputValue @($runnerOutput) 'OutputDirectory'
  $labBundle = Get-OutputValue @($runnerOutput) 'LabEvidenceBundle'
  $gateBundle = Get-OutputValue @($runnerOutput) 'ProductionGateBundle'
  foreach ($path in @($outputDirectory, $labBundle, $gateBundle)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "v01 输出路径不存在：$path" }
  }

  $gateFileName = [System.IO.Path]::GetFileNameWithoutExtension($gateBundle)
  $stamp = $gateFileName -replace '^RADAR-PUBLIC-CONCLUSIONS-PRODUCTION-GATE-', ''
  $gateDirectory = Join-Path $repoRoot "exports\radar-public-conclusions-production-gate-$stamp"
  if (-not (Test-Path -LiteralPath $gateDirectory -PathType Container)) { throw "找不到 gate 目录：$gateDirectory" }

  Write-Host ''
  Write-Host '==> 重建不含完整 dump 的 lab evidence manifest 与 ZIP' -ForegroundColor Cyan
  Write-EvidenceManifest -Directory $outputDirectory -ExcludedNames @('database-backup.dump')
  $labHash = New-EvidenceZip -SourceDirectory $outputDirectory -DestinationZip $labBundle -ExcludedNames @('database-backup.dump')

  Write-Host ''
  Write-Host '==> 将最终 lab SHA 绑定回 production gate 并重建 gate ZIP' -ForegroundColor Cyan
  $gateSummaryPath = Join-Path $gateDirectory 'radar-public-conclusions-production-gate-summary.json'
  $gateSummary = Get-Content -LiteralPath $gateSummaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  $gateSummary.labEvidenceBundleSha256 = $labHash.Hash.ToLowerInvariant()
  $gateSummary | Add-Member -NotePropertyName evidenceFinalizedBy -NotePropertyValue 'run-and-package-radar-public-conclusions-storage-lab-and-gate-v02' -Force
  $gateSummary | Add-Member -NotePropertyName labEvidenceManifestExcludesFullBackup -NotePropertyValue $true -Force
  Write-JsonFile $gateSummaryPath $gateSummary
  Write-EvidenceManifest -Directory $gateDirectory
  $gateHash = New-EvidenceZip -SourceDirectory $gateDirectory -DestinationZip $gateBundle

  Write-Host ''
  Write-Host 'Storage-normalized Radar lab 与 production gate 证据闭环完成' -ForegroundColor Green
  Write-Host "OutputDirectory           : $outputDirectory"
  Write-Host "LabEvidenceBundle         : $labBundle"
  Write-Host "LabEvidenceBundleSHA256   : $($labHash.Hash)"
  Write-Host "ProductionGateBundle      : $gateBundle"
  Write-Host "ProductionGateBundleSHA256: $($gateHash.Hash)"
  Write-Host 'LabManifestBackupExcluded : True'
  Write-Host 'ProductionDatabaseWrite   : False'
  Write-Host 'ProductionRowsWritten     : 0'
  Write-Host 'ProductionApplyAuthorized : False'
} finally {
  [Environment]::SetEnvironmentVariable('PATH', $oldPath, 'Process')
  [Environment]::SetEnvironmentVariable('RADAR_PG_RESTORE_IMAGE', $oldImage, 'Process')
  Remove-Item -LiteralPath $shimRoot -Recurse -Force -ErrorAction SilentlyContinue
}
