param(
  [Parameter(Mandatory = $true)][string]$ExpectedToolHead,
  [Parameter(Mandatory = $true)][ValidateSet('RUN-RADAR-UNIFIED-RATING-INCREMENTAL-PLAN-9988-V01')][string]$Confirm,
  [string]$ResearchRepo = 'D:\0GitHubtest\baihepailei-research-data',
  [string]$Url = 'http://127.0.0.1:3000',
  [string]$PayloadEmail = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedBranch = 'agent/radar-unified-release-incremental-9988-v01'
$ExpectedBaseMain = '24bd2f8a8d27a91282dd4d3e27ddf5e0804c6a94'
$ExpectedResearchHead = 'c8790df95d1235d8d1aacabfb7c119fec9e1c642'
$ReleasePath = 'releases\public\radar-unified-rating-incremental-release-9988-0001\v01'
$AllowedDirtyFiles = @('next-env.d.ts', 'payload-types.ts')
$ExpectedFiles = [ordered]@{
  'manifest.json' = '40c8e474c5a6614b259c2ab9402e404fab9bf0c9411c2a3590885f7e619fe896'
  'records.jsonl' = '827c5d8c7ea958bf614f2a19db2ad2db2a6847dd7c82d718614a4bcb9cac71a9'
  'ratings.jsonl' = '4c1a55c8cdabbd92bb8c081a28b30b6c2f3e87d370dcfccb89ed776fe0d14d18'
  'release-index.jsonl' = '0412d6e8108d1c0172001cc4986fd376475fdd2dfb52ee1848c14f022ccb419f'
  'identity-review-excluded.jsonl' = 'ad834663fc5b83dd5fbe0e46dd6e28b8684b5b6853e74099929f0f308a55c7a2'
}

if ($Confirm -ne 'RUN-RADAR-UNIFIED-RATING-INCREMENTAL-PLAN-9988-V01') {
  throw '确认字符串不匹配。'
}
if ($ExpectedToolHead -notmatch '^[a-f0-9]{40}$') {
  throw 'ExpectedToolHead 格式无效。'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

$unexpected = @(
  git status --short |
    ForEach-Object {
      if ($_ -and $_.Length -ge 4) { $_.Substring(3).Trim().Replace('\', '/') }
    } |
    Where-Object { $_ -and $_ -notin $AllowedDirtyFiles }
)
if ($unexpected.Count -gt 0) {
  throw "网站仓库存在预期外本地修改：$($unexpected -join ', ')"
}

git fetch origin
if ($LASTEXITCODE -ne 0) { throw '获取网站仓库远端更新失败。' }
git switch $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '切换 9,988 条计划分支失败。' }
git pull --ff-only origin $ExpectedBranch
if ($LASTEXITCODE -ne 0) { throw '更新 9,988 条计划分支失败。' }

$toolHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($toolHead -ne $ExpectedToolHead -or $remoteHead -ne $ExpectedToolHead) {
  throw "计划工具提交不符合预期：local=$toolHead remote=$remoteHead expected=$ExpectedToolHead"
}
& git merge-base --is-ancestor $ExpectedBaseMain $toolHead
if ($LASTEXITCODE -ne 0) {
  throw '计划工具不包含已合并的公开评级与注册档案基线。'
}

$resolvedResearchRepo = (Resolve-Path -LiteralPath $ResearchRepo).Path
Push-Location $resolvedResearchRepo
try {
  git fetch origin
  if ($LASTEXITCODE -ne 0) { throw '获取研究仓库远端更新失败。' }
  git switch main
  if ($LASTEXITCODE -ne 0) { throw '切换研究仓库 main 失败。' }
  git pull --ff-only origin main
  if ($LASTEXITCODE -ne 0) { throw '更新研究仓库 main 失败。' }
  $researchHead = (git rev-parse HEAD).Trim()
  $researchRemoteHead = (git rev-parse origin/main).Trim()
  if ($researchHead -ne $ExpectedResearchHead -or $researchRemoteHead -ne $ExpectedResearchHead) {
    throw "研究仓库提交不符合预期：local=$researchHead remote=$researchRemoteHead expected=$ExpectedResearchHead"
  }
} finally {
  Pop-Location
}

$releaseDirectory = Join-Path $resolvedResearchRepo $ReleasePath
foreach ($entry in $ExpectedFiles.GetEnumerator()) {
  $file = Join-Path $releaseDirectory $entry.Key
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw "统一 Release 缺少文件：$($entry.Key)"
  }
  $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $entry.Value) {
    throw "统一 Release SHA 不匹配：$($entry.Key) actual=$actual expected=$($entry.Value)"
  }
}

try {
  $health = Invoke-WebRequest -UseBasicParsing -Uri "$($Url.TrimEnd('/'))/api/works?limit=1&depth=0" -Method Get -TimeoutSec 20
  if ($health.StatusCode -ne 200) { throw "HTTP $($health.StatusCode)" }
} catch {
  throw "本地网站服务不可用：$Url。请先在当前分支用端口 3000 启动网站。详情：$($_.Exception.Message)"
}

$email = $PayloadEmail.Trim()
if (-not $email) {
  $email = [string]($env:RADAR_PAYLOAD_EMAIL ?? $env:PAYLOAD_EXPORT_EMAIL ?? $env:PAYLOAD_SEED_EMAIL)
  $email = $email.Trim()
}
if (-not $email) {
  $email = (Read-Host '请输入现有 Payload 管理员邮箱').Trim()
}
if (-not $email) { throw 'Payload 管理员邮箱不能为空。' }

$securePassword = Read-Host '请输入现有 Payload 管理员密码' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if (-not $plainPassword) { throw 'Payload 管理员密码不能为空。' }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $outDir = Join-Path $repoRoot "data_local\outputs\radar-unified-rating-incremental-release-9988-v01\transition-plan-$stamp"
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null

  $env:RADAR_PAYLOAD_EMAIL = $email
  $env:RADAR_PAYLOAD_PASSWORD = $plainPassword

  node ".\scripts\radar\plan-unified-rating-incremental-release-9988-v01.mjs" `
    --input $releaseDirectory `
    --url $Url `
    --out-dir $outDir `
    --expected-main-head $ExpectedBaseMain `
    --confirm 'PLAN-RADAR-UNIFIED-RATING-INCREMENTAL-RELEASE-9988-V01'
  if ($LASTEXITCODE -ne 0) {
    throw '9,988 条只读 transition plan 失败。'
  }

  Write-Host "`n9,988 条只读 transition plan 已通过。" -ForegroundColor Green
  Write-Host "输出目录：$outDir" -ForegroundColor Green
  Write-Host '本轮没有 Records/Ratings create、update 或 delete 请求。' -ForegroundColor Green
  Write-Host '注意：管理员登录可能新增 1 个 auth session。' -ForegroundColor Yellow
} finally {
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  Remove-Item Env:RADAR_PAYLOAD_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:RADAR_PAYLOAD_EMAIL -ErrorAction SilentlyContinue
  $plainPassword = $null
  $securePassword = $null
}
