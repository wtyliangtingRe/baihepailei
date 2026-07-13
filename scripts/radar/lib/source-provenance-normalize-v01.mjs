import { auditSourceProvenance, list, unique, val } from './source-provenance-audit-v01.mjs'

const HONEST_NOTE_PREFIX = '来源可追溯性说明：'

function withoutExistingHonestNote(value) {
  return val(value)
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(HONEST_NOTE_PREFIX))
    .join('\n')
}

function honestSourceNote(audit) {
  if (audit.traceableSourceCount === 0) {
    return `${HONEST_NOTE_PREFIX}当前没有可追溯公开链接；无链接的系列上下文仅作为内部辅助说明，不计入来源数量。`
  }
  return `${HONEST_NOTE_PREFIX}当前保留 ${audit.traceableSourceCount} 个可追溯公开链接；无链接的系列上下文仅作为内部辅助说明，不计入来源数量。`
}

export function honestEvidenceStatus(evidenceStatus, traceableSourceCount) {
  const current = val(evidenceStatus) || 'unknown'
  if (current === 'multiple_secondary_supported' && traceableSourceCount === 1) {
    return 'single_secondary_supported'
  }
  if (['multiple_secondary_supported', 'single_secondary_supported'].includes(current) && traceableSourceCount === 0) {
    return 'insufficient_evidence'
  }
  return current
}

export function normalizeSourceProvenance(row) {
  const auditBefore = auditSourceProvenance(row)
  const existing = row?.sourceProvenanceNormalization || null
  const currentEvidenceStatus = val(row?.evidenceStatus) || 'unknown'
  const currentSourceCount = Number(row?.sourceCount || 0)
  const originalEvidenceStatus = val(existing?.originalEvidenceStatus) || currentEvidenceStatus
  const originalSourceCount = Number.isFinite(Number(existing?.originalSourceCount))
    ? Number(existing.originalSourceCount)
    : currentSourceCount
  const evidenceStatus = honestEvidenceStatus(currentEvidenceStatus, auditBefore.traceableSourceCount)
  const sourceCount = auditBefore.traceableSourceCount
  const statusChanged = evidenceStatus !== currentEvidenceStatus
  const sourceCountChanged = currentSourceCount !== sourceCount
  const blockers = unique([
    ...list(row?.blockers),
    ...(evidenceStatus === 'insufficient_evidence' && sourceCount === 0 ? ['external_research_insufficient'] : []),
  ])
  const blockersChanged = JSON.stringify(blockers) !== JSON.stringify(list(row?.blockers))
  const normalizationReasons = unique([
    ...(originalEvidenceStatus !== evidenceStatus ? [`evidence_status:${originalEvidenceStatus}->${evidenceStatus}`] : []),
    ...(originalSourceCount !== sourceCount ? [`source_count:${originalSourceCount}->${sourceCount}`] : []),
    ...(auditBefore.unlinkedSecondarySources.length ? ['unlinked_context_preserved_but_not_counted'] : []),
  ])
  const shouldAnnotate = Boolean(existing) || normalizationReasons.length > 0
  const baseSummary = withoutExistingHonestNote(row?.sourceSummary)
  const sourceSummary = shouldAnnotate
    ? [baseSummary, honestSourceNote(auditBefore)].filter(Boolean).join('\n')
    : row?.sourceSummary
  const summaryChanged = sourceSummary !== row?.sourceSummary
  const metadata = shouldAnnotate
    ? {
        version: 'ai-radar-source-provenance-normalization-v0.1',
        changed: true,
        originalEvidenceStatus,
        normalizedEvidenceStatus: evidenceStatus,
        originalSourceCount,
        traceableSourceCount: sourceCount,
        traceableUrls: auditBefore.traceableUrls,
        unlinkedSecondarySources: auditBefore.unlinkedSecondarySources,
        reasons: normalizationReasons,
      }
    : undefined
  const metadataChanged = shouldAnnotate && JSON.stringify(metadata) !== JSON.stringify(existing)
  const changed = statusChanged || sourceCountChanged || blockersChanged || summaryChanged || metadataChanged

  const normalized = {
    ...row,
    evidenceStatus,
    sourceCount,
    sourceSummary,
    blockers,
    ...(metadata ? { sourceProvenanceNormalization: metadata } : {}),
  }

  return {
    row: normalized,
    changed,
    statusChanged,
    sourceCountChanged,
    auditBefore,
    auditAfter: auditSourceProvenance(normalized),
  }
}
