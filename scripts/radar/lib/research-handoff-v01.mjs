import fs from 'node:fs'

import {
  EVIDENCE_STATUSES,
  assertUnderDataLocal,
  jsonlText,
  list,
  normalizeCoverage,
  readJsonl,
  sha256File,
  sha256Text,
  unique,
  val,
} from './assessment-handoff-v01.mjs'

export const RESEARCH_HANDOFF_VERSION = 'ai-radar-research-handoff-v0.1'
export const DEFAULT_RESEARCH_CHUNK_SIZE = 5
export const MIN_RESEARCH_CHUNK_SIZE = 1
export const MAX_RESEARCH_CHUNK_SIZE = 20

export const IDENTITY_STATUSES = new Set([
  'confirmed',
  'ambiguous',
  'not_found',
  'conflicting',
])

export const RESEARCH_STATUSES = new Set([
  'ready_for_ai_assessment',
  'needs_more_research',
  'identity_review',
])

const RELATIONSHIP_FINDINGS = new Set(['confirmed', 'likely', 'unclear', 'absent'])
const MALE_INVOLVEMENT_FINDINGS = new Set(['none_found', 'minor', 'significant', 'romantic', 'sexual', 'unknown'])
const NTR_FINDINGS = new Set(['none_found', 'possible', 'confirmed', 'unknown'])
const ENDING_FINDINGS = new Set(['positive', 'mixed', 'negative', 'ongoing', 'unknown'])
const ADULT_FINDINGS = new Set(['none_found', 'present', 'explicit', 'unknown'])
const SOURCE_TYPES = new Set(['official', 'primary', 'secondary', 'community'])

export function parseResearchChunkSize(value) {
  const size = Number(value ?? DEFAULT_RESEARCH_CHUNK_SIZE)
  if (!Number.isInteger(size) || size < MIN_RESEARCH_CHUNK_SIZE || size > MAX_RESEARCH_CHUNK_SIZE) {
    throw new Error(`Research chunk size must be an integer from ${MIN_RESEARCH_CHUNK_SIZE} to ${MAX_RESEARCH_CHUNK_SIZE}`)
  }
  return size
}

export function chunkResearchRows(rows, chunkSize) {
  const size = parseResearchChunkSize(chunkSize)
  const chunks = []
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size))
  return chunks
}

export function selectResearchBatch(manifest, batchId) {
  const id = val(batchId)
  if (!id) throw new Error('--batch-id is required')
  const entry = list(manifest?.batches).find((item) => val(item?.batchId) === id)
  if (!entry) throw new Error(`Batch not found in catalog manifest: ${id}`)
  if (val(entry?.queue) !== 'external_research') {
    throw new Error(`Batch ${id} belongs to ${val(entry?.queue) || 'unknown'}, not external_research`)
  }
  return entry
}

export function validateResearchBatchSource(entry) {
  const blockers = []
  const file = val(entry?.file)
  const expectedSha = val(entry?.sha256)
  const expectedRows = Number(entry?.rowCount)
  if (!file) blockers.push('batch_file_missing_from_manifest')
  else {
    try { assertUnderDataLocal(file) } catch { blockers.push('batch_file_outside_data_local') }
    if (!fs.existsSync(file)) blockers.push('batch_file_not_found')
  }
  if (!expectedSha) blockers.push('batch_sha256_missing_from_manifest')
  if (!Number.isInteger(expectedRows) || expectedRows < 1) blockers.push('batch_row_count_invalid')
  if (blockers.length) return { blockers, rows: [], actualSha256: null }

  const actualSha256 = sha256File(file)
  if (actualSha256 !== expectedSha) blockers.push('batch_sha256_mismatch')
  const rows = readJsonl(file)
  if (rows.length !== expectedRows) blockers.push('batch_row_count_mismatch')

  const identities = new Set()
  for (const row of rows) {
    const workId = val(row?.workId)
    const siteId = val(row?.siteId)
    if (!workId) blockers.push('batch_row_missing_work_id')
    if (!siteId) blockers.push('batch_row_missing_site_id')
    const key = `${workId}|${siteId}`
    if (identities.has(key)) blockers.push(`duplicate_batch_identity:${key}`)
    identities.add(key)
    if (val(row?.catalogQueue?.queue) !== 'external_research') blockers.push(`batch_row_wrong_queue:${workId}`)
  }

  return { blockers: unique(blockers), rows, actualSha256 }
}

