param(
  [string[]]$Inputs = @(
    "data_local\payload\bangumi-work-entity-link-preview.json",
    "data_local\payload\bangumi-work-entity-link-patch-plan.json",
    "data_local\import_ready\bangumi-yuri-tagged.payload.json",
    "data_local\raw\bangumi-yuri-tagged.jsonl"
  ),
  [string]$Manifest = "data_local\media\bangumi-covers\manifest-powershell.json",
  [string]$Dir = "data_local\media\bangumi-covers\files",
  [string]$Report = "data_local\reports\bangumi-cover-cache-powershell.md",
  [switch]$FetchMissing,
  [switch]$Download,
  [int]$FetchLimit = 0,
  [int]$DelayMs = 300,
  [int]$Top = 120,
  [string]$UserAgent = "BaihepaileiCoverCache/0.1 (https://github.com/wtyliangtingRe/baihepailei)",
  [string]$Token = $env:BANGUMI_ACCESS_TOKEN
)

$ErrorActionPreference = "Stop"
$ApiBaseUrl = "https://api.bgm.tv"
$ImagePriority = @("large", "common", "medium", "grid", "small")
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Ensure-Directory {
  param([string]$PathValue)
  if ($PathValue) { New-Item -ItemType Directory -Force -Path $PathValue | Out-Null }
}

function Ensure-ParentDirectory {
  param([string]$FilePath)
  $parent = Split-Path -Parent $FilePath
  Ensure-Directory $parent
}

function Clean-Text {
  param($Value)
  if ($null -eq $Value) { return "" }
  return ([string]$Value).Trim() -replace "\s+", " "
}

function First-Text {
  param([object[]]$Values)
  foreach ($value in $Values) {
    $text = Clean-Text $value
    if ($text) { return $text }
  }
  return ""
}

function Get-SubjectId {
  param($Object)
  if ($null -eq $Object) { return "" }
  return First-Text @(
    $Object.bangumiSubjectId,
    $Object.externalIds.bangumiSubjectId,
    $Object.sourceRecordId,
    $Object.id,
    $Object.subject_id,
    $Object.raw.id,
    $Object.raw.subject_id,
    $Object.work.bangumiSubjectId
  )
}

function Get-SubjectTitle {
  param($Object)
  return First-Text @(
    $Object.title,
    $Object.name_cn,
    $Object.name,
    $Object.raw.name_cn,
    $Object.raw.name,
    $Object.work.title
  )
}

function Get-SubjectType {
  param($Object)
  return First-Text @($Object.type, $Object.raw.type, $Object.mediaType, $Object.work.mediaType)
}

function Visit-Objects {
  param(
    $Value,
    [System.Collections.Generic.List[object]]$Output
  )
  if ($null -eq $Value) { return }
  if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string]) -and -not ($Value -is [pscustomobject])) {
    foreach ($item in $Value) { Visit-Objects -Value $item -Output $Output }
    return
  }
  if ($Value -is [pscustomobject]) {
    $Output.Add($Value) | Out-Null
    foreach ($property in $Value.PSObject.Properties) {
      Visit-Objects -Value $property.Value -Output $Output
    }
  }
}

function Read-Records {
  param([string]$PathValue)
  if ($PathValue.EndsWith(".jsonl")) {
    $records = New-Object System.Collections.Generic.List[object]
    Get-Content -LiteralPath $PathValue -Encoding UTF8 | ForEach-Object {
      $line = $_.Trim()
      if ($line) { $records.Add(($line | ConvertFrom-Json)) | Out-Null }
    }
    return $records
  }

  $json = Get-Content -LiteralPath $PathValue -Encoding UTF8 -Raw | ConvertFrom-Json
  if ($json -is [array]) { return $json }
  if ($json.records -is [array]) { return $json.records }
  if ($json.subjects -is [array]) { return $json.subjects }
  if ($json.works -is [array]) { return $json.works }
  return @($json)
}

function Find-SubjectStubs {
  param(
    $Records,
    [string]$SourcePath
  )
  $objects = New-Object System.Collections.Generic.List[object]
  foreach ($record in $Records) { Visit-Objects -Value $record -Output $objects }
  $seen = @{}
  $stubs = New-Object System.Collections.Generic.List[object]
  foreach ($object in $objects) {
    $id = Get-SubjectId $object
    if (-not $id -or $seen.ContainsKey($id)) { continue }
    $seen[$id] = $true
    $stubs.Add([pscustomobject]@{
      bangumiSubjectId = $id
      title = Get-SubjectTitle $object
      type = Get-SubjectType $object
      sourcePath = $SourcePath
    }) | Out-Null
  }
  return $stubs
}

function Get-ImageCandidates {
  param($Subject)
  $candidates = New-Object System.Collections.Generic.List[object]
  if ($null -eq $Subject.images) { return $candidates }
  foreach ($key in $ImagePriority) {
    $url = Clean-Text $Subject.images.$key
    if ($url) {
      if ($url.StartsWith("//")) { $url = "https:$url" }
      $candidates.Add([pscustomobject]@{ kind = $key; url = $url }) | Out-Null
    }
  }
  return $candidates
}

