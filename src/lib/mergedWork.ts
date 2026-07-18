export type MergeMarkedWork = {
  reviewStatus?: string | null
  status?: string | null
  searchText?: string | null
  evidenceNote?: string | null
  sourceConflictNotes?: string | null
}

export type MergedWorkReference = {
  id: string
  title?: string
  source: 'explicit' | 'legacy'
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function markerText(doc: MergeMarkedWork) {
  return [doc.searchText, doc.evidenceNote, doc.sourceConflictNotes]
    .map(text)
    .filter(Boolean)
    .join('\n')
}

export function mergedWorkReference(doc: MergeMarkedWork): MergedWorkReference | null {
  const haystack = markerText(doc)
  if (!haystack) return null

  // New merge jobs write dedicated, line-oriented markers. These are authoritative.
  const explicitID = haystack.match(/(?:^|\n)\s*mergedIntoWorkId:\s*(\d+)\s*(?=\n|$)/iu)?.[1]
  const explicitTitle = haystack.match(/(?:^|\n)\s*mergedIntoWorkTitle:\s*([^\r\n]+)\s*(?=\n|$)/iu)?.[1]?.trim()
  if (explicitID) return { id: explicitID, title: explicitTitle || undefined, source: 'explicit' }

  // The old free-text marker is trusted only after the row was actually retired.
  // This prevents a canonical active row from being blocked merely because its notes
  // quote or inherit the phrase "duplicate of work #...".
  const retired = doc.reviewStatus === 'deprecated' || doc.status === 'archived'
  if (!retired) return null

  const legacy = haystack.match(/(?:^|\n)\s*duplicate of work\s+#(\d+)\s*(?:\(([^)]+)\))?\s*(?=\n|$)/iu)
  if (legacy?.[1]) {
    return { id: legacy[1], title: legacy[2]?.trim() || undefined, source: 'legacy' }
  }

  return null
}

export function isMergedDuplicateWork(doc: MergeMarkedWork) {
  return Boolean(mergedWorkReference(doc))
}
