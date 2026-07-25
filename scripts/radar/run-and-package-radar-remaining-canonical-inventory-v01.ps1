param(
  [Parameter(Mandatory = $true)][string]$ExpectedBranchHead,
  [string]$ExpectedBaseCommit = 'e9ee3cddf9e0dd058814a6f807ac36cc6d91eaf0',
  [string]$ExpectedBranch = 'agent/radar-remaining-canonical-inventory-v01',
  [int]$ExpectedPublicCurrent = 10804,
  [int]$BatchSize = 2500,
  [int]$WaveSize = 250,
  [int]$Port = 3101,
  [int]$ReadyTimeoutSeconds = 240
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Write-Json([string]$Path, [object]$Value) {
  [System.IO.File]::WriteAllText(
    $Path,
    (($Value | ConvertTo-Json -Depth 100).TrimEnd() + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Import-DotEnvFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $trimmed = ([string]$line).Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    if ($trimmed.StartsWith('export ')) { $trimmed = $trimmed.Substring(7).Trim() }
    $separator = $trimmed.IndexOf('=')
    if ($separator -le 0) { continue }
    $name = $trimmed.Substring(0, $separator).Trim()
    if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$' -or (Test-Path "Env:$name")) { continue }
    $value = $trimmed.Substring($separator + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

function Get-ProcessEnvironment([string]$Name) {
  return [Environment]::GetEnvironmentVariable($Name, 'Process')
}

function Set-ProcessEnvironment([string]$Name, [string]$Value) {
  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Stop-ProcessTree([int]$ProcessId) {
  & taskkill /PID $ProcessId /T /F *> $null
  if ($LASTEXITCODE -ne 0) {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($null -ne $process) { Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue }
  }
}

function Remove-DirectoryWithLongPathSupport([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -ErrorAction SilentlyContinue)) { return }
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $extendedPath = if ($fullPath.StartsWith('\\')) {
    '\\?\UNC\' + $fullPath.Substring(2)
  } else {
    '\\?\' + $fullPath
  }
  & cmd.exe /d /c ('rd /s /q "' + $extendedPath + '"')
  if ($LASTEXITCODE -ne 0 -and (Test-Path -LiteralPath $Path -ErrorAction SilentlyContinue)) {
    throw "Windows 长路径清理失败：$Path"
  }
}

function Rebuild-Manifest([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  $files = @(
    Get-ChildItem -LiteralPath $Directory -File -Recurse |
    Where-Object FullName -ne $manifestPath |
    Sort-Object FullName
  )
  $manifest = @($files | ForEach-Object {
    $relative = [System.IO.Path]::GetRelativePath($Directory, $_.FullName).Replace('\', '/')
    $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
    [ordered]@{
      file = $relative
      bytes = $_.Length
      sha256 = $hash.Hash.ToLowerInvariant()
    }
  })
  Write-Json -Path $manifestPath -Value $manifest
  return $manifest
}

function Test-Manifest([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "缺少 manifest.json：$Directory"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  foreach ($entry in @($manifest)) {
    $file = Join-Path $Directory ([string]$entry.file).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "manifest 文件不存在：$($entry.file)"
    }
    $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
    $bytes = (Get-Item -LiteralPath $file).Length
    if ($bytes -ne [long]$entry.bytes -or $hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
      throw "manifest 校验失败：$($entry.file)"
    }
  }
}

$currentBranch = (git branch --show-current).Trim()
$currentHead = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw '无法读取当前 Git HEAD。' }
if ($currentBranch -ne $ExpectedBranch) { throw "当前分支不正确：$currentBranch" }
if ($currentHead -ne $ExpectedBranchHead) { throw "当前 HEAD 不是已固定 inventory 版本：$currentHead" }
if ($ExpectedBranchHead -notmatch '^[0-9A-Fa-f]{40}$' -or $ExpectedBaseCommit -notmatch '^[0-9A-Fa-f]{40}$') {
  throw 'ExpectedBranchHead 与 ExpectedBaseCommit 必须是 40 位 Git SHA。'
}

git merge-base --is-ancestor $ExpectedBaseCommit $currentHead
if ($LASTEXITCODE -ne 0) { throw "inventory 分支不包含固定 main 基线：$ExpectedBaseCommit" }

if ($BatchSize -lt 1 -or $WaveSize -lt 1 -or $BatchSize % $WaveSize -ne 0) {
  throw 'BatchSize 与 WaveSize 必须为正整数，且 BatchSize 必须可被 WaveSize 整除。'
}

Import-DotEnvFile (Join-Path $repoRoot '.env')
Import-DotEnvFile (Join-Path $repoRoot '.env.local')

$savedToken = Get-ProcessEnvironment 'RADAR_PAYLOAD_TOKEN'
$savedEmail = Get-ProcessEnvironment 'RADAR_PAYLOAD_EMAIL'
$savedPassword = Get-ProcessEnvironment 'RADAR_PAYLOAD_PASSWORD'
$token = Get-ProcessEnvironment 'RADAR_PAYLOAD_TOKEN'
$email = Get-ProcessEnvironment 'RADAR_PAYLOAD_EMAIL'
$password = Get-ProcessEnvironment 'RADAR_PAYLOAD_PASSWORD'
if ([string]::IsNullOrWhiteSpace($email)) {
  $email = Read-Host '请输入 Payload 管理员邮箱'
  Set-ProcessEnvironment 'RADAR_PAYLOAD_EMAIL' $email
}
if ([string]::IsNullOrWhiteSpace($password) -and [string]::IsNullOrWhiteSpace($token)) {
  $securePassword = Read-Host '请输入 Payload 管理员密码（输入不会显示）' -AsSecureString
  $password = ConvertFrom-SecureString $securePassword -AsPlainText
  Set-ProcessEnvironment 'RADAR_PAYLOAD_PASSWORD' $password
}

$shortId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$worktreeRoot = 'D:\binv'
$worktree = Join-Path $worktreeRoot $shortId
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\radar-remaining-canonical-inventory-$stamp"
$bundlePath = Join-Path $repoRoot "exports\RADAR-REMAINING-CANONICAL-INVENTORY-$stamp.zip"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("radar-remaining-inventory-" + [guid]::NewGuid().ToString('N'))
$serverStdout = Join-Path $tempRoot 'inventory-server-stdout.log'
$serverStderr = Join-Path $tempRoot 'inventory-server-stderr.log'
$serverScript = Join-Path $tempRoot 'start-inventory-server.ps1'
$baseUrl = "http://127.0.0.1:$Port"
$server = $null
$serverStopped = $false
$worktreeAdded = $false
$passed = $false

try {
  New-Item -ItemType Directory -Path $worktreeRoot, $tempRoot -Force | Out-Null
  git worktree add --detach -- $worktree $currentHead
  if ($LASTEXITCODE -ne 0) { throw '创建短路径 inventory worktree 失败。' }
  $worktreeAdded = $true

  Set-Location -LiteralPath $worktree
  if (Test-Path -LiteralPath (Join-Path $worktree 'pnpm-lock.yaml') -PathType Leaf) {
    pnpm install --frozen-lockfile
  } else {
    pnpm install --no-frozen-lockfile
  }
  if ($LASTEXITCODE -ne 0) { throw 'inventory worktree 依赖安装失败。' }

  $escapedWorktree = $worktree.Replace("'", "''")
  $serverText = @"
`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath '$escapedWorktree'
`$env:PAYLOAD_DB_PUSH = 'false'
pnpm exec next dev -p $Port
"@
  [System.IO.File]::WriteAllText($serverScript, $serverText, [System.Text.UTF8Encoding]::new($false))
  $server = Start-Process `
    -FilePath (Get-Command pwsh).Source `
    -ArgumentList @('-NoProfile', '-File', $serverScript) `
    -RedirectStandardOutput $serverStdout `
    -RedirectStandardError $serverStderr `
    -PassThru `
    -WindowStyle Hidden

  $deadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)
  $ready = $false
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($server.HasExited) { throw "inventory Next 服务器提前退出：$($server.ExitCode)" }
    try {
      if ([string]::IsNullOrWhiteSpace($token)) {
        $loginBody = @{ email = $email; password = $password } | ConvertTo-Json -Compress
        $login = Invoke-RestMethod `
          -Uri "$baseUrl/api/users/login" `
          -Method Post `
          -ContentType 'application/json' `
          -Body $loginBody `
          -TimeoutSec 8
        $token = [string]$login.token
        if (-not [string]::IsNullOrWhiteSpace($token)) {
          Set-ProcessEnvironment 'RADAR_PAYLOAD_TOKEN' $token
        }
      }
      if (-not [string]::IsNullOrWhiteSpace($token)) {
        $probe = Invoke-RestMethod `
          -Uri "$baseUrl/api/works?limit=1&depth=0&draft=false" `
          -Method Get `
          -Headers @{ Authorization = "JWT $token" } `
          -TimeoutSec 8
        if ($null -ne $probe) { $ready = $true; break }
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $ready) { throw 'inventory Next 服务器未在限时内就绪。' }

  & node (Join-Path $worktree 'scripts\radar\build-radar-remaining-canonical-inventory-v01.mjs') `
    --out-dir $outDir `
    --url $baseUrl `
    --batch-size $BatchSize `
    --wave-size $WaveSize `
    --expected-public-current $ExpectedPublicCurrent `
    --branch-head $currentHead
  if ($LASTEXITCODE -ne 0) { throw '剩余 canonical Works inventory 构建失败。' }
} finally {
  if ($null -ne $server) {
    Stop-ProcessTree -ProcessId $server.Id
    Start-Sleep -Seconds 1
    $serverStopped = $null -eq (Get-Process -Id $server.Id -ErrorAction SilentlyContinue)
  }
  Set-Location -LiteralPath $repoRoot
  Set-ProcessEnvironment 'RADAR_PAYLOAD_TOKEN' $savedToken
  Set-ProcessEnvironment 'RADAR_PAYLOAD_EMAIL' $savedEmail
  Set-ProcessEnvironment 'RADAR_PAYLOAD_PASSWORD' $savedPassword
}

if (-not $serverStopped) { throw 'inventory Next 服务器未确认停止。' }
if (-not (Test-Path -LiteralPath $outDir -PathType Container)) { throw 'inventory 输出目录不存在。' }

Copy-Item -LiteralPath $serverStdout -Destination (Join-Path $outDir 'inventory-server-stdout.log') -Force
Copy-Item -LiteralPath $serverStderr -Destination (Join-Path $outDir 'inventory-server-stderr.log') -Force
$summaryPath = Join-Path $outDir 'inventory-summary.json'
$summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
$expectedWaveCount = [int]($BatchSize / $WaveSize)
if ($summary.inputs.publicCurrentConclusionsRead -ne $ExpectedPublicCurrent -or
    $summary.counts.researchBatchRows -ne $BatchSize -or
    $summary.counts.researchWaveCount -ne $expectedWaveCount -or
    $summary.globalBlockers.Count -ne 0 -or
    $summary.readyForResearchPackaging -ne $true -or
    $summary.safety.payloadContentWrite -ne $false -or
    $summary.safety.directPostgresqlWrite -ne $false -or
    $summary.safety.productionApplyPackageGenerated -ne $false) {
  throw 'inventory 摘要未达到 2,500 / 10×250 只读打包门槛。'
}

for ($index = 1; $index -le $expectedWaveCount; $index += 1) {
  $waveId = 'wave-' + $index.ToString('00')
  $waveManifestPath = Join-Path $outDir "waves\$waveId.manifest.json"
  $waveManifest = Get-Content -LiteralPath $waveManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
  if ($waveManifest.rows -ne $WaveSize -or $waveManifest.independentlyRecoverable -ne $true) {
    throw "子波次不符合独立恢复门槛：$waveId"
  }
}

Write-Json -Path (Join-Path $outDir 'inventory-run-validation.json') -Value ([ordered]@{
  schemaVersion = 1
  generatedAt = [DateTime]::UtcNow.ToString('o')
  branch = $currentBranch
  branchHead = $currentHead
  baseCommit = $ExpectedBaseCommit
  expectedPublicCurrent = $ExpectedPublicCurrent
  batchSize = $BatchSize
  waveSize = $WaveSize
  waveCount = $expectedWaveCount
  dedicatedWorktree = $worktree
  dedicatedServerStopped = $serverStopped
  payloadRead = $true
  payloadContentWrite = $false
  authenticationPostOnly = $true
  directPostgresqlWrite = $false
  migrationGenerated = $false
  schemaPush = $false
  productionApplyPackageGenerated = $false
  readyForResearchPackaging = $true
})

$manifest = Rebuild-Manifest -Directory $outDir
Test-Manifest -Directory $outDir
Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $bundlePath -CompressionLevel Optimal -Force
$bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256
$passed = $true

if ($worktreeAdded -and $passed) {
  git worktree remove --force -- $worktree | Out-Null
  if ($LASTEXITCODE -ne 0) { Remove-DirectoryWithLongPathSupport -Path $worktree }
  git worktree prune --expire now | Out-Null
}

Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '剩余 canonical Works inventory V01 已完成～' -ForegroundColor Green
Write-Host "OutputDirectory           : $outDir"
Write-Host "Bundle                    : $bundlePath"
Write-Host "SHA256                    : $($bundleHash.Hash)"
Write-Host "BranchHead                : $currentHead"
Write-Host "PublicCurrentRows         : $($summary.inputs.publicCurrentConclusionsRead)"
Write-Host "CanonicalWorks            : $($summary.counts.canonicalWorks)"
Write-Host "AlreadyCurrent            : $($summary.counts.alreadyCurrent)"
Write-Host "MissingCurrent            : $($summary.counts.missingCurrent)"
Write-Host "SupersedeCandidate        : $($summary.counts.supersedeCandidate)"
Write-Host "ExcludedWorks             : $($summary.counts.excludedWorks)"
Write-Host "ResearchBatchRows         : $($summary.counts.researchBatchRows)"
Write-Host "ResearchWaveCount         : $($summary.counts.researchWaveCount)"
Write-Host "GlobalBlockers            : $($summary.globalBlockers.Count)"
Write-Host "ReadyForResearchPackaging: $($summary.readyForResearchPackaging)"
Write-Host ''
Write-Host 'PayloadContentWrite       : False'
Write-Host 'PostgreSQLWrite           : False'
Write-Host 'MigrationGenerated        : False'
Write-Host 'ProductionApplyPackage    : False'
Write-Host 'DedicatedInventoryServer  : Stopped'
