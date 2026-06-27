import { normalizeText, slugify } from './slug.mjs'

const REVIEW_NOTE = 'Auto-generated candidate series grouping hint. Review before using for public navigation.'

const TRAILING_MARKS = /[\s♪☆!！+、,.，。:：;；~〜-]+$/u
const VARIANT_SUFFIXES = [
  /\s+第[一二三四五六七八九十0-9]+[季期部]$/u,
  /\s+[0-9]+(?:st|nd|rd|th)?\s*(?:season|期|季)$/iu,
  /\s+[0-9]+\s*[☆★]?\s*high$/iu,
  /\s+(?:ova|oad|ona|oav|sp|special|movie)$/iu,
  /\s+(?:剧场版|劇場版|特别篇|特別篇|番外篇|外传|外傳)$/u,
  /\s+(?:夏日时光|暑假时光|夏日時光|なちゅやちゅみ)$/iu,
]

const PREFIX_VARIANT_PATTERNS = [/^迷你(.+)$/u, /^みに(.+)$/u, /^mini\s+(.+)$/iu]

function stripTrailingMarks(value) {
  return normalizeText(value).replace(TRAILING_MARKS, '').trim()
}

export function inferWorkGroupBaseTitle(value) {
  let current = stripTrailingMarks(value)
  if (!current) return ''

  let changed = true
  while (changed) {
    changed = false
    for (const pattern of VARIANT_SUFFIXES) {
      const next = stripTrailingMarks(current.replace(pattern, ''))
      if (next && next !== current) {
        current = next
        changed = true
      }
    }
  }

  return current
}

function inferPrefixedAliasBaseTitle(value) {
  const normalized = stripTrailingMarks(value)
  if (!normalized) return ''

  for (const pattern of PREFIX_VARIANT_PATTERNS) {
    const match = normalized.match(pattern)
    const base = stripTrailingMarks(match?.[1] || '')
    if (base.length >= 4) return inferWorkGroupBaseTitle(base)
  }

  return ''
}

function aliasValue(alias) {
  if (typeof alias === 'string') return alias
  return alias?.value || alias?.title || ''
}

function candidateTitleValues(candidate) {
  return [
    candidate?.title,
    candidate?.name_cn,
    candidate?.originalTitle,
    candidate?.name,
    ...(Array.isArray(candidate?.aliases) ? candidate.aliases.map(aliasValue) : []),
  ]
    .map(normalizeText)
    .filter(Boolean)
}

export function normalizeWorkGroup(value) {
  if (!value || typeof value !== 'object') return undefined

  const title = normalizeText(value.title)
  const key = slugify(value.key || title, { fallback: '' })
  if (!key && !title) return undefined

  return {
    key: key || slugify(title, { fallback: 'work-group' }),
    title: title || key,
    relation: normalizeText(value.relation || 'series_member'),
    orderLabel: normalizeText(value.orderLabel || ''),
    source: normalizeText(value.source || 'heuristic'),
    confidence: normalizeText(value.confidence || 'candidate_hint'),
    note: normalizeText(value.note || REVIEW_NOTE),
  }
}

export function inferCandidateWorkGroup(candidate) {
  const values = candidateTitleValues(candidate)
  const title = normalizeText(candidate?.title || candidate?.name_cn || values[0] || '')
  const aliasBaseTitle = values
    .map(inferPrefixedAliasBaseTitle)
    .find((value) => value && value !== title)
  const baseTitle = aliasBaseTitle || inferWorkGroupBaseTitle(title || values[0])
  if (!baseTitle) return undefined

  const changed = baseTitle !== title

  return normalizeWorkGroup({
    key: slugify(baseTitle, { fallback: 'work-group' }),
    title: baseTitle,
    relation: 'series_member',
    source: aliasBaseTitle ? 'alias_heuristic' : 'title_heuristic',
    confidence: changed ? 'title_variant' : 'title_base',
    note: REVIEW_NOTE,
  })
}
