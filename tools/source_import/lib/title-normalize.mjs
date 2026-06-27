const BRACKETED_VERSION_PATTERN = /[\[\(（【［「『].*?(第[一二三四五六七八九十0-9]+季|season\s*\d+|ova|ona|movie|剧场版|劇場版|特别篇|特別篇|special|edition|version).*?[\]\)）】］」』]/giu
const SYMBOL_PATTERN = /[\s\u3000!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。！？、；：“”‘’《》〈〉【】（）［］「」『』・…·]/gu

export function normalizeTitleForMatch(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(BRACKETED_VERSION_PATTERN, '')
    .replace(SYMBOL_PATTERN, '')
    .trim()
}

export function aliasValue(alias) {
  if (typeof alias === 'string') return alias
  if (alias && typeof alias === 'object') return alias.value || alias.title || alias.name || ''
  return ''
}

export function titleValues(candidate) {
  return [
    candidate?.title,
    candidate?.originalTitle,
    ...(Array.isArray(candidate?.aliases) ? candidate.aliases.map(aliasValue) : []),
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
}

export function normalizedTitleSet(candidate) {
  return new Set(titleValues(candidate).map(normalizeTitleForMatch).filter(Boolean))
}

export function normalizedOriginalTitle(candidate) {
  return normalizeTitleForMatch(candidate?.originalTitle || '')
}

export function normalizedDisplayTitle(candidate) {
  return normalizeTitleForMatch(candidate?.title || candidate?.originalTitle || '')
}

export function titleSimilarity(a, b) {
  const left = normalizeTitleForMatch(a)
  const right = normalizeTitleForMatch(b)

  if (!left || !right) return 0
  if (left === right) return 1

  const shorter = left.length <= right.length ? left : right
  const longer = left.length > right.length ? left : right

  if (longer.includes(shorter) && shorter.length >= 4) {
    return shorter.length / longer.length
  }

  const leftChars = new Set([...left])
  const rightChars = new Set([...right])
  const intersection = [...leftChars].filter((char) => rightChars.has(char)).length
  const union = new Set([...leftChars, ...rightChars]).size

  return union === 0 ? 0 : intersection / union
}
