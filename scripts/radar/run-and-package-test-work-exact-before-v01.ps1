param(
  [Parameter(Mandatory = $true)][string]$DryRunV03Directory,
  [string]$PostgresContainer = 'baihepailei-postgres',
  [string]$Database = 'baihepailei',
  [string]$DatabaseUser = 'baihe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

function Resolve-RepoPath([string]$Value, [string]$Label) {
  if ([System.IO.Path]::IsPathRooted($Value)) {
    $candidate = [System.IO.Path]::GetFullPath($Value)
  } else {
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Value))
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
    throw "找不到 $Label：$candidate"
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Invoke-NativeProcess([string]$FileName, [string[]]$Arguments) {
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FileName
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true
  foreach ($argument in $Arguments) {
    [void]$startInfo.ArgumentList.Add($argument)
  }

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw "无法启动原生命令：$FileName"
  }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  return [pscustomobject]@{
    ExitCode = $process.ExitCode
    Stdout = $stdout
    Stderr = $stderr
  }
}

$sourceDir = Resolve-RepoPath $DryRunV03Directory 'merge dry-run v03 目录'
$manifestPath = Join-Path $sourceDir 'manifest.json'
$summaryPath = Join-Path $sourceDir 'merge-dryrun-summary.json'
$sqlPath = Join-Path $sourceDir 'exact-before-readonly.sql'
$expectationsPath = Join-Path $sourceDir 'exact-before-expectations.json'

foreach ($required in @($manifestPath, $summaryPath, $sqlPath, $expectationsPath)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "v03 exact-before 输入不完整：$required"
  }
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 30
foreach ($entry in @($manifest)) {
  $file = Join-Path $sourceDir ([string]$entry.file)
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw "manifest 文件不存在：$($entry.file)"
  }
  $hash = Get-FileHash -LiteralPath $file -Algorithm SHA256
  $bytes = (Get-Item -LiteralPath $file).Length
  if ($bytes -ne [long]$entry.bytes) {
    throw "manifest 字节数不匹配：$($entry.file)"
  }
  if ($hash.Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()) {
    throw "manifest SHA-256 不匹配：$($entry.file)"
  }
}

$summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
if ($summary.schemaVersion -ne 3 -or
    $summary.exactBeforeAllChecksRequireTrue -ne $true -or
    $summary.safety.databaseWrite -ne $false -or
    $summary.safety.executableUpdateSqlGenerated -ne $false -or
    $summary.safety.mergePerformed -ne $false) {
  throw 'v03 dry-run 未证明 exact-before 安全前置条件。'
}

$expectations = Get-Content -LiteralPath $expectationsPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 30
$expectedChecks = [int]$expectations.exactRowChecks +
  [int]$expectations.relationCountChecks +
  [int]$expectations.versionRelationCountChecks
if ($expectedChecks -lt 1 -or $expectations.allChecksMustReturnMatchesTrue -ne $true) {
  throw 'exact-before expectations 无效。'
}

$sql = Get-Content -LiteralPath $sqlPath -Raw -Encoding UTF8
if ($sql -notmatch '^BEGIN TRANSACTION READ ONLY;' -or
    $sql -notmatch 'AS matches' -or
    $sql -notmatch 'ROLLBACK;\s*$') {
  throw 'exact-before SQL 缺少只读事务或 matches 门槛。'
}
if ($sql -match '(?im)^\s*(UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b') {
  throw 'exact-before SQL 出现写入或 DDL。'
}

