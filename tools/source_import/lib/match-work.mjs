import {
  normalizedDisplayTitle,
  normalizedOriginalTitle,
  normalizedTitleSet,
  titleSimilarity,
  titleValues,
} from './title-normalize.mjs'

const VERSION_VARIANT_PATTERN = /(ova|ona|oad|movie|season\s*\d+|s\d+|part\s*\d+|第[一二三四五六七八九十0-9]+季|第[一二三四五六七八九十0-9]+期|剧场版|劇場版|映画|特别篇|特別篇|special|sp|番外|外传|外傳|总集篇|總集篇|recap|remake|reboot|再編集|edition|version)/iu

function clean(value) {
  return String(value ?? '').trim()
}

function cleanLower(value) {
  return clean(value).toLowerCase()
}

function meaningful(value) {
  return value !== null && value !== undefined && clean(value) !== ''
}

export function externalIdEntries(candidate) {
  return Object.entries(candidate?.externalIds || {})
    .filter(([, value]) => meaningful(value))
    .map(([key, value]) => [key, cleanLower(value)])
}

export function matchingExternalIds(a, b) {
  const bEntries = new Map(externalIdEntries(b))

  return externalIdEntries(a)
    .filter(([key, value]) => bEntries.get(key) === value)
    .map(([key, value]) => ({ key, value }))
}

function candidateSourceEntries(candidate) {
  return (candidate?.candidateSources || [])
    .filter(Boolean)
    .map((source) => ({
      source: cleanLower(source?.source || source?.label),
      externalId: cleanLower(source?.externalId),
    }))
}

export function bangumiSubjectId(candidate) {
  const externalIds = candidate?.externalIds || {}
  const directId = externalIds.bangumiSubjectId ?? externalIds.bangumi ?? externalIds.bangumiId
  if (meaningful(directId)) return cleanLower(directId)

  const source = candidateSourceEntries(candidate).find((entry) => entry.source === 'bangumi' && meaningful(entry.externalId))
  return source?.externalId || ''
}

export function hasDistinctBangumiSubjectIds(a, b) {
  const left = bangumiSubjectId(a)
  const right = bangumiSubjectId(b)
  return Boolean(left && right && left !== right)
}

function bothAnimeCandidates(a, b) {
  return a?.mediaType === 'anime' && b?.mediaType === 'anime'
}

export function firstPublishedYear(candidate) {
  const value = candidate?.firstPublishedAt || candidate?.firstPublishedLabel || ''
  const match = String(value).match(/(\d{4})/u)
  return match ? Number(match[1]) : null
}

export function sameMediaType(a, b) {
  const left = a?.mediaType || 'unknown'
  const right = b?.mediaType || 'unknown'

  return left === right || left === 'unknown' || right === 'unknown'
}

export function yearDistance(a, b) {
  const left = firstPublishedYear(a)
  const right = firstPublishedYear(b)

  if (left === null || right === null) return null
  return Math.abs(left - right)
}

export function sharedNormalizedTitles(a, b) {
  const left = normalizedTitleSet(a)
  const right = normalizedTitleSet(b)

  return [...left].filter((title) => right.has(title))
}

function strongestTitleSimilarity(a, b) {
  let best = 0

  for (const left of titleValues(a)) {
    for (const right of titleValues(b)) {
      best = Math.max(best, titleSimilarity(left, right))
    }
  }

  return best
}

export function hasVersionVariantHint(candidate) {
  return titleValues(candidate).some((value) => VERSION_VARIANT_PATTERN.test(value))
}

function exactOriginalTitleNeedsReview(candidate, existing) {
  const distance = yearDistance(candidate, existing)
  const hasVersionHint = hasVersionVariantHint(candidate) || hasVersionVariantHint(existing)

  return hasVersionHint && (distance === null || distance > 0)
}

export function compareWorkCandidates(candidate, existing) {
  const signals = []

  if (meaningful(candidate?.siteId) && cleanLower(candidate.siteId) === cleanLower(existing?.siteId)) {
    signals.push(`same siteId: ${candidate.siteId}`)
    return { action: 'merge', confidence: 'exact_site_id', signals }
  }

  const externalMatches = matchingExternalIds(candidate, existing)
  if (externalMatches.length > 0) {
    signals.push(...externalMatches.map((match) => `same externalId ${match.key}: ${match.value}`))
    return { action: 'merge', confidence: 'exact_external_id', signals }
  }

  const candidateOriginal = normalizedOriginalTitle(candidate)
  const existingOriginal = normalizedOriginalTitle(existing)
  if (candidateOriginal && candidateOriginal === existingOriginal && sameMediaType(candidate, existing)) {
    signals.push(`same normalized originalTitle: ${candidateOriginal}`)
    signals.push(`compatible mediaType: ${candidate.mediaType || 'unknown'} / ${existing.mediaType || 'unknown'}`)

    if (bothAnimeCandidates(candidate, existing) && hasDistinctBangumiSubjectIds(candidate, existing)) {
      signals.push(`different Bangumi subjectIds: ${bangumiSubjectId(candidate)} / ${bangumiSubjectId(existing)}`)
      return { action: 'conflict', confidence: 'same_original_title_distinct_bangumi_subject', signals }
    }

    if (exactOriginalTitleNeedsReview(candidate, existing)) {
      const distance = yearDistance(candidate, existing)
      signals.push(distance === null ? 'first published year unavailable' : `first published year distance: ${distance}`)
      signals.push('version or edition marker detected in title values')
      return { action: 'conflict', confidence: 'same_original_title_version_variant', signals }
    }

    return { action: 'merge', confidence: 'exact_original_title', signals }
  }

  const sharedTitles = sharedNormalizedTitles(candidate, existing)
  const distance = yearDistance(candidate, existing)
  const mediaCompatible = sameMediaType(candidate, existing)

  if (sharedTitles.length > 0 && mediaCompatible && (distance === null || distance <= 1)) {
    signals.push(`same normalized title: ${sharedTitles.join(', ')}`)
    signals.push(distance === null ? 'date year unavailable' : `first published year distance: ${distance}`)
    return { action: 'conflict', confidence: 'possible_same_title_date', signals }
  }

  if (sharedTitles.length > 0 && !mediaCompatible) {
    signals.push(`same normalized title across media types: ${sharedTitles.join(', ')}`)
    signals.push(`mediaType differs: ${candidate.mediaType || 'unknown'} / ${existing.mediaType || 'unknown'}`)
    return { action: 'conflict', confidence: 'same_title_different_media', signals }
  }

  const similarity = strongestTitleSimilarity(candidate, existing)
  if (similarity >= 0.8 && mediaCompatible && (distance === null || distance <= 1)) {
    signals.push(`similar title score: ${similarity.toFixed(2)}`)
    signals.push(`candidate title key: ${normalizedDisplayTitle(candidate)}`)
    signals.push(`existing title key: ${normalizedDisplayTitle(existing)}`)
    signals.push(distance === null ? 'date year unavailable' : `first published year distance: ${distance}`)
    return { action: 'conflict', confidence: 'similar_title_date', signals }
  }

  return { action: 'new', confidence: 'none', signals }
}
