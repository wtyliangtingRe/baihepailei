export const MEDIA_GROUP_OPTIONS = [
  { label: '动画', value: 'anime' },
  { label: '漫画', value: 'manga' },
  { label: '小说', value: 'novel' },
  { label: '游戏', value: 'game' },
  { label: '其他', value: 'other' },
  { label: '未知', value: 'unknown' },
]

const MEDIA_TYPE_TO_GROUP = {
  anime: 'anime',
  manga: 'manga',
  webtoon: 'manga',
  novel: 'novel',
  light_novel: 'novel',
  web_serial: 'novel',
  game: 'game',
  visual_novel: 'game',
  audio_drama: 'other',
  live_action: 'other',
  doujin: 'other',
  anthology: 'other',
  other: 'other',
  unknown: 'unknown',
}

export function mediaGroupForType(mediaType) {
  return MEDIA_TYPE_TO_GROUP[String(mediaType || 'unknown')] || 'unknown'
}

export function mediaGroupLabel(mediaGroup) {
  return MEDIA_GROUP_OPTIONS.find((option) => option.value === mediaGroup)?.label || '未知'
}

export function normalizeMediaGroup(value, mediaType) {
  const normalized = String(value || '').trim()
  if (MEDIA_GROUP_OPTIONS.some((option) => option.value === normalized)) return normalized
  return mediaGroupForType(mediaType)
}
