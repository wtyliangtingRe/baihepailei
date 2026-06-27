import { createRawSourceRecord } from '../lib/source-record.mjs'

const BANGUMI_SUBJECT_BASE_URL = 'https://bgm.tv/subject'

const SUBJECT_TYPE_TO_MEDIA_TYPE = new Map([
  [1, 'book'],
  [2, 'anime'],
  [4, 'game'],
  [6, 'live_action'],
])

const DEFAULT_FORMAT_BY_MEDIA_TYPE = new Map([
  ['anime', 'unknown'],
  ['manga', 'manga_series'],
  ['novel', 'novel_series'],
  ['light_novel', 'light_novel_series'],
  ['visual_novel', 'visual_novel'],
  ['game', 'unknown'],
  ['live_action', 'live_action'],
])

const YURI_TAG_RULES = [
  { label: '轻百合', pattern: /^(轻|輕)百合$/u, weight: 0.75, priority: 20 },
  { label: '百合', pattern: /^百合$/u, weight: 1, priority: 10 },
  { label: 'GL', pattern: /^gl$/iu, weight: 1, priority: 10 },
  { label: 'Yuri', pattern: /^yuri$/iu, weight: 0.9, priority: 10 },
  { label: 'ガールズラブ', pattern: /^(ガールズラブ|ガルラブ)$/iu, weight: 1, priority: 10 },
]

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function tagCount(tag) {
  const count = Number(tag?.count ?? tag?.total ?? tag?.votes ?? 0)
  return Number.isFinite(count) && count > 0 ? count : 0
}

function getInfoboxValue(subject, keys) {
  const infobox = Array.isArray(subject?.infobox) ? subject.infobox : []
  const keySet = new Set(keys)

  for (const item of infobox) {
    if (!item || !keySet.has(item.key)) continue

    if (typeof item.value === 'string') return normalizeText(item.value)
    if (Array.isArray(item.value)) {
      return item.value
        .map((value) => (typeof value === 'string' ? value : value?.v || value?.name || ''))
        .map(normalizeText)
        .filter(Boolean)
        .join(' / ')
    }
  }

  return ''
}

function bestYuriRuleForTag(tagName) {
  const normalized = normalizeText(tagName)
  const matches = YURI_TAG_RULES.filter((rule) => rule.pattern.test(normalized))

  if (matches.length === 0) return null

  return matches.toSorted((a, b) => b.priority - a.priority || b.weight - a.weight)[0]
}

function hasTag(subject, patterns) {
  const tags = Array.isArray(subject?.tags) ? subject.tags : []
  return tags.some((tag) => {
    const name = normalizeText(tag?.name).toLowerCase()
    return patterns.some((pattern) => pattern.test(name))
  })
}

function detectBookSubtype(subject) {
  const typeText = getInfoboxValue(subject, ['类型', '类别', '书籍类型']).toLowerCase()

  if (/轻小说|ライトノベル|light novel/u.test(typeText) || hasTag(subject, [/轻小说/u, /light novel/u, /ライトノベル/u])) {
    return { mediaType: 'light_novel', format: 'light_novel_series' }
  }

  if (/小说|novel/u.test(typeText) || hasTag(subject, [/小说/u, /novel/u])) {
    return { mediaType: 'novel', format: 'novel_series' }
  }

  return { mediaType: 'manga', format: 'manga_series' }
}

function detectGameSubtype(subject) {
  const typeText = getInfoboxValue(subject, ['游戏类型', '类型', '类别']).toLowerCase()

  if (/视觉小说|visual novel|ノベル|adv|galgame|gal game/u.test(typeText) || hasTag(subject, [/视觉小说/u, /visual novel/u, /galgame/u])) {
    return { mediaType: 'visual_novel', format: 'visual_novel' }
  }

  return { mediaType: 'game', format: 'unknown' }
}

function uniqueSearchSignalTags(searchSignals) {
  const tags = []
  const seen = new Set()

  for (const signal of Array.isArray(searchSignals) ? searchSignals : []) {
    const tag = normalizeText(signal?.tag || '')
    if (!tag || seen.has(tag)) continue

    seen.add(tag)
    tags.push(tag)
  }

  return tags
}

