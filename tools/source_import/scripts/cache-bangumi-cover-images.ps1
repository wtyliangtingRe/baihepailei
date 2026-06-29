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

function New-DirectoryForFile {
  param([string]$FilePath)
  $parent = Split-Path -Parent (Resolve-Path -LiteralPath (Split-Path -Parent $FilePath) -ErrorAction SilentlyContinue)
  if (-not $parent) {
    $parent = Split-Path -Parent $FilePath
  }
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
}

function Ensure-Directory {
  param([string]$PathValue)
  New-Item -ItemType Directory -Force -Path $PathValue | Out-Null
}

function Clean-Text {
  param($Value)
  if ($null -eq $Value) { return "" }
  return ([string]$Value).Trim() -replace "\s+", " "
}

function Get-SubjectId {
  param($Object)
  if ($null -eq $Object) { return "" }
  foreach ($candidate in @(
    $Object.bangumiSubjectId,
    $Object.externalIds.bangumiSubjectId,
    $Object.sourceRecordId,
    $Object.id,
    $Object.subject_id,
    $Object.raw.id,
    $Object.raw.subject_id,
    $Object.work.bangumiSubjectId
  )) {
    if ($null -ne $candidate -and "" -ne [string]$candidate) { return [string]$candidate }
  }
  return ""
}

function Get-SubjectTitle {
  param($Object)
  foreach ($candidate in @(
    $Object.title,
    $Object.name_cn,
    $Object.name,
    $Object.raw.name_cn,
    $Object.raw.name,
    $Object.work.title
  )) {
    $text = Clean-Text $candidate
    if ($text) { return $text }
  }
  return ""
}

