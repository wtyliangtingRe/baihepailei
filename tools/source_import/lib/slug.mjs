const DIACRITIC_MARKS = /\p{Mark}+/gu
const NON_SLUG_CHARS = /[^\p{Letter}\p{Number}]+/gu
const EDGE_DASHES = /^-+|-+$/gu

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
}

export function slugify(value, { fallback = 'item' } = {}) {
  const slug = normalizeText(value)
    .normalize('NFKD')
    .replace(DIACRITIC_MARKS, '')
    .toLowerCase()
    .replace(NON_SLUG_CHARS, '-')
    .replace(EDGE_DASHES, '')

  return slug || fallback
}

export function uniqueSlug(baseSlug, seen) {
  const base = slugify(baseSlug)
  let candidate = base
  let index = 2

  while (seen.has(candidate)) {
    candidate = `${base}-${index}`
    index += 1
  }

  seen.add(candidate)
  return candidate
}