function Get-HashPart {
  param([string]$Text)
  $sha = [System.Security.Cryptography.SHA1]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  $hash = $sha.ComputeHash($bytes)
  return ([System.BitConverter]::ToString($hash) -replace "-", "").ToLower().Substring(0, 12)
}

function New-CoverEntry {
  param(
    $Subject,
    $Stub
  )
  $candidates = Get-ImageCandidates $Subject
  if ($candidates.Count -eq 0) { return $null }
  $selected = $candidates[0]
  $id = Clean-Text $Subject.id
  if (-not $id) { $id = $Stub.bangumiSubjectId }
  $title = First-Text @($Stub.title, $Subject.name_cn, $Subject.name)
  $type = Clean-Text $Subject.type
  $ext = [System.IO.Path]::GetExtension(([uri]$selected.url).AbsolutePath)
  if (-not $ext) { $ext = ".jpg" }
  $hash = Get-HashPart "$id|$title|$($selected.url)"
  $fileName = "bgm-$id-$hash$ext"
  return [pscustomobject]@{
    bangumiSubjectId = $id
    title = $title
    type = $type
    selectedImageKind = $selected.kind
    imageUrl = $selected.url
    candidateImages = $candidates
    relativePath = "files/$fileName"
    sourcePath = "bangumi-api:$id"
  }
}

function Invoke-BangumiSubject {
  param([string]$Id)
  $headers = @{
    "User-Agent" = $UserAgent
    "Accept" = "application/json"
  }
  if ($Token) { $headers["Authorization"] = "Bearer $Token" }
  return Invoke-RestMethod "$ApiBaseUrl/v0/subjects/$Id" -Headers $headers
}

function Write-JsonUtf8 {
  param(
    [string]$PathValue,
    $Value
  )
  Ensure-ParentDirectory $PathValue
  $json = $Value | ConvertTo-Json -Depth 80
  [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($PathValue), $json, $Utf8NoBom)
}

function Write-Report {
  param(
    [string]$PathValue,
    $Result
  )
  Ensure-ParentDirectory $PathValue
  $meta = $Result.meta
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("# Bangumi cover cache PowerShell") | Out-Null
  $lines.Add("GeneratedAt: $($meta.generatedAt)") | Out-Null
  $lines.Add("") | Out-Null
  $lines.Add("## Summary") | Out-Null
  $lines.Add("- source: $($meta.source)") | Out-Null
  $lines.Add("- mode: $($meta.mode)") | Out-Null
  $lines.Add("- covers: $($meta.coversTotal)") | Out-Null
  if ($null -ne $meta.subjectStubsTotal) { $lines.Add("- subject stubs: $($meta.subjectStubsTotal)") | Out-Null }
  if ($null -ne $meta.fetchedSubjects) { $lines.Add("- fetched subjects: $($meta.fetchedSubjects)") | Out-Null }
  if ($null -ne $meta.fetchRemainingSubjects) { $lines.Add("- fetch remaining subjects: $($meta.fetchRemainingSubjects)") | Out-Null }
  if ($null -ne $meta.fetchFailedSubjects) { $lines.Add("- fetch failed subjects: $($meta.fetchFailedSubjects)") | Out-Null }
  if ($null -ne $meta.downloaded) { $lines.Add("- downloaded: $($meta.downloaded)") | Out-Null }
  if ($null -ne $meta.skipped) { $lines.Add("- skipped existing: $($meta.skipped)") | Out-Null }
  if ($null -ne $meta.errors) { $lines.Add("- errors: $($meta.errors)") | Out-Null }
  if ($null -ne $meta.bytes) { $lines.Add("- bytes: $($meta.bytes)") | Out-Null }
  $lines.Add("") | Out-Null
  $lines.Add("## Safety") | Out-Null
  $lines.Add("- Reads local Bangumi / Payload preview JSON only.") | Out-Null
  $lines.Add("- Writes only under data_local/media/bangumi-covers.") | Out-Null
  $lines.Add("- Does not upload Payload media.") | Out-Null
  $lines.Add("- Does not patch works.") | Out-Null
  $lines.Add("- Do not commit data_local outputs.") | Out-Null
  [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($PathValue), ($lines -join "`n"), $Utf8NoBom)
}

$allStubs = New-Object System.Collections.Generic.List[object]
$missingInputs = New-Object System.Collections.Generic.List[string]

foreach ($inputPath in $Inputs) {
  $resolved = [System.IO.Path]::GetFullPath($inputPath)
  if (-not (Test-Path -LiteralPath $resolved)) {
    $missingInputs.Add($resolved) | Out-Null
    continue
  }
  $records = Read-Records $resolved
  $stubs = Find-SubjectStubs -Records $records -SourcePath $resolved
  foreach ($stub in $stubs) { $allStubs.Add($stub) | Out-Null }
}

$stubById = @{}
foreach ($stub in $allStubs) {
  if ($stub.bangumiSubjectId -and -not $stubById.ContainsKey($stub.bangumiSubjectId)) {
    $stubById[$stub.bangumiSubjectId] = $stub
  }
}