$containerCheck = Invoke-NativeProcess 'docker' @('inspect', '--type', 'container', $PostgresContainer)
if ($containerCheck.ExitCode -ne 0) {
  throw "找不到 PostgreSQL 容器 $PostgresContainer：$($containerCheck.Stderr.Trim())"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $repoRoot "exports\test-work-exact-before-$stamp"
$bundlePath = Join-Path $repoRoot "exports\TEST-WORK-EXACT-BEFORE-$stamp.zip"
$containerSqlPath = "/tmp/test-work-exact-before-$([Guid]::NewGuid().ToString('N')).sql"
$parser = Join-Path $PSScriptRoot 'parse-test-work-exact-before-results-v01.mjs'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$stdoutPath = Join-Path $outDir 'psql-stdout-raw.tsv'
$stderrPath = Join-Path $outDir 'psql-stderr-raw.txt'
$copyResult = $null
$psqlResult = $null
$parseExitCode = 1

try {
  $copyResult = Invoke-NativeProcess 'docker' @('cp', $sqlPath, "${PostgresContainer}:$containerSqlPath")
  if ($copyResult.ExitCode -ne 0) {
    throw "复制只读 SQL 到容器临时目录失败：$($copyResult.Stderr.Trim())"
  }

  $psqlResult = Invoke-NativeProcess 'docker' @(
    'exec',
    $PostgresContainer,
    'psql',
    '-X',
    '-qAt',
    '-v', 'ON_ERROR_STOP=1',
    '-F', "`t",
    '-U', $DatabaseUser,
    '-d', $Database,
    '-f', $containerSqlPath
  )

  [System.IO.File]::WriteAllText($stdoutPath, $psqlResult.Stdout, [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText($stderrPath, $psqlResult.Stderr, [System.Text.UTF8Encoding]::new($false))

  if ($psqlResult.ExitCode -ne 0) {
    throw "PostgreSQL exact-before 只读检查执行失败：$($psqlResult.Stderr.Trim())"
  }

  & node $parser `
    --sql $sqlPath `
    --expectations $expectationsPath `
    --stdout $stdoutPath `
    --stderr $stderrPath `
    --output-dir $outDir
  $parseExitCode = $LASTEXITCODE
} finally {
  $removeResult = Invoke-NativeProcess 'docker' @('exec', $PostgresContainer, 'rm', '-f', $containerSqlPath)
  if ($removeResult.ExitCode -ne 0) {
    Write-Warning "无法删除容器临时 SQL：$($removeResult.Stderr.Trim())"
  }
}

$requiredOutputs = @(
  'exact-before-results.jsonl',
  'exact-before-run-summary.json',
  'exact-before-run-summary.md',
  'exact-before-stdout.tsv',
  'exact-before-stderr.txt',
  'psql-stdout-raw.tsv',
  'psql-stderr-raw.txt',
  'manifest.json'
)
$missingOutputs = @(
  $requiredOutputs | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $outDir $_) -PathType Leaf)
  }
)
if ($missingOutputs.Count -gt 0) {
  throw "exact-before 输出不完整：$($missingOutputs -join ', ')"
}

$runSummary = Get-Content `
  -LiteralPath (Join-Path $outDir 'exact-before-run-summary.json') `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 50

$paths = @(
  Get-ChildItem -LiteralPath $outDir -File |
    Sort-Object Name |
    ForEach-Object FullName
)
Compress-Archive `
  -LiteralPath $paths `
  -DestinationPath $bundlePath `
  -CompressionLevel Optimal `
  -Force
$bundleHash = Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256

Write-Host ''
Write-Host 'Test Work exact-before 只读检查与打包完成' -ForegroundColor Green
Write-Host "SourceDirectory        : $sourceDir"
Write-Host "OutputDirectory        : $outDir"
Write-Host "Bundle                 : $bundlePath"
Write-Host "SHA256                 : $($bundleHash.Hash)"
Write-Host "ExpectedChecks         : $($runSummary.expectedChecks)"
Write-Host "ObservedChecks         : $($runSummary.observedChecks)"
Write-Host "MatchedChecks          : $($runSummary.matchedChecks)"
Write-Host "FailedChecks           : $($runSummary.failedChecks)"
Write-Host "AllChecksMatched       : $($runSummary.allChecksMatched)"
Write-Host ''
Write-Host 'DatabaseWrite          : False'
Write-Host 'PayloadWrite           : False'
Write-Host 'MigrationGeneration    : False'
Write-Host 'SchemaPush             : False'
Write-Host 'MergePerformed         : False'
Write-Host 'BackupCreated          : False'
Write-Host 'ContainerTempFileWrite : True (removed after run)'

if ($parseExitCode -ne 0 -or $runSummary.allChecksMatched -ne $true) {
  throw 'Exact-before 未全部匹配；已打包失败证据，禁止进入备份或写入阶段。'
}
