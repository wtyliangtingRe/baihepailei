import { mediaGroupForType } from '../lib/media-groups.mjs'
import { createRawSourceRecord } from '../lib/source-record.mjs'

const BANGUMI_SUBJECT_BASE_URL = 'https://bgm.tv/subject'

const BANGUMI_IMAGE_SIZE_HINTS = new Map([
  ['grid', 100],
  ['small', 200],
  ['common', 400],
  ['medium', 800],
])
const BANGUMI_IMAGE_SIZE_ORDER = ['common', 'large', 'medium', 'small', 'grid']
const EXTERNAL_COVER_COPYRIGHT_NOTE = 'Bangumi external cover URL only. Do not mirror, upload, or publish as Baihepailei cover without copyright/source review.'

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

const CREATOR_CREDIT_INFBOX_RULES = [
  { role: 'original_creator', keys: ['原作'] },
  { role: 'original_concept', keys: ['原案'] },
  { role: 'director', keys: ['監督', '监督', '导演'] },
  { role: 'chief_director', keys: ['総監督', '总监督', '總監督'] },
  { role: 'series_director', keys: ['シリーズディレクター', '系列监督', '系列監督'] },
  { role: 'series_composition', keys: ['シリーズ構成', '系列构成', '系列構成'] },
  { role: 'script', keys: ['脚本'] },
  { role: 'character_original_design', keys: ['キャラクター原案', '角色原案', '人物原案'] },
  { role: 'character_design', keys: ['キャラクターデザイン', '角色设计', '角色設計', '人物设定', '人物設定'] },
  { role: 'producer', keys: ['プロデューサー', '制作人', '製作人'] },
]

const ORGANIZATION_CREDIT_INFBOX_RULES = [
  { role: 'committee', keys: ['製作', '製作委員会', '製作委員會', '制作委员会', '制作委員会'] },
  { role: 'animation_studio', keys: ['アニメーション制作', '动画制作', '動畫制作', '制作'] },
  { role: 'production_company', keys: ['制作公司', '製作会社', '制作会社'] },
  { role: 'publisher', keys: ['出版社'] },
  { role: 'distributor', keys: ['发行', '发行商', '發行', '發行商', '配給', '配给'] },
  { role: 'streaming_platform', keys: ['网络播放', '網絡播放', '网络配信', '配信', '配信平台'] },
  { role: 'broadcaster', keys: ['放送局', '电视台', '電視台', '放送', '播放电视台'] },
  { role: 'music_label', keys: ['音楽制作', '音乐制作', '音樂制作'] },
]

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function normalizeLongText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function normalizeUrl(value) {
  const url = String(value ?? '').trim()
  return /^https?:\/\//iu.test(url) ? url : ''
}

function tagCount(tag) {
  const count = Number(tag?.count ?? tag?.total ?? tag?.votes ?? 0)
  return Number.isFinite(count) && count > 0 ? count : 0
}

function infoboxItemValues(item) {
  if (typeof item?.value === 'string') return [item.value]
  if (Array.isArray(item?.value)) {
    return item.value.map((value) => (typeof value === 'string' ? value : value?.v || value?.name || ''))
  }
  return []
}

function rawInfoboxEntries(subject, keys) {
  const infobox = Array.isArray(subject?.infobox) ? subject.infobox : []
  const keySet = new Set(keys)
  const entries = []

  for (const item of infobox) {
    if (!item || !keySet.has(item.key)) continue

    for (const value of infoboxItemValues(item)) {
      const normalizedValue = normalizeText(value)
      if (!normalizedValue) continue
      entries.push({ key: item.key, value: normalizedValue })
    }
  }

  return entries
}

function splitCreditNames(value) {
  return String(value || '')
    .split(/\s*\/\s*|\s*、\s*|\s*;\s*|\s*；\s*|\s*,\s*|\s*，\s*/gu)
    .map(normalizeText)
    .filter(Boolean)
}

function rawInfoboxValues(subject, keys) {
  return rawInfoboxEntries(subject, keys)
    .flatMap((entry) => splitCreditNames(entry.value))
    .map(normalizeText)
    .filter(Boolean)
}

