param(
  [string]$Out = "data_local/raw/bangumi/bangumi-yuri-tagged.jsonl",
  [string]$Report = "data_local/reports/bangumi-yuri-tagged-summary.json",
  [string]$Tags = "",
  [string]$Types = "1,2,4",
  [int]$Limit = 10,
  [int]$Pages = 1,
  [string]$Sort = "rank",
  [int]$DelayMs = 1200,
  [int]$MinTopTagCount = 10,
  [double]$MinWeightedScore = 10,
  [bool]$KeepSearchHits = $true,
  [string]$UserAgent = "BaihepaileiSourceImport/0.1 (https://github.com/wtyliangtingRe/baihepailei)",
  [string]$Token = $env:BANGUMI_ACCESS_TOKEN
)

$ErrorActionPreference = "Stop"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Utf8NoBomFile($Path, $Text) {
  [System.IO.File]::WriteAllText($Path, $Text, $Utf8NoBom)
}

function Add-Utf8NoBomLine($Path, $Text) {
  [System.IO.File]::AppendAllText($Path, "$Text`n", $Utf8NoBom)
}

function Join-Chars([int[]]$Codes) {
  return -join ($Codes | ForEach-Object { [char]$_ })
}

$TagBaihe = Join-Chars @(0x767E, 0x5408)
$TagLightSimplified = Join-Chars @(0x8F7B, 0x767E, 0x5408)
$TagLightTraditional = Join-Chars @(0x8F15, 0x767E, 0x5408)
$TagGirlsLoveJa = Join-Chars @(0x30AC, 0x30FC, 0x30EB, 0x30BA, 0x30E9, 0x30D6)
$TagGirlsLoveJaShort = Join-Chars @(0x30AC, 0x30EB, 0x30E9, 0x30D6)

