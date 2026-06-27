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

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ')
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
  const aliases = [
    subject?.name_cn && subject?.name_cn !== title ? subject.name_cn : null,
    subject?.name && subject?.name !== title ? subject.name : null,
  ].filter(Boolean)

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
        note: '',
      },
    ],
  }
}
