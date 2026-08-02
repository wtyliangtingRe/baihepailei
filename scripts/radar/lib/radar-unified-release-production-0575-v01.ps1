$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-RadarJsonFile([string]$Path, [object]$Value) {
  $json = $Value | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($Path, ($json.TrimEnd() + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
}

function Get-RadarDirtyPaths {
  $paths = @()
  foreach ($line in @(git status --short)) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $path = ([string]$line).Substring(3).Trim()
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1].Trim() }
    $paths += $path.Replace('\', '/')
  }
  return @($paths)
}

function Get-RadarConfiguredValue([string[]]$Names) {
  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
  }
  foreach ($envFile in @('.env.development.local', '.env.local', '.env.development', '.env')) {
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { continue }
    $lines = @(Microsoft.PowerShell.Management\Get-Content -LiteralPath $envFile -Encoding UTF8)
    foreach ($name in $Names) {
      $escaped = [regex]::Escape($name)
      $line = $lines | Where-Object { $_ -match "^\s*$escaped\s*=" } | Select-Object -First 1
      if ($line) {
        $value = (($line -split '=', 2)[1].Trim()).Trim('"').Trim("'")
        if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
      }
    }
  }
  return $null
}

function Invoke-RadarWithEnvironment([hashtable]$Variables, [scriptblock]$Action) {
  $saved = @{}
  foreach ($name in $Variables.Keys) {
    $saved[$name] = [pscustomobject]@{
      Exists = Test-Path "Env:$name"
      Value = [Environment]::GetEnvironmentVariable([string]$name, 'Process')
    }
    [Environment]::SetEnvironmentVariable([string]$name, [string]$Variables[$name], 'Process')
  }
  try { & $Action } finally {
    foreach ($name in $Variables.Keys) {
      if ($saved[$name].Exists) {
        [Environment]::SetEnvironmentVariable([string]$name, [string]$saved[$name].Value, 'Process')
      } else {
        [Environment]::SetEnvironmentVariable([string]$name, $null, 'Process')
      }
    }
  }
}

function Read-RadarMapFile([string]$Path) {
  $map = @{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
    $parts = ([string]$line).Split("`t")
    if ($parts.Count -lt 2) { throw "无法解析 TSV：$line" }
    if ($map.ContainsKey($parts[0])) { throw "TSV 键重复：$($parts[0])" }
    $map[$parts[0]] = ($parts[1..($parts.Count - 1)] -join "`t")
  }
  return $map
}

function Assert-RadarMapsEqual([hashtable]$Expected, [hashtable]$Actual, [string]$Label) {
  $expectedKeys = @($Expected.Keys | Sort-Object)
  $actualKeys = @($Actual.Keys | Sort-Object)
  if (($expectedKeys -join "`n") -ne ($actualKeys -join "`n")) { throw "$Label 的键集合不一致。" }
  foreach ($key in $expectedKeys) {
    if ([string]$Expected[$key] -ne [string]$Actual[$key]) { throw "$Label 不一致：$key" }
  }
}

function Assert-RadarFileHash([string]$Path, [string]$Expected, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "找不到 $Label：$Path" }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Expected.ToLowerInvariant()) { throw "$Label SHA-256 不匹配：$actual" }
  return $actual
}

function Get-RadarFreePort([int]$Minimum, [int]$Maximum) {
  for ($attempt = 0; $attempt -lt 80; $attempt += 1) {
    $port = Get-Random -Minimum $Minimum -Maximum ($Maximum + 1)
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    try { $listener.Start(); return $port } catch { continue } finally { try { $listener.Stop() } catch {} }
  }
  throw '找不到空闲 loopback 端口。'
}

function Stop-RadarProcess([object]$Process) {
  if ($null -eq $Process) { return }
  try {
    if ($IsWindows) { & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null }
    else { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue }
  } catch {}
}

