export type ReviewableContentDoc = {
  reviewStatus?: string
  searchText?: string
  evidenceNote?: string
  sourceConflictNotes?: string
}

export type MergedWorkReference = {
  id: string
  title?: string
}

const transientReviewParams = [
  'reviewError',
  'reviewed',
  'saved',
  'reviewId',
  'targetId',
  'targetTitle',
  'editorError',
  'sourceId',
]

function text(value: unknown) {
  return String(value ?? '').trim()
}

export function mergedWorkReference(doc: ReviewableContentDoc): MergedWorkReference | null {
  const haystack = [doc.searchText, doc.evidenceNote, doc.sourceConflictNotes]
    .map(text)
    .filter(Boolean)
    .join('\n')

  const explicitID = haystack.match(/mergedIntoWorkId:\s*(\d+)/iu)?.[1]
  const explicitTitle = haystack.match(/mergedIntoWorkTitle:\s*([^\r\n]+)/iu)?.[1]?.trim()
  if (explicitID) return { id: explicitID, title: explicitTitle || undefined }

  const legacy = haystack.match(/duplicate of work\s+#(\d+)\s*(?:\(([^)]+)\))?/iu)
  if (legacy?.[1]) return { id: legacy[1], title: legacy[2]?.trim() || undefined }

  return null
}

export function isMergedDuplicateWork(doc: ReviewableContentDoc) {
  return Boolean(mergedWorkReference(doc))
}

export function normalizePublicationStatus(value: unknown) {
  const status = text(value)
  if (status === 'published' || status === 'archived') return status
  return 'draft'
}

export function safeReviewReturnTo(value: FormDataEntryValue | string | null | undefined) {
  const requested = String(value || '')
  const isContentQueue = requested === '/me/review/content' || requested.startsWith('/me/review/content?')
  const isFeedbackQueue = requested === '/me/review/feedback' || requested.startsWith('/me/review/feedback?')
  const isFeedbackDetail = /^\/me\/review\/feedback\/\d+(?:\?.*)?$/u.test(requested)
  const isStudio = requested === '/me/studio' || requested.startsWith('/me/studio?')
  return isContentQueue || isFeedbackQueue || isFeedbackDetail || isStudio ? requested : '/me/studio'
}

export function reviewActionHref(
  returnTo: string,
  key: 'reviewError' | 'reviewed' | 'saved',
  value: string,
  extras: Record<string, string | number | undefined> = {},
) {
  const [pathname, rawQuery = ''] = returnTo.split('?', 2)
  const params = new URLSearchParams(rawQuery)
  for (const name of transientReviewParams) params.delete(name)
  params.set(key, value)
  for (const [name, item] of Object.entries(extras)) {
    if (item !== undefined && item !== '') params.set(name, String(item))
  }
  return `${pathname}?${params.toString()}`
}

export function textLines(value: unknown) {
  return String(value ?? '')
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function aliasesFromText(value: unknown) {
  return [...new Set(textLines(value))].map((item) => ({ value: item }))
}

export function sourceLinksFromText(value: unknown) {
  const seen = new Set<string>()
  const output: Array<{ label?: string; url: string }> = []

  for (const line of textLines(value)) {
    const separator = line.indexOf('|')
    const label = separator >= 0 ? line.slice(0, separator).trim() : ''
    const url = (separator >= 0 ? line.slice(separator + 1) : line).trim()
    if (!/^https?:\/\//iu.test(url)) continue
    const key = url.replace(/\/+$/u, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(label ? { label, url } : { url })
  }

  return output
}

export function aliasesToText(value: unknown) {
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => typeof item === 'string' ? item : text(item?.value))
    .map(text)
    .filter(Boolean)
    .join('\n')
}

export function sourceLinksToText(value: unknown) {
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => {
      const label = text(item?.label)
      const url = text(item?.url)
      if (!url) return ''
      return label ? `${label} | ${url}` : url
    })
    .filter(Boolean)
    .join('\n')
}
