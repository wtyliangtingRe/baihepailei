import {
  normalizedDisplayTitle,
  normalizedOriginalTitle,
  normalizedTitleSet,
  titleSimilarity,
  titleValues,
} from './title-normalize.mjs'

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
