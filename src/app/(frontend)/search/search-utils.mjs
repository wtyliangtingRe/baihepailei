export const collectionLabels = {
  works: '作品',
  creators: '创作者',
  organizations: '机构',
  evidence: '证据材料',
  terms: '名词解释',
  rules: '规则',
}

const mediaGroupLabels = {
  anime: '动画', manga: '漫画', novel: '小说', game: '游戏', other: '其他', unknown: '未知类型',
}

const mediaTypeLabels = {
  anime: '动画', manga: '漫画', novel: '小说', light_novel: '轻小说', visual_novel: '视觉小说',
  game: '游戏', audio_drama: '广播剧 / 音声', live_action: '真人影视', webtoon: 'Webtoon',
  doujin: '同人作品', anthology: '合集 / 选集', other: '其他', unknown: '未知类型',
}

const workFormatLabels = {
  tv_anime: 'TV 动画', anime_movie: '动画电影', ova: 'OVA', ona: '网络动画', manga_series: '漫画连载',
  manga_oneshot: '漫画短篇', novel_series: '小说系列', light_novel_series: '轻小说系列', web_serial: 'Web 连载',
  visual_novel: '视觉小说', pc_game: 'PC 游戏', console_game: '主机游戏', mobile_game: '手机游戏',
  audio_drama: '广播剧 / 音声', live_action: '真人影视', webtoon_series: 'Webtoon 连载', doujin: '同人作品',
  anthology: '合集 / 选集', other: '其他', unknown: '未知形态',
}

const normalizedItemCache = new WeakMap()

export function getCollectionLabel(collection) {
  return collectionLabels[collection] || collection
}

export function displayRank(rank) {
  if (!rank || rank === 'unknown') return ''
  if (rank === 'AA') return 'S级'
  return `${rank}级`
}

export function mediaGroupLabel(value) {
  if (!value) return ''
  return mediaGroupLabels[value] || value
}

export function mediaTypeLabel(value) {
  if (!value) return ''
  return mediaTypeLabels[value] || value
}

export function workFormatLabel(value) {
  if (!value) return ''
  return workFormatLabels[value] || value
}

export function workTypeLabel(item) {
  const format = workFormatLabel(item?.format)
  if (format && format !== '未知形态') return format
  const type = mediaTypeLabel(item?.mediaType)
  if (type && type !== '未知类型') return type
  return mediaGroupLabel(item?.mediaGroup)
}

export function normalizeText(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase()
}

export function splitQuery(query) {
  return normalizeText(query).split(/\s+/gu).map((part) => part.trim()).filter(Boolean)
}

function normalizedValues(values) {
  if (!Array.isArray(values)) return []
  return values.map(normalizeText).filter(Boolean)
}

function normalizedItem(item) {
  const cached = normalizedItemCache.get(item)
  if (cached) return cached

  const normalized = {
    title: normalizeText(item.title),
    originalTitle: normalizeText(item.originalTitle),
    slug: normalizeText(item.slug),
    category: normalizeText(item.category),
    organizationType: normalizeText(item.organizationType),
    evidenceType: normalizeText(item.evidenceType),
    mediaGroup: normalizeText(item.mediaGroup),
    mediaGroupDisplay: normalizeText(mediaGroupLabel(item.mediaGroup)),
    mediaType: normalizeText(item.mediaType),
    mediaTypeDisplay: normalizeText(mediaTypeLabel(item.mediaType)),
    format: normalizeText(item.format),
    formatDisplay: normalizeText(workFormatLabel(item.format)),
    firstPublishedLabel: normalizeText(item.firstPublishedLabel),
    typeLabel: normalizeText(item.typeLabel),
    searchText: normalizeText(item.searchText),
    aliases: normalizedValues(item.aliases),
    localizedTitles: normalizedValues(item.localizedTitles),
    localizedNames: normalizedValues(item.localizedNames),
    creators: normalizedValues(item.creators),
    organizations: normalizedValues(item.organizations),
    relatedWorks: normalizedValues(item.relatedWorks),
    relatedCreators: normalizedValues(item.relatedCreators),
    relatedOrganizations: normalizedValues(item.relatedOrganizations),
    tags: normalizedValues(item.tags),
    warnings: normalizedValues(item.warnings),
    relatedTerms: normalizedValues(item.relatedTerms),
    relatedWarnings: normalizedValues(item.relatedWarnings),
  }
  normalizedItemCache.set(item, normalized)
  return normalized
}