function normalizeSources(value, workId, blockers) {
  if (!Array.isArray(value)) {
    blockers.push(`research_sources_missing:${workId}`)
    return []
  }
  const sources = []
  const seen = new Set()
  for (const source of value) {
    const label = val(source?.label)
    const url = val(source?.url)
    const sourceType = val(source?.sourceType)
    if (!label) blockers.push(`research_source_label_missing:${workId}`)
    if (!/^https?:\/\//iu.test(url)) blockers.push(`research_source_url_invalid:${workId}`)
    if (!SOURCE_TYPES.has(sourceType)) blockers.push(`research_source_type_invalid:${workId}`)
    if (url && seen.has(url)) blockers.push(`research_source_duplicate_url:${workId}`)
    if (url) seen.add(url)
    sources.push({
      label,
      url,
      sourceType,
      supports: unique(source?.supports),
    })
  }
  return sources
}

function normalizeRiskFindings(value, workId, blockers) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const output = {
    femaleFemaleRelationship: val(input.femaleFemaleRelationship) || 'unclear',
    maleInvolvement: val(input.maleInvolvement) || 'unknown',
    ntrRisk: val(input.ntrRisk) || 'unknown',
    endingStatus: val(input.endingStatus) || 'unknown',
    adultContent: val(input.adultContent) || 'unknown',
    settingProfiles: unique(input.settingProfiles),
  }
  if (!RELATIONSHIP_FINDINGS.has(output.femaleFemaleRelationship)) blockers.push(`research_relationship_finding_invalid:${workId}`)
  if (!MALE_INVOLVEMENT_FINDINGS.has(output.maleInvolvement)) blockers.push(`research_male_involvement_invalid:${workId}`)
  if (!NTR_FINDINGS.has(output.ntrRisk)) blockers.push(`research_ntr_finding_invalid:${workId}`)
  if (!ENDING_FINDINGS.has(output.endingStatus)) blockers.push(`research_ending_finding_invalid:${workId}`)
  if (!ADULT_FINDINGS.has(output.adultContent)) blockers.push(`research_adult_finding_invalid:${workId}`)
  return output
}

export function validateAndMergeResearchResponses(inputRows, responseRows, batchId) {
  const blockers = []
  const warnings = []
  const expected = new Map(inputRows.map((row) => [val(row?.workId), row]))
  const received = new Map()

  for (const response of responseRows) {
    const workId = val(response?.workId)
    if (!workId) {
      blockers.push('research_response_missing_work_id')
      continue
    }
    if (!expected.has(workId)) {
      blockers.push(`research_response_unknown_work_id:${workId}`)
      continue
    }
    if (received.has(workId)) {
      blockers.push(`research_response_duplicate_work_id:${workId}`)
      continue
    }
    received.set(workId, response)
  }

  const mergedRows = []
  for (const [workId, input] of expected) {
    const response = received.get(workId)
    if (!response) {
      blockers.push(`research_response_missing_for_work:${workId}`)
      continue
    }

    const expectedSiteId = val(input?.siteId)
    if (val(response?.siteId) !== expectedSiteId) blockers.push(`research_response_site_id_mismatch:${workId}`)
    if (val(response?.title) && val(response?.title) !== val(input?.title)) warnings.push(`research_response_title_differs:${workId}`)

    const identityStatus = val(response?.identityStatus)
    const researchStatus = val(response?.researchStatus)
    const evidenceCoverage = normalizeCoverage(response?.evidenceCoverage)
    const evidenceStatus = val(response?.evidenceStatus)
    const sourceSummary = val(response?.sourceSummary)
    const contentSummary = val(response?.contentSummary)
    const relationshipSummary = val(response?.relationshipSummary)
    const endingSummary = val(response?.endingSummary)
    const sources = normalizeSources(response?.sources, workId, blockers)
    const riskFindings = normalizeRiskFindings(response?.riskFindings, workId, blockers)

    if (!IDENTITY_STATUSES.has(identityStatus)) blockers.push(`research_identity_status_invalid:${workId}`)
    if (!RESEARCH_STATUSES.has(researchStatus)) blockers.push(`research_status_invalid:${workId}`)
    if (evidenceCoverage == null) blockers.push(`research_evidence_coverage_invalid:${workId}`)
    if (!EVIDENCE_STATUSES.has(evidenceStatus)) blockers.push(`research_evidence_status_invalid:${workId}`)
    if (!sourceSummary) blockers.push(`research_source_summary_missing:${workId}`)
    if (!contentSummary) blockers.push(`research_content_summary_missing:${workId}`)
    if (!relationshipSummary) blockers.push(`research_relationship_summary_missing:${workId}`)

    if (researchStatus === 'ready_for_ai_assessment') {
      if (identityStatus !== 'confirmed') blockers.push(`research_ready_identity_not_confirmed:${workId}`)
      if (['insufficient_evidence', 'unknown', 'conflicting_evidence'].includes(evidenceStatus)) {
        blockers.push(`research_ready_evidence_status_too_weak:${workId}`)
      }
      if ((evidenceCoverage ?? 0) < 0.35) blockers.push(`research_ready_coverage_too_low:${workId}`)
      if (sources.length < 1) blockers.push(`research_ready_sources_missing:${workId}`)
    }
    if (researchStatus === 'identity_review' && identityStatus === 'confirmed') {
      warnings.push(`research_identity_review_despite_confirmed_identity:${workId}`)
    }

    mergedRows.push({
      researchBatch: val(batchId),
      workId,
      siteId: expectedSiteId,
      title: val(input?.title),
      identityStatus: identityStatus || 'ambiguous',
      researchStatus: researchStatus || 'needs_more_research',
      evidenceCoverage: evidenceCoverage ?? 0,
      evidenceStatus: evidenceStatus || 'unknown',
      sourceSummary,
      contentSummary,
      relationshipSummary,
      endingSummary,
      riskFindings,
      sources,
      contradictions: unique(response?.contradictions),
      unresolvedQuestions: unique(response?.unresolvedQuestions),
      researchNotes: unique(response?.researchNotes),
      existingState: input?.existingState || {},
      writeProtection: input?.writeProtection || { protected: false, reasons: [] },
      inputAudit: input?.inputAudit || {},
      catalogQueue: input?.catalogQueue || {},
    })
  }

  return {
    blockers: unique(blockers),
    warnings: unique(warnings),
    mergedRows,
    expectedRows: inputRows.length,
    receivedRows: received.size,
  }
}