if ($Tags.Trim().Length -eq 0) {
  $TagList = @($TagBaihe, $TagLightSimplified, "GL")
} else {
  $TagList = $Tags -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

$TypeList = $Types -split "," | ForEach-Object { [int]$_.Trim() }

function New-Headers {
  $headers = @{
    "User-Agent" = $UserAgent
    "Accept" = "application/json"
    "Content-Type" = "application/json"
  }

  if ($Token) {
    $headers["Authorization"] = "Bearer $Token"
  }

  return $headers
}

function Get-TagCount($Tag) {
  if ($null -eq $Tag) { return 0 }

  foreach ($key in @("count", "total", "votes")) {
    if ($Tag.PSObject.Properties.Name -contains $key) {
      $value = [double]$Tag.$key
      if ($value -gt 0) { return $value }
    }
  }

  return 0
}

function Get-YuriRule($Name) {
  $normalized = ([string]$Name).Normalize([Text.NormalizationForm]::FormKC).Trim()

  if ($normalized -eq $TagLightSimplified -or $normalized -eq $TagLightTraditional) {
    return @{ label = $TagLightSimplified; weight = 0.75 }
  }

  if ($normalized -eq $TagBaihe) {
    return @{ label = $TagBaihe; weight = 1.0 }
  }

  if ($normalized -match "^(?i:gl)$") {
    return @{ label = "GL"; weight = 1.0 }
  }

  if ($normalized -match "^(?i:yuri)$") {
    return @{ label = "Yuri"; weight = 0.9 }
  }

  if ($normalized -eq $TagGirlsLoveJa -or $normalized -eq $TagGirlsLoveJaShort) {
    return @{ label = $TagGirlsLoveJa; weight = 1.0 }
  }

  return $null
}

function Get-YuriSignal($Subject) {
  $matchedTags = @()

  if ($Subject.tags) {
    foreach ($tag in $Subject.tags) {
      $name = [string]$tag.name
      $rule = Get-YuriRule $name
      if ($null -eq $rule) { continue }

      $count = Get-TagCount $tag
      $matchedTags += [ordered]@{
        name = $name
        count = $count
        matchedAs = $rule.label
        weight = $rule.weight
        weightedCount = $count * $rule.weight
      }
    }
  }

  $matchedTags = @($matchedTags | Sort-Object -Property @{ Expression = "weightedCount"; Descending = $true }, @{ Expression = "count"; Descending = $true })
  $weightedScore = 0.0
  $maxCount = 0.0

  foreach ($tag in $matchedTags) {
    $weightedScore += [double]$tag.weightedCount
    if ([double]$tag.count -gt $maxCount) { $maxCount = [double]$tag.count }
  }

  $candidateScore = [Math]::Min(1.0, $weightedScore / 100.0)

  return [ordered]@{
    matchedTags = $matchedTags
    weightedScore = $weightedScore
    maxCount = $maxCount
    candidateScore = $candidateScore
  }
}

function Invoke-BangumiJson($Uri, $Method, $Body = $null) {
  $headers = New-Headers

  if ($Body) {
    return Invoke-RestMethod -Uri $Uri -Headers $headers -Method $Method -Body ($Body | ConvertTo-Json -Depth 20 -Compress)
  }

  return Invoke-RestMethod -Uri $Uri -Headers $headers -Method $Method
}

function Search-BangumiSubjects($Tag, $Type, $Offset) {
  $uri = "https://api.bgm.tv/v0/search/subjects?limit=$Limit&offset=$Offset"
  $body = @{
    keyword = $Tag
    sort = $Sort
    filter = @{
      tag = @($Tag)
      type = @($Type)
    }
  }

  $result = Invoke-BangumiJson -Uri $uri -Method "POST" -Body $body
  if ($result.data) { return @($result.data) }
  return @()
}

function Get-BangumiSubject($Id) {
  return Invoke-BangumiJson -Uri "https://api.bgm.tv/v0/subjects/$Id" -Method "GET"
}

function Add-SearchHit($SearchHitsById, $Id, $Tag, $Type, $Offset) {
  $idKey = [string]$Id
  if (-not $SearchHitsById.ContainsKey($idKey)) {
    $SearchHitsById[$idKey] = @()
  }

  $SearchHitsById[$idKey] += [ordered]@{
    tag = $Tag
    type = $Type
    offset = $Offset
  }
}

New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
New-Item -ItemType Directory -Force (Split-Path $Report) | Out-Null
Remove-Item $Out -ErrorAction SilentlyContinue
Remove-Item $Report -ErrorAction SilentlyContinue
Write-Utf8NoBomFile -Path $Out -Text ""

$fetchedAt = (Get-Date).ToUniversalTime().ToString("o")
$searched = @()
$searchHitsById = @{}

foreach ($tag in $TagList) {
  foreach ($type in $TypeList) {
    for ($page = 0; $page -lt $Pages; $page++) {
      $offset = $page * $Limit
      Write-Host "Searching tag=$tag type=$type offset=$offset"
      $results = Search-BangumiSubjects -Tag $tag -Type $type -Offset $offset

      foreach ($result in $results) {
        $resultId = $result.id
        if (-not $resultId) { $resultId = $result.subject_id }
        if ($resultId) { Add-SearchHit -SearchHitsById $searchHitsById -Id $resultId -Tag $tag -Type $type -Offset $offset }
      }

      $searched += $results
      Start-Sleep -Milliseconds $DelayMs
    }
  }
}

$seen = @{}
$kept = @()
$rejected = @()

foreach ($subject in $searched) {
  $id = $subject.id
  if (-not $id) { $id = $subject.subject_id }
  if (-not $id) { continue }

  $idKey = [string]$id
  if ($seen.ContainsKey($idKey)) { continue }
  $seen[$idKey] = $true

  Write-Host "Fetching subject $idKey"
  $detail = Get-BangumiSubject -Id $idKey
  $signal = Get-YuriSignal $detail
  $searchSignals = @()
  if ($searchHitsById.ContainsKey($idKey)) { $searchSignals = @($searchHitsById[$idKey]) }

  $passesDetailThreshold = ($signal.weightedScore -ge $MinWeightedScore) -or ($signal.maxCount -ge $MinTopTagCount)
  $passesSearchFallback = $KeepSearchHits -and ($searchSignals.Count -gt 0)

  $detail | Add-Member -NotePropertyName "_baihepailei" -NotePropertyValue @{
    yuriTagSignal = $signal
    searchSignals = $searchSignals
    keptBy = $(if ($passesDetailThreshold) { "detail_tag_count" } elseif ($passesSearchFallback) { "search_tag_hit" } else { "rejected" })
  } -Force

  if ($passesDetailThreshold -or $passesSearchFallback) {
    $rawRecord = [ordered]@{
      source = "bangumi"
      sourceRecordId = $idKey
      sourceUrl = "https://bgm.tv/subject/$idKey"
      fetchedAt = $fetchedAt
      raw = $detail
    }

    Add-Utf8NoBomLine -Path $Out -Text ($rawRecord | ConvertTo-Json -Depth 100 -Compress)
    $kept += $detail
  } else {
    $rejected += $detail
  }

  Start-Sleep -Milliseconds $DelayMs
}

$summary = [ordered]@{
  fetchedAt = $fetchedAt
  tags = $TagList
  types = $TypeList
  limit = $Limit
  pages = $Pages
  sort = $Sort
  minWeightedScore = $MinWeightedScore
  minTopTagCount = $MinTopTagCount
  keepSearchHits = $KeepSearchHits
  searchedCount = $searched.Count
  uniqueSearchedCount = $seen.Count
  keptCount = $kept.Count
  rejectedCount = $rejected.Count
  subjects = @($kept | ForEach-Object {
    [ordered]@{
      id = $_.id
      name = $_.name
      name_cn = $_.name_cn
      type = $_.type
      date = $_.date
      keptBy = $_._baihepailei.keptBy
      yuriTagSignal = $_._baihepailei.yuriTagSignal
      searchSignals = $_._baihepailei.searchSignals
    }
  })
  rejected = @($rejected | ForEach-Object {
    [ordered]@{
      id = $_.id
      name = $_.name
      name_cn = $_.name_cn
      type = $_.type
      date = $_.date
      yuriTagSignal = $_._baihepailei.yuriTagSignal
      searchSignals = $_._baihepailei.searchSignals
    }
  })
}

Write-Utf8NoBomFile -Path $Report -Text ($summary | ConvertTo-Json -Depth 100)

Write-Host "Fetched $($kept.Count) Bangumi yuri-tagged subjects -> $Out"
Write-Host "Wrote summary -> $Report"