function getInfoboxValue(subject, keys) {
  return rawInfoboxValues(subject, keys).join(' / ')
}

function uniqueValues(values) {
  const seen = new Set()
  const output = []

  for (const value of values.map(normalizeText).filter(Boolean)) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    output.push(value)
  }

  return output
}

function uniqueRows(rows, keyBuilder) {
  const seen = new Set()
  const output = []

  for (const row of rows.filter(Boolean)) {
    const key = keyBuilder(row)
    if (!key || seen.has(key)) continue

    seen.add(key)
    output.push(row)
  }

  return output
}

function inferTitleLanguage(title, fallback = 'unknown') {
  const value = normalizeText(title)
  if (!value) return fallback
  if (/[ぁ-ゖァ-ヺー]/u.test(value)) return 'ja'
  if (/[가-힣]/u.test(value)) return 'ko'
  if (/^[\p{Script=Latin}\p{Number}\p{Punctuation}\p{Separator}\p{Symbol}]+$/u.test(value)) return 'en'
  if (/[\p{Script=Han}]/u.test(value)) return fallback
  return fallback
}

function addLocalizedTitle(rows, seen, title, { language = 'unknown', region = '', kind = 'alias', isPrimary = false, note = '' } = {}) {
  const normalizedTitle = normalizeText(title)
  if (!normalizedTitle) return

  const key = [normalizedTitle.toLowerCase(), language, region, kind].join('|')
  if (seen.has(key)) return

  seen.add(key)
  rows.push({
    title: normalizedTitle,
    language,
    region,
    kind,
    isPrimary,
    source: 'Bangumi',
    note: note || undefined,
  })
}

export function bangumiSubjectLocalizedTitles(subject) {
  const rows = []
  const seen = new Set()
  const originalTitle = normalizeText(subject?.name || '')
  const chineseTitle = normalizeText(subject?.name_cn || '')

  addLocalizedTitle(rows, seen, originalTitle, {
    language: inferTitleLanguage(originalTitle, 'unknown'),
    region: inferTitleLanguage(originalTitle, 'unknown') === 'ja' ? 'JP' : '',
    kind: 'original',
    isPrimary: !chineseTitle,
  })

  addLocalizedTitle(rows, seen, chineseTitle, {
    language: 'zh-Hans',
    region: 'CN',
    kind: 'localized',
    isPrimary: Boolean(chineseTitle),
  })

  for (const title of rawInfoboxValues(subject, ['中文名', '简体中文名', '中文名称'])) {
    addLocalizedTitle(rows, seen, title, { language: 'zh-Hans', region: 'CN', kind: 'localized' })
  }

  for (const title of rawInfoboxValues(subject, ['日文名', '日文名称', '原名'])) {
    addLocalizedTitle(rows, seen, title, { language: inferTitleLanguage(title, 'ja'), region: 'JP', kind: 'original' })
  }

  for (const title of rawInfoboxValues(subject, ['英文名', '英文名称'])) {
    addLocalizedTitle(rows, seen, title, { language: 'en', kind: 'official' })
  }

  for (const title of rawInfoboxValues(subject, ['别名', '别称', '其它名称', '其他名称'])) {
    addLocalizedTitle(rows, seen, title, {
      language: inferTitleLanguage(title, 'unknown'),
      kind: 'alias',
      note: 'Bangumi infobox alias',
    })
  }

  return rows
}