function Get-SubjectType {
  param($Object)
  foreach ($candidate in @($Object.type, $Object.raw.type, $Object.mediaType, $Object.work.mediaType)) {
    if ($null -ne $candidate -and "" -ne [string]$candidate) { return [string]$candidate }
  }
  return ""
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

function Get-FileHashPart {
  param([string]$Text)
  $sha = [System.Security.Cryptography.SHA1]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  $hash = $sha.ComputeHash($bytes)
  return ([System.BitConverter]::ToString($hash) -replace "-", "").ToLower().Substring(0, 12)
}

function Get-SafeFileStem {
  param(
    [string]$Id,
    [string]$Title,
    [string]$Url
  )
  $hash = Get-FileHashPart "$Id|$Title|$Url"
  $safeTitle = (Clean-Text $Title).ToLower() -replace "[^\p{L}\p{Nd}]+", "-"
  $safeTitle = $safeTitle.Trim("-")
  if ($safeTitle.Length -gt 60) { $safeTitle = $safeTitle.Substring(0, 60).Trim("-") }
  $parts = @()
  if ($Id) { $parts += "bgm-$Id" } else { $parts += "bgm-unknown" }
  if ($safeTitle) { $parts += $safeTitle }
  $parts += $hash
  return ($parts -join "-")
}

function New-CoverEntry {
  param(
    $Subject,
    $Stub
  )
  $candidates = Get-ImageCandidates $Subject
  if ($candidates.Count -eq 0) { return $null }
  $selected = $candidates[0]
  $id = [string]$Subject.id
  if (-not $id) { $id = $Stub.bangumiSubjectId }
  $title = Clean-Text $Stub.title
  if (-not $title) { $title = Clean-Text $Subject.name_cn }
  if (-not $title) { $title = Clean-Text $Subject.name }
  $ext = [System.IO.Path]::GetExtension(([uri]$selected.url).AbsolutePath)
  if (-not $ext) { $ext = ".jpg" }
  $stem = Get-SafeFileStem -Id $id -Title $title -Url $selected.url
  return [pscustomobject]@{
    bangumiSubjectId = $id
    title = $title
    type = [string]$Subject.type
    selectedImageKind = $selected.kind
    imageUrl = $selected.url
    candidateImages = $candidates
    relativePath = "files/$stem$ext"
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
  New-DirectoryForFile $PathValue
  $Value | ConvertTo-Json -Depth 80 | Out-File -LiteralPath $PathValue -Encoding UTF8
}

function Write-Report {
  param(
    [string]$PathValue,
    $Result,
    [int]$TopRows
  )
  New-DirectoryForFile $PathValue
  $meta = $Result.meta
  $rows = @($Result.covers)
  if ($null -eq $rows -or $rows.Count -eq 0) { $rows = @($Result.results) }
  $sample = @($rows | Select-Object -First $TopRows)
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("# Bangumi cover cache PowerShell") | Out-Null
  $lines.Add("生成时间：$($meta.generatedAt)") | Out-Null
  $lines.Add("") | Out-Null
  $lines.Add("## 总览") | Out-Null
  $lines.Add("- 模式：$($meta.mode)") | Out-Null
  $lines.Add("- covers：$($meta.coversTotal)") | Out-Null
  if ($null -ne $meta.subjectStubsTotal) { $lines.Add("- subject stubs：$($meta.subjectStubsTotal)") | Out-Null }
  if ($null -ne $meta.fetchedSubjects) { $lines.Add("- fetched subjects：$($meta.fetchedSubjects)") | Out-Null }
  if ($null -ne $meta.fetchRemainingSubjects) { $lines.Add("- fetch remaining subjects：$($meta.fetchRemainingSubjects)") | Out-Null }
  if ($null -ne $meta.fetchFailedSubjects) { $lines.Add("- fetch failed subjects：$($meta.fetchFailedSubjects)") | Out-Null }
  if ($null -ne $meta.downloaded) { $lines.Add("- downloaded：$($meta.downloaded)") | Out-Null }
  if ($null -ne $meta.skipped) { $lines.Add("- skipped existing：$($meta.skipped)") | Out-Null }
  if ($null -ne $meta.errors) { $lines.Add("- errors：$($meta.errors)") | Out-Null }
  if ($null -ne $meta.bytes) { $lines.Add("- bytes：$($meta.bytes)") | Out-Null }
  $lines.Add("") | Out-Null
  $lines.Add("## Sample") | Out-Null
  if ($sample.Count -eq 0) {
    $lines.Add("暂无。") | Out-Null
  } else {
    $lines.Add("| # | Subject | Title | Image | Local path | Status |") | Out-Null
    $lines.Add("| ---: | --- | --- | --- | --- | --- |") | Out-Null
    $index = 0
    foreach ($row in $sample) {
      $index += 1
      $status = $row.status
      if (-not $status) { $status = "planned" }
      $local = $row.relativePath
      if (-not $local) { $local = $row.outputPath }
      $title = (Clean-Text $row.title) -replace "\|", "\|"
      $lines.Add("| $index | $($row.bangumiSubjectId) | $title | $($row.selectedImageKind) | $local | $status |") | Out-Null
    }
  }
  $lines.Add("") | Out-Null
  $lines.Add("## 安全说明") | Out-Null
  $lines.Add("- 只读取本地 Bangumi / Payload 预览 JSON。") | Out-Null
  $lines.Add("- 只写入 data_local/media/bangumi-covers。") | Out-Null
  $lines.Add("- 不上传 Payload，不创建 media，不修改 works。") | Out-Null
  $lines.Add("- data_local 输出不要提交。") | Out-Null
  $lines | Out-File -LiteralPath $PathValue -Encoding UTF8
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
  covers = $covers
  failedFetches = $failedFetches
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
        $results.Add(($cover | Select-Object *, @{Name="outputPath";Expression={$outputPath}}, @{Name="status";Expression={"skipped-existing"}}, @{Name="bytes";Expression={0}})) | Out-Null
      } else {
        Invoke-WebRequest -Uri $cover.imageUrl -Headers @{ "User-Agent" = $UserAgent; "Accept" = "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8" } -OutFile $outputPath
        $size = (Get-Item -LiteralPath $outputPath).Length
        $bytesTotal += $size
        $results.Add(($cover | Select-Object *, @{Name="outputPath";Expression={$outputPath}}, @{Name="status";Expression={"downloaded"}}, @{Name="bytes";Expression={$size}})) | Out-Null
      }
    } catch {
      $results.Add(($cover | Select-Object *, @{Name="outputPath";Expression={$outputPath}}, @{Name="status";Expression={"error"}}, @{Name="error";Expression={$_.Exception.Message}}, @{Name="bytes";Expression={0}})) | Out-Null
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
    results = $results
  }
}

Write-Report -PathValue $Report -Result $resultObject -TopRows $Top
Write-Host "Wrote Bangumi cover manifest -> $([System.IO.Path]::GetFullPath($Manifest))"
Write-Host "Wrote Bangumi cover report -> $([System.IO.Path]::GetFullPath($Report))"
if ($Download) { Write-Host "Cached Bangumi covers -> $([System.IO.Path]::GetFullPath($Dir))" }
if ($manifestObject.meta.fetchFailedSubjects -gt 0 -or ($Download -and $resultObject.meta.errors -gt 0)) { exit 1 }
