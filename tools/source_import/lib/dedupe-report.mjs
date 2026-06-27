function displayTitle(candidate) {
  return candidate?.title || candidate?.originalTitle || candidate?.siteId || '(untitled)'
}

function sourceSummary(candidate) {
  return (candidate?.candidateSources || [])
    .map((source) => [source.label || source.source, source.externalId].filter(Boolean).join(':'))
    .filter(Boolean)
    .join(', ')
}

function candidateLine(candidate) {
  const parts = [
    `title=${displayTitle(candidate)}`,
    candidate?.originalTitle ? `originalTitle=${candidate.originalTitle}` : null,
    candidate?.mediaType ? `mediaType=${candidate.mediaType}` : null,
    candidate?.firstPublishedLabel ? `date=${candidate.firstPublishedLabel}` : null,
    sourceSummary(candidate) ? `sources=${sourceSummary(candidate)}` : null,
  ].filter(Boolean)

  return parts.join(' | ')
}

function bulletList(items) {
  if (!items || items.length === 0) return ['  - none']
  return items.map((item) => `  - ${item}`)
}

export function createDedupeReport({ inputCount, deduped, conflicts, merges }) {
  const lines = [
    '# Dedupe report',
    '',
    '## Summary',
    '',
    `- Input candidates: ${inputCount}`,
    `- Deduped records: ${deduped.length}`,
    `- Auto merges: ${merges.length}`,
    `- Review items: ${conflicts.length}`,
    '',
    '## Auto merges',
    '',
  ]

  if (merges.length === 0) {
    lines.push('- None')
  } else {
    merges.forEach((merge, index) => {
      lines.push(`### ${index + 1}. ${displayTitle(merge.candidate)} -> ${displayTitle(merge.existing)}`)
      lines.push('')
      lines.push(`- Confidence: ${merge.confidence}`)
      lines.push('- Signals:')
      lines.push(...bulletList(merge.signals))
      lines.push(`- Candidate: ${candidateLine(merge.candidate)}`)
      lines.push(`- Existing: ${candidateLine(merge.existing)}`)
      lines.push('')
    })
  }

  lines.push('', '## Review items', '')

  if (conflicts.length === 0) {
    lines.push('- None')
  } else {
    conflicts.forEach((item, index) => {
      lines.push(`### ${index + 1}. ${displayTitle(item.candidate)} / ${displayTitle(item.existing)}`)
      lines.push('')
      lines.push(`- Type: ${item.type}`)
      lines.push(`- Confidence: ${item.confidence}`)
      lines.push('- Signals:')
      lines.push(...bulletList(item.signals))
      lines.push(`- Candidate: ${candidateLine(item.candidate)}`)
      lines.push(`- Existing: ${candidateLine(item.existing)}`)
      lines.push('')
    })
  }

  return `${lines.join('\n').trim()}\n`
}
