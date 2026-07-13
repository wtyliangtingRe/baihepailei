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
  const originalEvidenceStatus = val(row?.evidenceStatus) || 'unknown'
  const evidenceStatus = honestEvidenceStatus(originalEvidenceStatus, auditBefore.traceableSourceCount)
  const sourceCount = auditBefore.traceableSourceCount
  const statusChanged = evidenceStatus !== originalEvidenceStatus
  const sourceCountChanged = Number(row?.sourceCount || 0) !== sourceCount
  const blockers = unique([
    ...list(row?.blockers),
    ...(evidenceStatus === 'insufficient_evidence' && sourceCount === 0 ? ['external_research_insufficient'] : []),
  ])
  const normalizationReasons = unique([
    ...(statusChanged ? [`evidence_status:${originalEvidenceStatus}->${evidenceStatus}`] : []),
    ...(sourceCountChanged ? [`source_count:${Number(row?.sourceCount || 0)}->${sourceCount}`] : []),
    ...(auditBefore.unlinkedSecondarySources.length ? ['unlinked_context_preserved_but_not_counted'] : []),
  ])
  const baseSummary = withoutExistingHonestNote(row?.sourceSummary)
  const sourceSummary = [baseSummary, honestSourceNote(auditBefore)].filter(Boolean).join('\n')

  const normalized = {
    ...row,
    evidenceStatus,
    sourceCount,
    sourceSummary,
    blockers,
    sourceProvenanceNormalization: {
      version: 'ai-radar-source-provenance-normalization-v0.1',
      changed: statusChanged || sourceCountChanged,
      originalEvidenceStatus,
      normalizedEvidenceStatus: evidenceStatus,
      originalSourceCount: Number(row?.sourceCount || 0),
      traceableSourceCount: sourceCount,
      traceableUrls: auditBefore.traceableUrls,
      unlinkedSecondarySources: auditBefore.unlinkedSecondarySources,
      reasons: normalizationReasons,
    },
  }

  return {
    row: normalized,
    changed: statusChanged || sourceCountChanged,
    statusChanged,
    sourceCountChanged,
    auditBefore,
    auditAfter: auditSourceProvenance(normalized),
  }
}
