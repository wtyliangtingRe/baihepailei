export const newWorkMediaGroupOptions = ['anime', 'manga', 'novel', 'game', 'other', 'unknown'] as const
export const newWorkMediaTypeOptions = ['anime', 'manga', 'novel', 'light_novel', 'visual_novel', 'game', 'audio_drama', 'live_action', 'webtoon', 'doujin', 'anthology', 'other', 'unknown'] as const
export const newWorkFormatOptions = ['tv_anime', 'anime_movie', 'ova', 'ona', 'manga_series', 'manga_oneshot', 'novel_series', 'light_novel_series', 'web_serial', 'visual_novel', 'pc_game', 'console_game', 'mobile_game', 'audio_drama', 'live_action', 'webtoon_series', 'doujin', 'anthology', 'other', 'unknown'] as const
export const newWorkDatePrecisionOptions = ['day', 'month', 'year', 'unknown'] as const

export type NewWorkMediaGroup = typeof newWorkMediaGroupOptions[number]
export type NewWorkMediaType = typeof newWorkMediaTypeOptions[number]
export type NewWorkFormat = typeof newWorkFormatOptions[number]
export type NewWorkDatePrecision = typeof newWorkDatePrecisionOptions[number]

export type NewWorkProposalMetadata = {
  originalTitle?: string
  aliases?: string[]
  mediaGroup?: NewWorkMediaGroup
  mediaType?: NewWorkMediaType
  format?: NewWorkFormat
  firstPublishedAt?: string
  firstPublishedPrecision?: NewWorkDatePrecision
  firstPublishedLabel?: string
  summary?: string
  searchText?: string
}

const mediaGroups = new Set<string>(newWorkMediaGroupOptions)
const mediaTypes = new Set<string>(newWorkMediaTypeOptions)
const formats = new Set<string>(newWorkFormatOptions)
const datePrecisions = new Set<string>(newWorkDatePrecisionOptions)

const optionLabels: Record<string, string> = {
  anime: '动画',
  manga: '漫画',
  novel: '小说',
  game: '游戏',
  other: '其他',
  unknown: '不确定',
  light_novel: '轻小说',
  visual_novel: '视觉小说',
  audio_drama: '广播剧 / 音声剧',
  live_action: '真人影视',
  webtoon: '条漫 / Webtoon',
  doujin: '同人作品',
  anthology: '选集 / 合集',
  tv_anime: '电视动画',
  anime_movie: '动画电影',
  ova: 'OVA',
  ona: '网络动画',
  manga_series: '连载漫画',
  manga_oneshot: '短篇 / 单话漫画',
  novel_series: '小说系列',
  light_novel_series: '轻小说系列',
  web_serial: '网络连载',
  pc_game: 'PC 游戏',
  console_game: '主机游戏',
  mobile_game: '手机游戏',
  webtoon_series: '条漫连载',
  day: '精确到日',
  month: '精确到月',
  year: '精确到年',
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || '').trim().slice(0, maxLength)
}

function cleanEnum<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  const normalized = cleanText(value, 80)
  return (allowed.has(normalized) ? normalized : fallback) as T
}

function cleanAliases(value: unknown) {
  const source = Array.isArray(value) ? value : String(value || '').split(/\r?\n/u)
  return [...new Set(source.map((item) => cleanText(item, 300)).filter(Boolean))].slice(0, 50)
}

export function sanitizeNewWorkProposalMetadata(value: unknown): NewWorkProposalMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  const originalTitle = cleanText(input.originalTitle, 300)
  const aliases = cleanAliases(input.aliases)
  const firstPublishedAt = cleanText(input.firstPublishedAt, 40)
  const firstPublishedLabel = cleanText(input.firstPublishedLabel, 120)
  const summary = cleanText(input.summary, 12000)
  const searchText = cleanText(input.searchText, 30000)

  return {
    ...(originalTitle ? { originalTitle } : {}),
    ...(aliases.length ? { aliases } : {}),
    mediaGroup: cleanEnum<NewWorkMediaGroup>(input.mediaGroup, mediaGroups, 'unknown'),
    mediaType: cleanEnum<NewWorkMediaType>(input.mediaType, mediaTypes, 'unknown'),
    format: cleanEnum<NewWorkFormat>(input.format, formats, 'unknown'),
    ...(firstPublishedAt ? { firstPublishedAt } : {}),
    firstPublishedPrecision: cleanEnum<NewWorkDatePrecision>(input.firstPublishedPrecision, datePrecisions, 'unknown'),
    ...(firstPublishedLabel ? { firstPublishedLabel } : {}),
    ...(summary ? { summary } : {}),
    ...(searchText ? { searchText } : {}),
  }
}

export function hasNewWorkProposalMetadata(value: unknown) {
  const metadata = sanitizeNewWorkProposalMetadata(value)
  return Boolean(
    metadata.originalTitle ||
    metadata.aliases?.length ||
    (metadata.mediaGroup && metadata.mediaGroup !== 'unknown') ||
    (metadata.mediaType && metadata.mediaType !== 'unknown') ||
    (metadata.format && metadata.format !== 'unknown') ||
    metadata.firstPublishedAt ||
    (metadata.firstPublishedPrecision && metadata.firstPublishedPrecision !== 'unknown') ||
    metadata.firstPublishedLabel ||
    metadata.summary ||
    metadata.searchText
  )
}

export function newWorkOptionLabel(value: string) {
  return optionLabels[value] || value
}