function bangumiAliasTitles(subject) {
  return uniqueValues([
    subject?.name_cn,
    subject?.name,
    ...rawInfoboxValues(subject, ['中文名', '简体中文名', '中文名称', '日文名', '日文名称', '原名', '英文名', '英文名称', '别名', '别称', '其它名称', '其他名称']),
  ])
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

function creditNote(key) {
  return `Bangumi infobox: ${key}`
}

export function bangumiSubjectSummaryText(subject) {
  return normalizeLongText(subject?.summary || subject?.description || '')
}

export function bangumiSubjectCreatorCreditHints(subject) {
  const rows = []

  for (const rule of CREATOR_CREDIT_INFBOX_RULES) {
    for (const entry of rawInfoboxEntries(subject, rule.keys)) {
      for (const name of splitCreditNames(entry.value)) {
        rows.push({
          name,
          role: rule.role,
          originalRole: entry.key,
          source: 'bangumi',
          note: creditNote(entry.key),
        })
      }
    }
  }

  return uniqueRows(rows, (row) => [row.name.toLowerCase(), row.role, row.originalRole].join('|'))
}

function expandOrganizationEntry(entry, role) {
  const value = normalizeText(entry.value)
  const match = value.match(/^(.+?)[（(](.+)[）)]$/u)

  if (role === 'committee' && match) {
    const committeeName = normalizeText(match[1])
    const members = splitCreditNames(match[2])
    const rows = []

    if (committeeName) {
      rows.push({
        name: committeeName,
        role: 'committee',
        originalRole: entry.key,
        source: 'bangumi',
        note: creditNote(entry.key),
      })
    }

    for (const member of members) {
      rows.push({
        name: member,
        role: 'committee_member',
        originalRole: entry.key,
        source: 'bangumi',
        note: committeeName ? `Bangumi infobox: ${entry.key}; member of ${committeeName}` : creditNote(entry.key),
      })
    }

    return rows
  }

  return splitCreditNames(value).map((name) => ({
    name,
    role,
    originalRole: entry.key,
    source: 'bangumi',
    note: creditNote(entry.key),
  }))
}

export function bangumiSubjectOrganizationCreditHints(subject) {
  const rows = []

  for (const rule of ORGANIZATION_CREDIT_INFBOX_RULES) {
    for (const entry of rawInfoboxEntries(subject, rule.keys)) {
      rows.push(...expandOrganizationEntry(entry, rule.role))
    }
  }

  return uniqueRows(rows, (row) => [row.name.toLowerCase(), row.role, row.originalRole].join('|'))
}

export function bangumiSubjectUrl(subjectId) {
  return `${BANGUMI_SUBJECT_BASE_URL}/${subjectId}`
}

export function bangumiSubjectExternalCoverImages(subject) {
  const images = subject?.images && typeof subject.images === 'object' ? subject.images : {}
  const seen = new Set()
  const rows = []
  const sizes = [
    ...BANGUMI_IMAGE_SIZE_ORDER,
    ...Object.keys(images).filter((key) => !BANGUMI_IMAGE_SIZE_ORDER.includes(key)),
  ]

  for (const size of sizes) {
    const url = normalizeUrl(images[size])
    if (!url || seen.has(url)) continue

    seen.add(url)
    rows.push({
      source: 'bangumi',
      label: `Bangumi cover ${size}`,
      url,
      size,
      widthHint: BANGUMI_IMAGE_SIZE_HINTS.get(size) || undefined,
      usage: 'candidate_reference',
      copyrightNote: EXTERNAL_COVER_COPYRIGHT_NOTE,
    })
  }

  return rows
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
  const aliases = bangumiAliasTitles(subject).filter((alias) => alias !== title)
  const sourceNote = yuriSignal.matchedTags.length > 0
    ? `Bangumi 标签命中：${yuriSignal.matchedTags.map((tag) => `${tag.name}(${tag.count})`).join('、')}`
    : searchSignalTags.length > 0
      ? `Bangumi 标签搜索命中：${searchSignalTags.join('、')}`
      : ''

  return {
    title,
    originalTitle,
    aliases,
    localizedTitles: bangumiSubjectLocalizedTitles(subject),
    mediaGroup: mediaGroupForType(mappedType.mediaType),
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
    externalCoverImages: bangumiSubjectExternalCoverImages(subject),
    summaryText: bangumiSubjectSummaryText(subject),
    creatorCreditHints: bangumiSubjectCreatorCreditHints(subject),
    organizationCreditHints: bangumiSubjectOrganizationCreditHints(subject),
    yuriCandidateScore: Math.max(yuriSignal.candidateScore, searchSignalTags.length > 0 ? 0.05 : 0),
  }
}
