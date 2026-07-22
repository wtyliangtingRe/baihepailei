import path from 'node:path'

import {
  list,
  normalizeCoverage,
  unique,
  val,
} from './assessment-handoff-v01.mjs'
import { sha256Json } from './processing-ledger-v01.mjs'

export const LEGACY_ASSESSMENT_OVERLAY_VERSION = 'ai-radar-legacy-assessment-overlay-v0.1'

const WEAK_EVIDENCE = new Set([
  '',
  'unknown',
  'insufficient_evidence',
  'conflicting_evidence',
])

export function isLegacyAssessmentFile(file) {
  const name = path.basename(file)
  return /^v0\.[456]-resolutions\.jsonl$/iu.test(name)
    || /^ai-radar-(?:calibrated-)?resolved-v0?1\.jsonl$/iu.test(name)
    || /^radar-assess-\d{4}-chunk-\d{4}\.output\.jsonl$/iu.test(name)
}

function legacyFilePriority(file) {
  const name = path.basename(file)
  if (/^v0\.6-resolutions/u.test(name)) return 500
  if (/^v0\.5-resolutions/u.test(name)) return 450
  if (/resolved/u.test(name)) return 400
  return 300
}

function extractRuleCodes(row) {
  return unique([
    ...list(row?.ruleCodes),
    ...list(row?.v06RuleCodes),
    ...list(row?.v05RuleCodes),
    ...list(row?.matchedRules),
    val(row?.decisiveRule?.code),
    ...list(row?.ruleAssessments)
      .filter((item) => item?.matched !== false)
      .map((item) => val(item?.code)),
  ])
}

function extractSources(row) {
  const sources = [
    ...list(row?.sources),
    ...list(row?.ruleAssessments).flatMap((item) => list(item?.sources)),
  ]
  const seen = new Set()
  return sources
    .map((source) => ({
      label: val(source?.label),
      url: val(source?.url),
      sourceType: val(source?.sourceType),
      supports: unique(source?.supports),
    }))
    .filter((source) => {
      if (!source.url || seen.has(source.url)) return false
      seen.add(source.url)
      return true
    })
}

function identityBlocked(row) {
  const markers = [
    val(row?.reviewStatus),
    val(row?.webResearchOutcome),
    ...list(row?.blockers).map(val),
    ...list(row?.reviewReasons).map(val),
    ...list(row?.contradictions).map(val),
  ].join(' ')
  return /(identity[_ -]?review|identity[_ -]?conflict|duplicate|wrong[_ -]?summary|series[_ -]?identity[_ -]?conflict)/iu.test(markers)
}

export function extractLegacyReusableEvidence(row, sourceFile) {
  const workId = val(row?.workId)
  const siteId = val(row?.siteId)
  if (!workId || !siteId) return { accepted: false, reason: 'identity_missing' }
  if (identityBlocked(row)) return { accepted: false, reason: 'identity_blocked' }

  const evidenceCoverage = normalizeCoverage(
    row?.evidenceCoverage ?? row?.evidenceCoveragePercent,
  )
  if (evidenceCoverage == null || evidenceCoverage < 0.35) {
    return { accepted: false, reason: 'coverage_too_low' }
  }

  const evidenceStatus = val(row?.evidenceStatus)
  if (WEAK_EVIDENCE.has(evidenceStatus)) {
    return { accepted: false, reason: 'evidence_too_weak' }
  }

  const sourceSummary = val(row?.sourceSummary)
  if (!sourceSummary) return { accepted: false, reason: 'source_summary_missing' }

  const grade = val(
    row?.currentGradeSuggestion
      || row?.grade
      || row?.v06Grade
      || row?.v05Grade
      || row?.suggestedGrade,
  )
  const ruleCodes = extractRuleCodes(row)
  if (!grade && !ruleCodes.length) {
    return { accepted: false, reason: 'assessment_signal_missing' }
  }

  const sourceRowSha256 = sha256Json(row)
  const reusableEvidence = {
    version: LEGACY_ASSESSMENT_OVERLAY_VERSION,
    sourceFile,
    sourceRowSha256,
    sourceSummary,
    evidenceCoverage,
    evidenceStatus,
    grade: grade || null,
    ruleCodes,
    sources: extractSources(row),
    contradictions: unique(row?.contradictions),
    assessmentNotes: unique(row?.assessmentNotes),
    needsPublicationGuard: row?.needsPublicationGuard === true,
  }

  return {
    accepted: true,
    score: legacyFilePriority(sourceFile)
      + Math.round(evidenceCoverage * 100)
      + (grade ? 20 : 0)
      + reusableEvidence.sources.length,
    entry: {
      workId,
      siteId,
      title: val(row?.title),
      researchStatus: 'ready_for_ai_assessment',
      researchVersion: 'legacy-assessment-evidence-v0.1',
      researchResultSha256: sourceRowSha256,
      policyVersion: val(row?.policyVersion) || 'legacy-policy-unknown',
      calibrationProfileId: val(
        row?.calibrationProfileId || row?.calibration?.profileId,
      ) || 'legacy-calibration-unknown',
      assessmentResultSha256: sourceRowSha256,
      aiQaStatus: 'legacy_assessed',
      completedAt: val(row?.generatedAt || row?.assessedAt) || null,
      sourceBatchIds: unique([row?.batchId, row?.assessmentBatch]),
      reusableEvidence,
    },
  }
}