function Wait-RadarProductionMarker(
  [string]$Url,
  [string]$Nonce,
  [string]$ExpectedPhase,
  [string]$ExpectedDatabase,
  [string]$ExpectedMainHead,
  [string]$ExpectedResearchHead,
  [string]$ExpectedReleaseId,
  [string]$ExpectedCandidateSha256,
  [object]$Process,
  [int]$TimeoutSeconds
) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if ($Process.HasExited) { throw "Payload 进程提前退出：$($Process.ExitCode)" }
    try {
      $marker = Invoke-RestMethod -Uri "$Url/api/radar-unified-release-production-marker" -Method Get `
        -Headers @{ 'x-radar-unified-release-production-nonce' = $Nonce } -TimeoutSec 10
      if (
        $marker.productionMode -eq $true -and
        [string]$marker.phase -eq $ExpectedPhase -and
        [string]$marker.database -eq $ExpectedDatabase -and
        [string]$marker.mainHead -eq $ExpectedMainHead -and
        [string]$marker.researchHead -eq $ExpectedResearchHead -and
        [string]$marker.releaseId -eq $ExpectedReleaseId -and
        [string]$marker.candidateSha256 -eq $ExpectedCandidateSha256
      ) { return $marker }
    } catch {}
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Payload 未通过生产 marker。'
}

function Invoke-RadarSqlFile(
  [string]$Container,
  [string]$Database,
  [string]$User,
  [string]$Password,
  [string]$HostFile,
  [string]$ContainerFile,
  [string]$OutputFile,
  [string]$ErrorFile,
  [switch]$ReadOnly
) {
  & docker cp $HostFile "${Container}:$ContainerFile" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "复制 SQL 失败：$ContainerFile" }
  try {
    $args = @('exec')
    if (-not [string]::IsNullOrWhiteSpace($Password)) { $args += @('-e', "PGPASSWORD=$Password") }
    $pgOptions = if ($ReadOnly) {
      '-c default_transaction_read_only=on -c TimeZone=UTC -c client_min_messages=warning'
    } else {
      '-c TimeZone=UTC -c client_min_messages=warning'
    }
    $args += @('-e', "PGOPTIONS=$pgOptions", $Container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', $User, '-d', $Database, '-f', $ContainerFile)
    & docker @args 1> $OutputFile 2> $ErrorFile
    if ($LASTEXITCODE -ne 0) { throw "SQL 执行失败：$ContainerFile" }
    $stderr = @(Get-Content -LiteralPath $ErrorFile -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    if ($stderr.Count -gt 0) { throw "SQL stderr 非空：$ContainerFile" }
  } finally {
    & docker exec $Container rm -f $ContainerFile 2>$null | Out-Null
  }
}

function Get-RadarNormalizedLegacySchema(
  [string]$Container,
  [string]$Database,
  [string]$User,
  [string]$Password
) {
  $args = @('exec')
  if (-not [string]::IsNullOrWhiteSpace($Password)) { $args += @('-e', "PGPASSWORD=$Password") }
  $args += @(
    $Container,
    'pg_dump', '--schema-only', '--quote-all-identifiers', '--no-owner',
    '-U', $User, '-d', $Database,
    '--table', 'public.radar_public',
    '--table', 'public.radar_public_review_reasons',
    '--table', 'public.radar_public_radar_assessment_matched_rules',
    '--table', 'public.radar_public_radar_assessment_contradictions'
  )
  $raw = (& docker @args | Out-String)
  if ($LASTEXITCODE -ne 0) { throw '读取 legacy Radar schema 失败。' }
  $lines = @(
    $raw.Replace("`r`n", "`n").Split("`n") |
      ForEach-Object { $_.TrimEnd() } |
      Where-Object {
        $trimmed = $_.Trim()
        $trimmed -and
        -not $trimmed.StartsWith('--') -and
        -not $trimmed.StartsWith('\restrict ') -and
        -not $trimmed.StartsWith('\unrestrict ') -and
        -not $trimmed.StartsWith('SET ') -and
        -not $trimmed.StartsWith('SELECT pg_catalog.set_config')
      }
  )
  return (($lines -join "`n") + "`n")
}

function Write-RadarManifest([string]$Directory) {
  $manifestPath = Join-Path $Directory 'manifest.json'
  $shaPath = Join-Path $Directory 'SHA256SUMS'
  Remove-Item -LiteralPath $manifestPath, $shaPath -Force -ErrorAction SilentlyContinue
  $entries = @()
  foreach ($file in Get-ChildItem -LiteralPath $Directory -File -Recurse | Sort-Object FullName) {
    if ($file.Name -eq 'database-backup.dump') { continue }
    $relative = $file.FullName.Substring($Directory.Length).TrimStart('\', '/').Replace('\', '/')
    $entries += [ordered]@{
      file = $relative
      bytes = [long]$file.Length
      sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  Write-RadarJsonFile $manifestPath $entries
  [System.IO.File]::WriteAllText(
    $shaPath,
    ((@($entries | ForEach-Object { "$($_.sha256)  $($_.file)" }) -join "`n") + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
}
