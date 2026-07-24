param(
  [Parameter(Mandatory = $true)][string]$StorageBundle,
  [Parameter(Mandatory = $true)][string]$LabBundle,
  [Parameter(Mandatory = $true)][string]$GateBundle,
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [Parameter(Mandatory = $true)][ValidateSet('AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-APPLY-V01')][string]$AuthorizationPhrase,
  [string]$ExpectedStorageSHA256 = '642E43B9CBAC02C75D2D473293C7B57B8B0197594262DFA96B065015E89C135E',
  [string]$ExpectedLabSHA256 = 'EB3B1BCBE7B553471157BDED6B027F6850E3927AA9C1226AFFDC63B85EE69825',
  [string]$ExpectedGateSHA256 = 'C0FBEC5B62C3FC45072B9F235C5DF5FEA7462F564226EA7FDD3CE9C723E0E2B5',
  [string]$PostgresContainer = 'baihepailei-postgres',
  [string]$Database = 'baihepailei',
  [string]$DatabaseUser = 'baihe',
  [int]$ReadyTimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedReadySHA256 = 'BDA8429DFCF6DBCAAEB90199AC1697196B308013F65DF546F20B46167B49A220'
$FixedContainerReadyPath = '/tmp/public-ai-storage-ready.jsonl'
$innerRunner = Join-Path $PSScriptRoot 'execute-radar-public-conclusions-production-apply-once-v01.ps1'
if (-not (Test-Path -LiteralPath $innerRunner -PathType Leaf)) { throw "缺少 v01 production apply runner：$innerRunner" }

function Assert-Manifest([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "缺少 manifest.json：$Directory" }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  foreach ($entry in @($manifest)) {
    $file = Join-Path $Directory ([string]$entry.file)
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "manifest 文件不存在：$($entry.file)" }
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    if ((Get-Item -LiteralPath $file).Length -ne [long]$entry.bytes -or $hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
      throw "manifest 校验失败：$($entry.file)"
    }
  }
}

if ($AuthorizationPhrase -ne 'AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-APPLY-V01') { throw 'Production apply 授权不匹配。' }
$storagePath = (Resolve-Path -LiteralPath $StorageBundle).Path
if ((Get-FileHash -LiteralPath $storagePath -Algorithm SHA256).Hash -ne $ExpectedStorageSHA256) {
  throw 'Storage ZIP SHA-256 不匹配。'
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('radar-production-fixed-input-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
Expand-Archive -LiteralPath $storagePath -DestinationPath $tempRoot -Force
Assert-Manifest $tempRoot
$readyPath = Join-Path $tempRoot 'public-ai-storage-ready.jsonl'
if ((Get-FileHash -LiteralPath $readyPath -Algorithm SHA256).Hash -ne $ExpectedReadySHA256) {
  throw 'Storage-ready 文件 SHA-256 不匹配。'
}

try {
  & docker exec $PostgresContainer sh -lc "test ! -e '$FixedContainerReadyPath'"
  if ($LASTEXITCODE -ne 0) { throw "生产容器已存在固定 ready 路径，拒绝覆盖：$FixedContainerReadyPath" }
  & docker cp $readyPath "${PostgresContainer}:$FixedContainerReadyPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '复制固定 storage-ready 输入失败。' }

  & $innerRunner @PSBoundParameters
  if ($LASTEXITCODE -ne 0) { throw 'Radar production apply v01 执行失败。' }
} finally {
  & docker exec $PostgresContainer rm -f $FixedContainerReadyPath *> $null
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
