import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const ASSESSMENT_HANDOFF_VERSION = 'ai-radar-assessment-handoff-v0.1'
export const DEFAULT_CHUNK_SIZE = 25
export const MIN_CHUNK_SIZE = 5
export const MAX_CHUNK_SIZE = 100

export const EVIDENCE_STATUSES = new Set([
  'official_confirmed',
  'primary_material_confirmed',
  'multiple_secondary_supported',
  'single_secondary_supported',
  'community_consensus',
  'inferred_from_metadata',
  'conflicting_evidence',
  'insufficient_evidence',
  'unknown',
])

export function val(value) {
  return String(value ?? '').trim()
}

export function list(value) {
  return Array.isArray(value) ? value : []
}

export function unique(values) {
  return [...new Set(list(values).map(val).filter(Boolean))]
}

export function sha256Text(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function jsonlText(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')
}

export function readJsonl(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`Invalid JSONL at ${file}:${index + 1}: ${error.message}`)
    }
  })
}

export function assertUnderDataLocal(target) {
  const root = path.resolve('data_local')
  const resolved = path.resolve(target)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Assessment handoff path must remain under data_local: ${target}`)
  }
  return resolved
}

export function parseChunkSize(value) {
  const size = Number(value ?? DEFAULT_CHUNK_SIZE)
  if (!Number.isInteger(size) || size < MIN_CHUNK_SIZE || size > MAX_CHUNK_SIZE) {
    throw new Error(`Chunk size must be an integer from ${MIN_CHUNK_SIZE} to ${MAX_CHUNK_SIZE}`)
  }
  return size
}

export function chunkRows(rows, chunkSize) {
  const size = parseChunkSize(chunkSize)
  const chunks = []
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size))
  return chunks
}

export function selectAssessmentBatch(manifest, batchId) {
  const id = val(batchId)
  if (!id) throw new Error('--batch-id is required')
  const entries = list(manifest?.batches)
  const entry = entries.find((item) => val(item?.batchId) === id)
  if (!entry) throw new Error(`Batch not found in catalog manifest: ${id}`)
  if (val(entry?.queue) !== 'ready_for_ai_assessment') {
    throw new Error(`Batch ${id} belongs to ${val(entry?.queue) || 'unknown'}, not ready_for_ai_assessment`)
  }
  return entry
}

export function validateBatchSource(entry) {
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
    if (val(row?.catalogQueue?.queue) !== 'ready_for_ai_assessment') {
      blockers.push(`batch_row_wrong_queue:${workId}`)
    }
  }

  return { blockers: unique(blockers), rows, actualSha256 }
}

export function normalizeCoverage(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const normalized = number > 1 ? number / 100 : number
  if (normalized < 0 || normalized > 1) return null
  return Math.round(normalized * 10000) / 10000
}

function validateRuleAssessments(value, workId) {
  const blockers = []
  const rules = list(value)
  if (!Array.isArray(value)) blockers.push(`rule_assessments_missing:${workId}`)
  const seen = new Set()
  for (const rule of rules) {
    const code = val(rule?.code)
    if (!code) blockers.push(`rule_code_missing:${workId}`)
    if (code && seen.has(code)) blockers.push(`duplicate_rule_code:${workId}:${code}`)
    seen.add(code)
    if (typeof rule?.matched !== 'boolean') blockers.push(`rule_matched_not_boolean:${workId}:${code || 'unknown'}`)
    if (!val(rule?.reason)) blockers.push(`rule_reason_missing:${workId}:${code || 'unknown'}`)
    if (rule?.evidenceStatus && !EVIDENCE_STATUSES.has(val(rule.evidenceStatus))) {
      blockers.push(`rule_evidence_status_invalid:${workId}:${code || 'unknown'}`)
    }
  }
  return blockers
}

export function validateAndMergeResponses(inputRows, responseRows, batchId) {
  const blockers = []
  const warnings = []
  const expected = new Map(inputRows.map((row) => [val(row?.workId), row]))
  const received = new Map()

  for (const response of responseRows) {
    const workId = val(response?.workId)
    if (!workId) {
      blockers.push('response_missing_work_id')
      continue
    }
    if (!expected.has(workId)) {
      blockers.push(`response_unknown_work_id:${workId}`)
      continue
    }
    if (received.has(workId)) {
      blockers.push(`response_duplicate_work_id:${workId}`)
      continue
    }
    received.set(workId, response)
  }

  const mergedRows = []
  for (const [workId, input] of expected) {
    const response = received.get(workId)
    if (!response) {
      blockers.push(`response_missing_for_work:${workId}`)
      continue
    }

    const expectedSiteId = val(input?.siteId)
    const responseSiteId = val(response?.siteId)
    if (responseSiteId !== expectedSiteId) blockers.push(`response_site_id_mismatch:${workId}`)
    if (val(response?.title) && val(response?.title) !== val(input?.title)) warnings.push(`response_title_differs:${workId}`)

    const evidenceCoverage = normalizeCoverage(response?.evidenceCoverage)
    if (evidenceCoverage == null) blockers.push(`response_evidence_coverage_invalid:${workId}`)
    const evidenceStatus = val(response?.evidenceStatus)
    if (!EVIDENCE_STATUSES.has(evidenceStatus)) blockers.push(`response_evidence_status_invalid:${workId}`)
    const sourceSummary = val(response?.sourceSummary)
    if (!sourceSummary) blockers.push(`response_source_summary_missing:${workId}`)
    blockers.push(...validateRuleAssessments(response?.ruleAssessments, workId))

    mergedRows.push({
      assessmentBatch: val(batchId),
      workId,
      siteId: expectedSiteId,
      title: val(input?.title),
      evidenceCoverage: evidenceCoverage ?? 0,
      evidenceStatus: evidenceStatus || 'unknown',
      sourceSummary,
      existingState: input?.existingState || {},
      writeProtection: input?.writeProtection || { protected: false, reasons: [] },
      ruleAssessments: list(response?.ruleAssessments),
      contradictions: list(response?.contradictions).map(val).filter(Boolean),
      assessmentNotes: list(response?.assessmentNotes).map(val).filter(Boolean),
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
