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
$sourcePath = Join-Path $PSScriptRoot 'run-and-package-radar-remaining-canonical-inventory-v01.ps1'
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "找不到 inventory V01 runner：$sourcePath"
}

$content = (Get-Content -LiteralPath $sourcePath -Raw -Encoding UTF8).Replace("`r`n", "`n").Replace("`r", "`n")

function Replace-Exact([string]$Needle, [string]$Replacement, [int]$Expected = 1) {
  $count = ([regex]::Matches($script:content, [regex]::Escape($Needle))).Count
  if ($count -ne $Expected) {
    throw "inventory V02 精确补丁出现次数不正确；预期 $Expected，实际 $count：$Needle"
  }
  $script:content = $script:content.Replace($Needle, $Replacement)
}

Replace-Exact `
  'build-radar-remaining-canonical-inventory-v01.mjs' `
  'build-radar-remaining-canonical-inventory-v02.mjs'

Replace-Exact `
  '剩余 canonical Works inventory V01 已完成～' `
  '剩余 canonical Works inventory V02 已完成～'

$temporaryPath = Join-Path $PSScriptRoot ('.run-and-package-radar-remaining-canonical-inventory-v02-' + [guid]::NewGuid().ToString('N') + '.ps1')
[System.IO.File]::WriteAllText($temporaryPath, $content, [System.Text.UTF8Encoding]::new($false))

function Show-FailureDiagnostics {
  Write-Host ''
  Write-Host '==> Inventory V02 失败诊断现场' -ForegroundColor Yellow

  $worktrees = @(
    git -C $repoRoot worktree list --porcelain |
      Where-Object { $_.StartsWith('worktree ') } |
      ForEach-Object { $_.Substring('worktree '.Length) } |
      Where-Object {
        $_.Replace('/', '\') -like 'D:\binv\*'
      }
  )
  if ($worktrees.Count -gt 0) {
    Write-Host '保留的短路径 worktree：' -ForegroundColor Yellow
    $worktrees | ForEach-Object { Write-Host "  $_" }
  }

  $tempDirectory = @(
    Get-ChildItem -LiteralPath ([System.IO.Path]::GetTempPath()) -Directory -Filter 'radar-remaining-inventory-*' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTimeUtc -Descending |
      Select-Object -First 1
  )
  if ($tempDirectory.Count -eq 1) {
    Write-Host "诊断目录：$($tempDirectory[0].FullName)" -ForegroundColor Yellow
    foreach ($name in @('inventory-server-stdout.log', 'inventory-server-stderr.log')) {
      $log = Join-Path $tempDirectory[0].FullName $name
      if (Test-Path -LiteralPath $log -PathType Leaf) {
        Write-Host ''
        Write-Host "--- $name 最后 120 行 ---" -ForegroundColor DarkYellow
        Get-Content -LiteralPath $log -Tail 120 -Encoding UTF8
      }
    }
  }

  $partialOutput = @(
    Get-ChildItem -LiteralPath (Join-Path $repoRoot 'exports') -Directory -Filter 'radar-remaining-canonical-inventory-*' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTimeUtc -Descending |
      Select-Object -First 1
  )
  if ($partialOutput.Count -eq 1) {
    Write-Host ''
    Write-Host "部分输出目录：$($partialOutput[0].FullName)" -ForegroundColor Yellow
    Get-ChildItem -LiteralPath $partialOutput[0].FullName -File -Recurse -ErrorAction SilentlyContinue |
      Sort-Object FullName |
      ForEach-Object {
        Write-Host ('  ' + $_.FullName.Substring($partialOutput[0].FullName.Length + 1))
      }
  }
}

try {
  & $temporaryPath `
    -ExpectedBranchHead $ExpectedBranchHead `
    -ExpectedBaseCommit $ExpectedBaseCommit `
    -ExpectedBranch $ExpectedBranch `
    -ExpectedPublicCurrent $ExpectedPublicCurrent `
    -BatchSize $BatchSize `
    -WaveSize $WaveSize `
    -Port $Port `
    -ReadyTimeoutSeconds $ReadyTimeoutSeconds

  if ($LASTEXITCODE -ne 0) {
    throw "Inventory V02 runner 返回失败状态：$LASTEXITCODE"
  }
} catch {
  Show-FailureDiagnostics
  throw
} finally {
  Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
}