export function buildAssessmentReadyRows(inputRows, mergedRows, researchBatchId) {
  const inputById = new Map(inputRows.map((row) => [val(row?.workId), row]))
  return mergedRows
    .filter((row) => row.researchStatus === 'ready_for_ai_assessment')
    .map((research) => {
      const input = inputById.get(research.workId) || {}
      const researchSignals = [
        research.contentSummary && { type: 'external_research_summary', text: research.contentSummary },
        research.relationshipSummary && { type: 'external_research_relationship', text: research.relationshipSummary },
        research.endingSummary && { type: 'external_research_ending', text: research.endingSummary },
      ].filter(Boolean)
      return {
        ...input,
        summaryText: val(input?.summaryText) || research.contentSummary,
        contentEvidenceSignals: [...list(input?.contentEvidenceSignals), ...researchSignals],
        externalResearch: {
          version: RESEARCH_HANDOFF_VERSION,
          researchBatch: val(researchBatchId),
          identityStatus: research.identityStatus,
          evidenceCoverage: research.evidenceCoverage,
          evidenceStatus: research.evidenceStatus,
          sourceSummary: research.sourceSummary,
          riskFindings: research.riskFindings,
          sources: research.sources,
          contradictions: research.contradictions,
          unresolvedQuestions: research.unresolvedQuestions,
        },
        inputAudit: {
          ...(input?.inputAudit || {}),
          assessmentReadiness: 'ready_for_ai_assessment_with_warnings',
          researchResolution: 'external_research_completed',
        },
        catalogQueue: {
          version: RESEARCH_HANDOFF_VERSION,
          queue: 'ready_for_ai_assessment',
          reasons: ['external_research_completed'],
          actionable: true,
        },
      }
    })
}

export function researchAssessmentBatchId(researchBatchId) {
  const suffix = val(researchBatchId).match(/(\d+)$/u)?.[1] || '0001'
  return `RADAR-ASSESS-RESEARCH-${suffix}`
}

export function buildAssessmentManifest(readyRows, assessmentBatchId, outputFile, sourceInputSha256) {
  const text = jsonlText(readyRows)
  return {
    text,
    manifest: {
      generatedAt: new Date().toISOString(),
      version: RESEARCH_HANDOFF_VERSION,
      inputSha256: val(sourceInputSha256),
      batches: readyRows.length ? [{
        batchId: val(assessmentBatchId),
        queue: 'ready_for_ai_assessment',
        index: 1,
        rowCount: readyRows.length,
        seriesCount: new Set(readyRows.map((row) => val(row?.series?.seriesKey) || `work:${val(row?.workId)}`)).size,
        firstWorkId: val(readyRows[0]?.workId),
        lastWorkId: val(readyRows.at(-1)?.workId),
        file: outputFile,
        sha256: sha256Text(text),
      }] : [],
    },
  }
}
