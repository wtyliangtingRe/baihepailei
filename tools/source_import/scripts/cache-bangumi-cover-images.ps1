param(
  [int]$Limit = 20,
  [switch]$Download,
  [int]$DelayMs = 300,
  [string]$Preview = "data_local\payload\bangumi-work-entity-link-preview.json",
  [string]$Manifest = "data_local\media\bangumi-covers\manifest-direct.json",
  [string]$Dir = "data_local\media\bangumi-covers\files",
  [string]$UserAgent = "BaihepaileiCoverCache/0.1"
)

$ErrorActionPreference = "Stop"

function Resolve-LocalPath {
  param([string]$PathValue)
  return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PathValue)
}

function Ensure-Directory {
  param([string]$PathValue)
  if ($PathValue) {
    New-Item -ItemType Directory -Force -Path $PathValue | Out-Null
  }
}

function Get-SubjectCoverUrl {
  param($Subject)

  foreach ($kind in @("large", "common", "medium", "grid", "small")) {
    $candidate = [string]$Subject.images.$kind
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      if ($candidate.StartsWith("//")) {
        $candidate = "https:$candidate"
      }
      return [pscustomobject]@{
        kind = $kind
        url = $candidate
      }
    }
  }

  return $null
}

function Write-JsonFile {
  param(
    [string]$PathValue,
    $Value
  )

  $fullPath = Resolve-LocalPath $PathValue
  Ensure-Directory (Split-Path -Parent $fullPath)
  $json = $Value | ConvertTo-Json -Depth 30
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($fullPath, $json, $utf8NoBom)
}

$previewPath = Resolve-LocalPath $Preview
$manifestPath = Resolve-LocalPath $Manifest
$dirPath = Resolve-LocalPath $Dir

$headers = @{
  "User-Agent" = $UserAgent
  "Accept" = "application/json"
}

$imageHeaders = @{
  "User-Agent" = $UserAgent
  "Accept" = "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8"
}

Ensure-Directory (Split-Path -Parent $manifestPath)
Ensure-Directory $dirPath

$previewData = Get-Content $previewPath -Encoding UTF8 -Raw | ConvertFrom-Json
$seen = @{}
$worksList = New-Object System.Collections.ArrayList

foreach ($row in @($previewData.works)) {
  $work = $row.work
  if ($null -eq $work) { continue }

  $id = [string]$work.bangumiSubjectId
  if ([string]::IsNullOrWhiteSpace($id)) { continue }
  if ($seen.ContainsKey($id)) { continue }

  $seen[$id] = $true
  [void]$worksList.Add([pscustomobject]@{
    bangumiSubjectId = $id
    title = [string]$work.title
  })
}

$works = @($worksList | Sort-Object { [int64]$_.bangumiSubjectId })
if ($Limit -gt 0) {
  $works = @($works | Select-Object -First $Limit)
}

$results = New-Object System.Collections.ArrayList
$totalBytes = [int64]0

foreach ($work in $works) {
  $id = $work.bangumiSubjectId
  $title = $work.title

  try {
    $subject = Invoke-RestMethod "https://api.bgm.tv/v0/subjects/$id" -Headers $headers
    $cover = Get-SubjectCoverUrl $subject
    if ($null -eq $cover) {
      throw "no image url"
    }

    $uri = [uri]$cover.url
    $ext = [System.IO.Path]::GetExtension($uri.AbsolutePath)
    if ([string]::IsNullOrWhiteSpace($ext)) {
      $ext = ".jpg"
    }

    $fileName = "bgm-$id$ext"
    $outputPath = Join-Path $dirPath $fileName
    $status = "planned"
    $bytes = [int64]0

    if ($Download) {
      if (Test-Path -LiteralPath $outputPath) {
        $status = "skipped-existing"
        $bytes = [int64](Get-Item -LiteralPath $outputPath).Length
      } else {
        Invoke-WebRequest -UseBasicParsing -Uri $cover.url -Headers $imageHeaders -OutFile $outputPath
        $status = "downloaded"
        $bytes = [int64](Get-Item -LiteralPath $outputPath).Length
      }
      $totalBytes += $bytes
    }

    [void]$results.Add([pscustomobject]@{
      bangumiSubjectId = $id
      title = $title
      imageKind = $cover.kind
      imageUrl = $cover.url
      relativePath = "files/$fileName"
      outputPath = $outputPath
      status = $status
      bytes = $bytes
    })
  } catch {
    [void]$results.Add([pscustomobject]@{
      bangumiSubjectId = $id
      title = $title
      status = "error"
      error = $_.Exception.Message
    })
  }

  if ($DelayMs -gt 0) {
    Start-Sleep -Milliseconds $DelayMs
  }
}

$errors = @($results | Where-Object { $_.status -eq "error" }).Count
$downloaded = @($results | Where-Object { $_.status -eq "downloaded" }).Count
$skipped = @($results | Where-Object { $_.status -eq "skipped-existing" }).Count
$covers = @($results | Where-Object { $_.status -ne "error" })

$mode = "manifest-only-no-payload-write"
if ($Download) {
  $mode = "download-local-files-no-payload-write"
}

$out = [pscustomobject]@{
  meta = [pscustomobject]@{
    source = "bangumi-cover-cache-direct-powershell"
    mode = $mode
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    requested = @($works).Count
    coversTotal = @($covers).Count
    downloaded = $downloaded
    skipped = $skipped
    errors = $errors
    bytes = $totalBytes
  }
  covers = $covers
  results = @($results)
}

Write-JsonFile -PathValue $manifestPath -Value $out
$out.meta | Format-List

if ($errors -gt 0) {
  exit 1
}
