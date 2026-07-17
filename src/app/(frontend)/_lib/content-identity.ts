export type CanonicalContentCollection = 'works' | 'creators' | 'organizations'

const routePrefixes: Record<CanonicalContentCollection, string> = {
  works: 'w',
  creators: 'c',
  organizations: 'o',
}

export function canonicalContentRouteKey(
  collection: CanonicalContentCollection,
  recordId: string | number,
) {
  return `${routePrefixes[collection]}-${String(recordId).trim()}`
}

export function canonicalContentUrl(
  collection: CanonicalContentCollection,
  recordId: string | number,
) {
  return `/${collection}/${encodeURIComponent(canonicalContentRouteKey(collection, recordId))}`
}

export function recordIdFromContentRoute(
  collection: CanonicalContentCollection,
  routeKey: string,
) {
  const prefix = `${routePrefixes[collection]}-`
  if (!routeKey.startsWith(prefix)) return null

  const recordId = routeKey.slice(prefix.length).trim()
  return recordId || null
}

export function isCanonicalContentRoute(
  collection: CanonicalContentCollection,
  routeKey: string,
  recordId?: string | number | null,
) {
  if (recordId === undefined || recordId === null || String(recordId).trim() === '') return false
  return routeKey === canonicalContentRouteKey(collection, recordId)
}