export function bangumiSubjectUrl(subjectId) {
  return `${BANGUMI_SUBJECT_BASE_URL}/${subjectId}`
}

export function mapBangumiSubjectType(subject) {
  const subjectType = Number(subject?.type)
  const broadType = SUBJECT_TYPE_TO_MEDIA_TYPE.get(subjectType) || 'unknown'

  if (broadType === 'book') return detectBookSubtype(subject)
  if (broadType === 'game') return detectGameSubtype(subject)

  return {
    mediaType: broadType,
    format: DEFAULT_FORMAT_BY_MEDIA_TYPE.get(broadType) || 'unknown',
  }
}

export function scoreBangumiYuriTags(subject) {
  const matchedTags = []

  for (const tag of Array.isArray(subject?.tags) ? subject.tags : []) {
    const name = normalizeText(tag?.name)
    const rule = bestYuriRuleForTag(name)

    if (!rule) continue

    const count = tagCount(tag)
    matchedTags.push({
      name,
      count,
      matchedAs: rule.label,
      weight: rule.weight,
      weightedCount: count * rule.weight,
    })
  }

  matchedTags.sort((a, b) => b.weightedCount - a.weightedCount || b.count - a.count || a.name.localeCompare(b.name))

  const weightedScore = matchedTags.reduce((sum, tag) => sum + tag.weightedCount, 0)
  const maxCount = matchedTags.reduce((max, tag) => Math.max(max, tag.count), 0)

  return {
    matchedTags,
    weightedScore,
    maxCount,
    candidateScore: Math.min(1, weightedScore / 100),
  }
}

export function subjectPassesYuriTagThreshold(subject, { minWeightedScore = 5, minTopTagCount = 5 } = {}) {
  const signal = scoreBangumiYuriTags(subject)
  return signal.weightedScore >= minWeightedScore || signal.maxCount >= minTopTagCount
}

export function annotateBangumiYuriSignal(subject) {
  const signal = scoreBangumiYuriTags(subject)

  return {
    ...subject,
    _baihepailei: {
      ...(subject?._baihepailei || {}),
      yuriTagSignal: signal,
    },
  }
}

export function bangumiSubjectToRawSource(subject, { fetchedAt } = {}) {
  const id = subject?.id ?? subject?.subject_id
  if (!id) throw new Error('Bangumi subject id is required')

  const url = subject?.url || bangumiSubjectUrl(id)

  return createRawSourceRecord({
    source: 'bangumi',
    sourceRecordId: id,
    sourceUrl: url,
    fetchedAt,
    raw: subject,
  })
}

export function bangumiSubjectToCandidateInput(subject) {
  const id = subject?.id ?? subject?.subject_id
  const mappedType = mapBangumiSubjectType(subject)
  const title = normalizeText(subject?.name_cn || subject?.name || '')
  const originalTitle = normalizeText(subject?.name || '')
  const yuriSignal = subject?._baihepailei?.yuriTagSignal || scoreBangumiYuriTags(subject)
  const searchSignalTags = uniqueSearchSignalTags(subject?._baihepailei?.searchSignals)
  const aliases = [
    subject?.name_cn && subject?.name_cn !== title ? subject.name_cn : null,
    subject?.name && subject?.name !== title ? subject.name : null,
  ].filter(Boolean)
  const sourceNote = yuriSignal.matchedTags.length > 0
    ? `Bangumi 标签命中：${yuriSignal.matchedTags.map((tag) => `${tag.name}(${tag.count})`).join('、')}`
    : searchSignalTags.length > 0
      ? `Bangumi 标签搜索命中：${searchSignalTags.join('、')}`
      : ''

  return {
    title,
    originalTitle,
    aliases,
    mediaType: mappedType.mediaType,
    format: mappedType.format,
    firstPublishedLabel: normalizeText(subject?.date || ''),
    externalIds: {
      bangumiSubjectId: id ? String(id) : undefined,
    },
    candidateSources: [
      {
        source: 'bangumi',
        label: 'Bangumi',
        externalId: id ? String(id) : '',
        url: id ? bangumiSubjectUrl(id) : '',
        fetchedAt: null,
        note: sourceNote,
      },
    ],
    yuriCandidateScore: Math.max(yuriSignal.candidateScore, searchSignalTags.length > 0 ? 0.05 : 0),
  }
}
