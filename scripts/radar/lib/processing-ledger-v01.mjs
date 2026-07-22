import crypto from 'node:crypto'

export const PROCESSING_LEDGER_VERSION = 'ai-radar-processing-ledger-v0.2'

function val(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortObject(value[key])]),
  )
}

export function stableJson(value) {
  return JSON.stringify(sortObject(value))
}

export function sha256Json(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex')
}

export function identityKey(row) {
  const workId = val(row?.workId || row?.id)
  const siteId = val(row?.siteId)
  if (!workId || !siteId) throw new Error('Ledger identity requires workId and siteId')
  return `${workId}|${siteId}`
}

export function catalogFingerprint(row) {
  return sha256Json({
    workId: val(row?.workId || row?.id),
    siteId: val(row?.siteId),
    title: val(row?.title),
    aliases: list(row?.aliases),
    externalIds: row?.externalIds || {},
    summaryText: val(row?.summaryText),
    contentEvidenceSignals: list(row?.contentEvidenceSignals),
    existingState: row?.existingState || {},
    writeProtection: row?.writeProtection || {},
    series: row?.series || {},
  })
}

export function normalizeLedgerEntry(entry) {
  return {
    ledgerVersion: PROCESSING_LEDGER_VERSION,
    workId: val(entry?.workId),
    siteId: val(entry?.siteId),
    title: val(entry?.title),
    catalogFingerprint: val(entry?.catalogFingerprint),
    sourceBatchIds: [...new Set(list(entry?.sourceBatchIds).map(val).filter(Boolean))],
    researchStatus: val(entry?.researchStatus) || 'not_started',
    researchVersion: val(entry?.researchVersion) || null,
    researchResultSha256: val(entry?.researchResultSha256) || null,
    policyVersion: val(entry?.policyVersion) || null,
    calibrationProfileId: val(entry?.calibrationProfileId) || null,
    assessmentResultSha256: val(entry?.assessmentResultSha256) || null,
    aiQaStatus: val(entry?.aiQaStatus) || 'not_started',
    completedAt: val(entry?.completedAt) || null,
    nextAction: val(entry?.nextAction) || null,
    supersedes: list(entry?.supersedes).map(val).filter(Boolean),
    reusableEvidence: entry?.reusableEvidence
      && typeof entry.reusableEvidence === 'object'
      && !Array.isArray(entry.reusableEvidence)
      ? entry.reusableEvidence
      : null,
  }
}

export function decideIncrementalAction(row, ledgerEntry, context = {}) {
  const protectedRow = row?.writeProtection?.protected === true
    || list(row?.writeProtection?.reasons).length > 0
    || row?.existingState?.locked === true
    || row?.existingState?.isLocked === true
  if (protectedRow) return { action: 'skip_protected', needsResearch: false, needsAssessment: false }

  if (!ledgerEntry) return { action: 'research_new', needsResearch: true, needsAssessment: false }

  const entry = normalizeLedgerEntry(ledgerEntry)
  const currentFingerprint = catalogFingerprint(row)
  if (entry.catalogFingerprint && entry.catalogFingerprint !== currentFingerprint) {
    return { action: 'research_refresh_catalog_changed', needsResearch: true, needsAssessment: false, refreshReason: 'catalog_changed' }
  }

  if (['needs_more_research', 'identity_review'].includes(entry.researchStatus)) {
    return { action: `research_retry_${entry.researchStatus}`, needsResearch: true, needsAssessment: false, refreshReason: entry.researchStatus }
  }

  if (entry.aiQaStatus === 'ai_qa_deferred') {
    return { action: 'research_retry_ai_qa_deferred', needsResearch: true, needsAssessment: false, refreshReason: 'ai_qa_deferred' }
  }

  const policyVersion = val(context?.policyVersion)
  if (policyVersion && entry.policyVersion && entry.policyVersion !== policyVersion) {
    return { action: 'reassess_policy_changed', needsResearch: false, needsAssessment: true, refreshReason: 'policy_changed' }
  }

  const calibrationProfileId = val(context?.calibrationProfileId)
  if (calibrationProfileId && entry.calibrationProfileId && entry.calibrationProfileId !== calibrationProfileId) {
    return { action: 'reassess_calibration_changed', needsResearch: false, needsAssessment: true, refreshReason: 'calibration_changed' }
  }

  if (entry.aiQaStatus === 'ai_qa_passed') {
    return { action: 'skip_completed_unchanged', needsResearch: false, needsAssessment: false }
  }

  if (entry.aiQaStatus === 'legacy_assessed') {
    return {
      action: 'reassess_legacy_assessment',
      needsResearch: false,
      needsAssessment: true,
      refreshReason: 'legacy_assessment_reuse',
    }
  }

  if (entry.researchStatus === 'ready_for_ai_assessment') {
    return { action: 'assess_existing_research', needsResearch: false, needsAssessment: true }
  }

  return { action: 'research_retry_incomplete', needsResearch: true, needsAssessment: false, refreshReason: 'incomplete' }
}

export function summarizeActions(classifiedRows) {
  const counts = {}
  for (const item of classifiedRows) counts[item.action] = (counts[item.action] || 0) + 1
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}