function addExactOrPartialScore(values, term, exactScore, partialScore) {
  let score = 0
  if (values.some((value) => value === term)) score += exactScore
  if (values.some((value) => value.includes(term))) score += partialScore
  return score
}

function scoreTerm(index, term) {
  let score = 0
  if (index.title === term) score += 160
  if (index.title.includes(term)) score += 80
  if (index.originalTitle === term) score += 120
  if (index.originalTitle.includes(term)) score += 60

  score += addExactOrPartialScore(index.aliases, term, 110, 55)
  score += addExactOrPartialScore(index.localizedTitles, term, 115, 58)
  score += addExactOrPartialScore(index.localizedNames, term, 105, 52)
  score += addExactOrPartialScore(index.creators, term, 80, 40)
  score += addExactOrPartialScore(index.organizations, term, 70, 35)
  score += addExactOrPartialScore(index.relatedWorks, term, 70, 35)
  score += addExactOrPartialScore(index.relatedCreators, term, 70, 35)
  score += addExactOrPartialScore(index.relatedOrganizations, term, 70, 35)
  score += addExactOrPartialScore(index.tags, term, 60, 30)
  score += addExactOrPartialScore(index.warnings, term, 60, 30)
  score += addExactOrPartialScore(index.relatedTerms, term, 55, 28)
  score += addExactOrPartialScore(index.relatedWarnings, term, 55, 28)

  for (const value of [index.category, index.organizationType, index.evidenceType, index.mediaGroup, index.mediaGroupDisplay]) {
    if (value.includes(term)) score += 24
  }
  for (const value of [index.mediaType, index.mediaTypeDisplay, index.format, index.formatDisplay, index.typeLabel]) {
    if (value.includes(term)) score += 20
  }
  if (index.firstPublishedLabel.includes(term)) score += 16
  if (index.slug.includes(term)) score += 18
  if (index.searchText.includes(term)) score += 10
  return score
}

export function scoreItem(item, query) {
  const terms = splitQuery(query)
  if (terms.length === 0) return 0
  const index = normalizedItem(item)
  const termScores = terms.map((term) => scoreTerm(index, term))
  if (termScores.some((score) => score === 0)) return 0

  let score = termScores.reduce((sum, value) => sum + value, 0)
  const compactQuery = terms.join('')
  const compactTitle = index.title.replaceAll(' ', '')
  if (compactQuery && compactTitle.includes(compactQuery)) score += 40
  return score
}

export function filterAndRankItems(items, options = {}) {
  const query = options.query || ''
  const activeCollection = options.activeCollection || 'all'
  const limit = options.limit || 50
  const visibleItems = activeCollection === 'all' ? items : items.filter((item) => item.collection === activeCollection)

  if (!query.trim()) return visibleItems.slice(0, Math.min(limit, 30)).map((item) => ({ ...item, score: 0 }))

  return visibleItems
    .map((item) => ({ ...item, score: scoreItem(item, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-CN'))
    .slice(0, limit)
}

export function resultMeta(item) {
  const parts = [getCollectionLabel(item.collection) || item.typeLabel || item.collection]
  const rank = displayRank(item.rank)
  if (rank) parts.push(rank)
  if (item.collection === 'works') {
    const group = mediaGroupLabel(item.mediaGroup)
    if (group) parts.push(group)
  }
  if (item.organizationType) parts.push(item.organizationType)
  if (item.evidenceType) parts.push(item.evidenceType)
  if (item.category) parts.push(item.category)
  return parts.filter(Boolean).join(' · ')
}

export function resultSummary(item) {
  const parts = [
    item.originalTitle,
    ...(item.localizedTitles || []),
    ...(item.localizedNames || []),
    ...(item.aliases || []),
    item.collection === 'works' ? workTypeLabel(item) : '',
    item.firstPublishedLabel,
    ...(item.creators || []),
    ...(item.organizations || []),
    ...(item.relatedWorks || []),
    ...(item.relatedCreators || []),
    ...(item.relatedOrganizations || []),
    ...(item.tags || []),
    ...(item.warnings || []),
    ...(item.relatedTerms || []),
    ...(item.relatedWarnings || []),
  ].filter(Boolean)

  return [...new Set(parts)].slice(0, 8).join(' / ')
}
