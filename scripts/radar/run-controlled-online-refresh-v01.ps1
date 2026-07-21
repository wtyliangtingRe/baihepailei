[CmdletBinding()]
param(
  [ValidateSet('quick', 'full')]
  [string]$Profile = 'quick',
  [string]$Sources = 'bangumi,vndb,steam',
  [string]$Url = 'http://127.0.0.1:3000',
  [string]$EnvFile = '.env',
  [string]$Proxy = '',
  [switch]$Sample,
  [switch]$NoProxyAutoDetect
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$originalLocation = Get-Location
$originalBangumiProxy = [Environment]::GetEnvironmentVariable('BANGUMI_PROXY', 'Process')

try {
  Set-Location $repoRoot

  if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Environment file not found: $EnvFile"
  }

  if ([string]::IsNullOrWhiteSpace($env:RADAR_PAYLOAD_EMAIL) -or [string]::IsNullOrWhiteSpace($env:RADAR_PAYLOAD_PASSWORD)) {
    throw 'Set RADAR_PAYLOAD_EMAIL and RADAR_PAYLOAD_PASSWORD in the current PowerShell process before running this command. The password must not be stored in the repository.'
  }

  $sourceList = @($Sources.Split(',') | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })

  if ($sourceList -contains 'bangumi') {
    if (-not [string]::IsNullOrWhiteSpace($Proxy)) {
      $env:BANGUMI_PROXY = $Proxy
      Write-Host "Bangumi proxy: $Proxy"
    } elseif ([string]::IsNullOrWhiteSpace($env:BANGUMI_PROXY) -and -not $NoProxyAutoDetect) {
      if (Test-NetConnection '127.0.0.1' -Port 10808 -InformationLevel Quiet -WarningAction SilentlyContinue) {
        $env:BANGUMI_PROXY = 'http://127.0.0.1:10808'
        Write-Host "Detected v2rayN proxy for Bangumi: $env:BANGUMI_PROXY"
      } else {
        Write-Warning 'No Bangumi proxy was configured and 127.0.0.1:10808 is unavailable. Direct access may time out.'
      }
    }
  }

  if ($sourceList -contains 'yurizukan') {
    Write-Warning 'Yurizukan is explicitly enabled, but its public routes are currently being repaired. A 404 is a source failure.'
  }

  $nodeArgs = @(
    "--env-file=$EnvFile",
    'scripts/radar/run-controlled-online-refresh-v01.mjs',
    '--url', $Url,
    '--profile', $Profile,
    '--sources', ($sourceList -join ',')
  )

  if ($Sample) {
    $nodeArgs += @(
      '--bangumi-pages', '1',
      '--vndb-pages', '1',
      '--yurizukan-pages', '1',
      '--yurizukan-max-articles', '10',
      '--steam-pages', '1',
      '--steam-max-apps', '20'
    )
  }

  Write-Host ''
  Write-Host 'Controlled online refresh'
  Write-Host "- URL: $Url"
  Write-Host "- profile: $Profile"
  Write-Host "- sources: $($sourceList -join ',')"
  Write-Host "- sample limits: $Sample"
  Write-Host '- Payload write: false'
  Write-Host '- assessment mutation: false'
  Write-Host ''

  & node @nodeArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Controlled online refresh failed with exit code $LASTEXITCODE"
  }
} finally {
  if ($null -eq $originalBangumiProxy) {
    Remove-Item Env:BANGUMI_PROXY -ErrorAction SilentlyContinue
  } else {
    $env:BANGUMI_PROXY = $originalBangumiProxy
  }
  Set-Location $originalLocation
}
