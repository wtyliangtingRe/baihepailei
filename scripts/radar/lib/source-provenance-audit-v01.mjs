export function val(value) {
  return String(value ?? '').trim()
}

export function list(value) {
  return Array.isArray(value) ? value : []
}

export function unique(values) {
  return [...new Set(list(values).map(val).filter(Boolean))]
}

export function normalizeUrl(value) {
  const url = val(value)
  if (!url) return ''
  return url.replace(/\/+$/u, '')
}

export function auditSourceProvenance(row) {
  const sources = list(row?.researchSources)
  const traceableUrls = unique(sources.map((source) => normalizeUrl(source?.url)))
  const unlinkedSecondarySources = sources
    .filter((source) => val(source?.sourceType) === 'secondary_web' && !normalizeUrl(source?.url))
    .map((source) => ({
      label: val(source?.label),
      sourceType: val(source?.sourceType),
    }))

  const declaredSourceCount = Number.isFinite(Number(row?.sourceCount))
    ? Math.max(0, Number(row.sourceCount))
    : 0
  const traceableSourceCount = traceableUrls.length
  const evidenceStatus = val(row?.evidenceStatus) || 'unknown'
  const blockers = []
  const warnings = []

  if (evidenceStatus === 'multiple_secondary_supported' && traceableSourceCount < 2) {
    blockers.push('multiple_secondary_supported_but_fewer_than_2_traceable_sources')
  }
  if (evidenceStatus === 'single_secondary_supported' && traceableSourceCount < 1) {
    blockers.push('single_secondary_supported_but_no_traceable_source')
  }
  if (declaredSourceCount !== traceableSourceCount) {
    warnings.push('declared_source_count_differs_from_traceable_count')
  }
  if (unlinkedSecondarySources.length) {
    warnings.push('unlinked_secondary_web_source')
  }

  return {
    workId: val(row?.workId),
    siteId: val(row?.siteId),
    title: val(row?.title),
    gradeSuggestion: val(row?.currentGradeSuggestion),
    evidenceStatus,
    declaredSourceCount,
    traceableSourceCount,
    sourceRecordCount: sources.length,
    traceableUrls,
    unlinkedSecondarySources,
    blockers: unique(blockers),
    warnings: unique(warnings),
    auditStatus: blockers.length ? 'blocked' : warnings.length ? 'warning' : 'ok',
  }
}
