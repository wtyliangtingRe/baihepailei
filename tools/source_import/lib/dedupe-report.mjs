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

function clean(value) {
  return String(value ?? '').trim()
}

function countBy(values) {
  const counts = new Map()

  for (const value of values) {
    const key = clean(value || 'unknown') || 'unknown'
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function escapeMarkdownCell(value) {
  return clean(value)
    .replace(/\\/gu, '\\\\')
    .replace(/\|/gu, '\\|')
}

function markdownCountTable(title, rows) {
  if (!rows || rows.length === 0) return [`## ${title}`, '', '- None', '']

  return [
    `## ${title}`,
    '',
    '| Value | Count |',
    '| --- | ---: |',
    ...rows.map(([label, count]) => `| ${escapeMarkdownCell(label)} | ${count} |`),
    '',
  ]
}

export function reviewPriority(conflict) {
  const confidence = clean(conflict?.confidence)

  if (confidence === 'exact_external_id' || confidence === 'exact_site_id') return 'auto_merge_candidate'
  if (confidence === 'same_original_title_distinct_bangumi_subject') return 'distinct_bangumi_subject_review'
  if (confidence === 'same_original_title_version_variant') return 'version_or_edition_review'
  if (confidence === 'same_title_different_media') return 'cross_media_review'
  if (confidence === 'possible_same_title_date') return 'same_title_date_review'
  if (confidence === 'similar_title_date') return 'similar_title_date_review'
  if (confidence.startsWith('multi_match_')) return 'multi_match_review'

  return 'other_review'
}

function reviewPriorityHint(priority) {
  const hints = {
    auto_merge_candidate: 'Usually safe only when source IDs truly match. Review why this still appears in conflicts.',
    distinct_bangumi_subject_review: 'Keep separate by default. Use workGroup later if these are seasons, OVAs, movies, shorts, or related entries.',
    version_or_edition_review: 'Keep separate by default unless this is confirmed to be the exact same edition.',
    cross_media_review: 'Keep separate by default because media types differ.',
    same_title_date_review: 'Review for true duplicate titles, remakes, specials, and same-year related entries.',
    similar_title_date_review: 'Lower-confidence fuzzy match. Review only after stricter buckets.',
    multi_match_review: 'High-risk ambiguous match. Do not auto-merge without manual decision.',
    other_review: 'Needs manual review.',
  }

  return hints[priority] || hints.other_review
}

function markdownPriorityTable(conflicts) {
  const rows = countBy(conflicts.map(reviewPriority))
  if (rows.length === 0) return ['## Review priority buckets', '', '- None', '']

  return [
    '## Review priority buckets',
    '',
    '| Bucket | Count | Suggested handling |',
    '| --- | ---: | --- |',
    ...rows.map(([priority, count]) => `| ${escapeMarkdownCell(priority)} | ${count} | ${escapeMarkdownCell(reviewPriorityHint(priority))} |`),
    '',
  ]
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
    ...markdownCountTable('Review confidence counts', countBy(conflicts.map((item) => item.confidence))),
    ...markdownPriorityTable(conflicts),
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
      lines.push(`- Review bucket: ${reviewPriority(item)}`)
      lines.push('- Signals:')
      lines.push(...bulletList(item.signals))
      lines.push(`- Candidate: ${candidateLine(item.candidate)}`)
      lines.push(`- Existing: ${candidateLine(item.existing)}`)
      lines.push('')
    })
  }

  return `${lines.join('\n').trim()}\n`
}
