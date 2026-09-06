import type { PublicCredit, PublicLocalizedTitle, PublicWorkSource } from './publicRelease'

export const descriptiveKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()

// An absent field can never erase a populated field. Nonempty corrections may replace it.
function populated<T extends object>(previous: T, incoming: T): T {
  const result = { ...previous }
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) continue
    if (Array.isArray(value) && !value.length) continue
    Object.assign(result, { [key]: value })
  }
  return result
}

export function mergeLocalizedTitles(rows: PublicLocalizedTitle[]): PublicLocalizedTitle[] {
  const result = new Map<string, PublicLocalizedTitle>()
  for (const row of rows) {
    const key = descriptiveKey(row.title)
    if (!key) continue
    result.set(key, populated(result.get(key) || row, row))
  }
  return [...result.values()]
}

export function mergeCredits(rows: PublicCredit[]): PublicCredit[] {
  const result = new Map<string, PublicCredit>()
  for (const row of rows) {
    if (!row.name.trim()) continue
    const key = JSON.stringify([descriptiveKey(row.name), descriptiveKey(row.role), row.creatorId || ''])
    const previous = result.get(key)
    const sourceUrls = [...new Set([
      ...(previous?.sourceUrls || []), previous?.sourceUrl,
      ...(row.sourceUrls || []), row.sourceUrl,
    ].filter((value): value is string => Boolean(value?.trim())))]
    const originalNames = [...new Set([...(previous?.originalNames || []), ...(row.originalNames || [])])]
    result.set(key, { ...populated(previous || row, row), ...(sourceUrls.length ? { sourceUrls } : {}),
      ...(originalNames.length ? { originalNames } : {}) })
  }
  return [...result.values()]
}

export function mergeSources(rows: PublicWorkSource[]): PublicWorkSource[] {
  const result = new Map<string, PublicWorkSource>()
  for (const row of rows) {
    if (!row.url.trim()) continue
    result.set(row.url, populated(result.get(row.url) || row, row))
  }
  return [...result.values()]
}
