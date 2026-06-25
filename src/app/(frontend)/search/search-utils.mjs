export const collectionLabels = {
  works: '作品',
  creators: '创作者',
  terms: '名词解释',
  rules: '规则',
}

export function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

export function splitQuery(query) {
  return normalizeText(query)
    .split(/\s+/g)
    .map((part) => part.trim())
    .filter(Boolean)
}

function normalizedValues(values) {
  if (!Array.isArray(values)) return []
  return values.map(normalizeText).filter(Boolean)
}

function addExactOrPartialScore(values, term, exactScore, partialScore) {
  let score = 0

  if (values.some((value) => value === term)) score += exactScore
  if (values.some((value) => value.includes(term))) score += partialScore

  return score
}

export function scoreItem(item, query) {
  const terms = splitQuery(query)
  if (terms.length === 0) return 0

  const title = normalizeText(item.title)
  const originalTitle = normalizeText(item.originalTitle)
  const slug = normalizeText(item.slug)
  const legacy = normalizeText(item.legacyXWikiPage)
  const category = normalizeText(item.category)
  const typeLabel = normalizeText(item.typeLabel)
  const searchText = normalizeText(item.searchText)

  const aliases = normalizedValues(item.aliases)
  const creators = normalizedValues(item.creators)
  const tags = normalizedValues(item.tags)
  const warnings = normalizedValues(item.warnings)
  const relatedTerms = normalizedValues(item.relatedTerms)
  const relatedWarnings = normalizedValues(item.relatedWarnings)

  let score = 0

  for (const term of terms) {
    if (title === term) score += 160
    if (title.includes(term)) score += 80

    if (originalTitle === term) score += 120
    if (originalTitle.includes(term)) score += 60

    score += addExactOrPartialScore(aliases, term, 110, 55)
    score += addExactOrPartialScore(creators, term, 80, 40)
    score += addExactOrPartialScore(tags, term, 60, 30)
    score += addExactOrPartialScore(warnings, term, 60, 30)
    score += addExactOrPartialScore(relatedTerms, term, 55, 28)
    score += addExactOrPartialScore(relatedWarnings, term, 55, 28)

    if (category.includes(term)) score += 24
    if (typeLabel.includes(term)) score += 20
    if (slug.includes(term)) score += 18
    if (legacy.includes(term)) score += 12
    if (searchText.includes(term)) score += 10
  }

  const compactQuery = terms.join('')
  const compactTitle = title.replaceAll(' ', '')
  if (compactQuery && compactTitle.includes(compactQuery)) score += 40

  return score
}

export function filterAndRankItems(items, options = {}) {
  const query = options.query || ''
  const activeCollection = options.activeCollection || 'all'
  const limit = options.limit || 50

  const visibleItems = activeCollection === 'all'
    ? items
    : items.filter((item) => item.collection === activeCollection)

  if (!query.trim()) {
    return visibleItems.slice(0, Math.min(limit, 30)).map((item) => ({ ...item, score: 0 }))
  }

  return visibleItems
    .map((item) => ({ ...item, score: scoreItem(item, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-CN'))
    .slice(0, limit)
}

export function resultMeta(item) {
  const parts = [collectionLabels[item.collection] || item.typeLabel || item.collection]
  if (item.rank && item.rank !== 'unknown') parts.push(`${item.rank}级`)
  if (item.category) parts.push(item.category)
  return parts.filter(Boolean).join(' · ')
}

export function resultSummary(item) {
  const parts = [
    item.originalTitle,
    ...(item.aliases || []),
    ...(item.creators || []),
    ...(item.tags || []),
    ...(item.warnings || []),
    ...(item.relatedTerms || []),
    ...(item.relatedWarnings || []),
    item.legacyXWikiPage,
  ].filter(Boolean)

  return parts.slice(0, 8).join(' / ')
}