$orderedStubs = @($stubById.Values | Sort-Object { [int]$_.bangumiSubjectId })
if ($FetchLimit -gt 0) { $fetchStubs = @($orderedStubs | Select-Object -First $FetchLimit) } else { $fetchStubs = $orderedStubs }

$covers = New-Object System.Collections.Generic.List[object]
$failedFetches = New-Object System.Collections.Generic.List[object]

if ($FetchMissing) {
  foreach ($stub in $fetchStubs) {
    try {
      $subject = Invoke-BangumiSubject $stub.bangumiSubjectId
      $entry = New-CoverEntry -Subject $subject -Stub $stub
      if ($null -ne $entry) {
        $covers.Add($entry) | Out-Null
      } else {
        $failedFetches.Add([pscustomobject]@{
          bangumiSubjectId = $stub.bangumiSubjectId
          title = $stub.title
          reason = "no-image-in-fetched-subject"
        }) | Out-Null
      }
    } catch {
      $failedFetches.Add([pscustomobject]@{
        bangumiSubjectId = $stub.bangumiSubjectId
        title = $stub.title
        reason = $_.Exception.Message
      }) | Out-Null
    }
    if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }
  }
}

$manifestObject = [pscustomobject]@{
  meta = [pscustomobject]@{
    source = "bangumi-cover-cache-manifest-powershell"
    mode = if ($FetchMissing) { "manifest-with-bangumi-fetch-no-payload-write" } else { "manifest-only-no-payload-write" }
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    inputs = @($Inputs | ForEach-Object { [System.IO.Path]::GetFullPath($_) })
    missingInputs = $missingInputs
    subjectStubsTotal = $stubById.Count
    fetchedSubjects = if ($FetchMissing) { $fetchStubs.Count } else { 0 }
    fetchRemainingSubjects = if ($FetchMissing) { [Math]::Max(0, $orderedStubs.Count - $fetchStubs.Count) } else { $orderedStubs.Count }
    fetchFailedSubjects = $failedFetches.Count
    coversTotal = $covers.Count
  }
  covers = @($covers)
  failedFetches = @($failedFetches)
}

Write-JsonUtf8 -PathValue $Manifest -Value $manifestObject

$resultObject = $manifestObject
if ($Download) {
  Ensure-Directory $Dir
  $results = New-Object System.Collections.Generic.List[object]
  $bytesTotal = 0
  foreach ($cover in $covers) {
    $fileName = [System.IO.Path]::GetFileName($cover.relativePath)
    $outputPath = Join-Path $Dir $fileName
    try {
      if (Test-Path -LiteralPath $outputPath) {
        $results.Add([pscustomobject]@{
          bangumiSubjectId = $cover.bangumiSubjectId
          title = $cover.title
          imageUrl = $cover.imageUrl
          outputPath = $outputPath
          status = "skipped-existing"
          bytes = 0
        }) | Out-Null
      } else {
        Invoke-WebRequest -Uri $cover.imageUrl -Headers @{ "User-Agent" = $UserAgent; "Accept" = "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8" } -OutFile $outputPath
        $size = (Get-Item -LiteralPath $outputPath).Length
        $bytesTotal += $size
        $results.Add([pscustomobject]@{
          bangumiSubjectId = $cover.bangumiSubjectId
          title = $cover.title
          imageUrl = $cover.imageUrl
          outputPath = $outputPath
          status = "downloaded"
          bytes = $size
        }) | Out-Null
      }
    } catch {
      $results.Add([pscustomobject]@{
        bangumiSubjectId = $cover.bangumiSubjectId
        title = $cover.title
        imageUrl = $cover.imageUrl
        outputPath = $outputPath
        status = "error"
        error = $_.Exception.Message
        bytes = 0
      }) | Out-Null
    }
    if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }
  }

  $downloaded = @($results | Where-Object { $_.status -eq "downloaded" }).Count
  $skipped = @($results | Where-Object { $_.status -eq "skipped-existing" }).Count
  $errors = @($results | Where-Object { $_.status -eq "error" }).Count
  $resultObject = [pscustomobject]@{
    meta = [pscustomobject]@{
      source = "bangumi-cover-cache-powershell"
      mode = "download-local-files-no-payload-write"
      generatedAt = (Get-Date).ToUniversalTime().ToString("o")
      outputDir = [System.IO.Path]::GetFullPath($Dir)
      coversTotal = $covers.Count
      downloaded = $downloaded
      skipped = $skipped
      errors = $errors
      bytes = $bytesTotal
    }
    results = @($results)
  }
}

Write-Report -PathValue $Report -Result $resultObject
Write-Host "Wrote Bangumi cover manifest -> $([System.IO.Path]::GetFullPath($Manifest))"
Write-Host "Wrote Bangumi cover report -> $([System.IO.Path]::GetFullPath($Report))"
if ($Download) { Write-Host "Cached Bangumi covers -> $([System.IO.Path]::GetFullPath($Dir))" }
if ($manifestObject.meta.fetchFailedSubjects -gt 0 -or ($Download -and $resultObject.meta.errors -gt 0)) { exit 1 }
