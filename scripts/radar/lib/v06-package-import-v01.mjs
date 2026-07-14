import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { EVIDENCE_STATUSES, GRADE_LABELS, RADAR_RULE_BY_CODE } from './radar-policy-v04.mjs'

export const V06_IMPORT_VERSION = 'ai-radar-v06-package-import-v0.1'
export const V06_POLICY_ID = 'radar-rating-policy-v0.6-generalized-dryrun'

export function val(value) {
  return String(value ?? '').trim()
}

export function list(value) {
  return Array.isArray(value) ? value : []
}

export function unique(values) {
  return [...new Set(list(values).map(val).filter(Boolean))]
}

export function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

export function readJsonl(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) } catch (error) {
      throw new Error(`Invalid JSONL at ${file}:${index + 1}: ${error.message}`)
    }
  })
}

export function jsonlText(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')
}

export function assertUnderDataLocal(target) {
  const root = path.resolve('data_local')
  const resolved = path.resolve(target)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Output path must remain under data_local: ${target}`)
  }
  return resolved
}

export function verifyPackageChecksums(packageDir, checksumRows) {
  const blockers = []
  for (const item of list(checksumRows)) {
    const relative = val(item?.path)
    const expected = val(item?.sha256)
    if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes('..')) {
      blockers.push(`invalid_checksum_path:${relative || 'missing'}`)
      continue
    }
    const file = path.join(packageDir, relative)
    if (!fs.existsSync(file)) {
      blockers.push(`checksum_file_missing:${relative}`)
      continue
    }
    if (Number.isFinite(Number(item?.bytes)) && fs.statSync(file).size !== Number(item.bytes)) {
      blockers.push(`checksum_size_mismatch:${relative}`)
    }
    if (sha256File(file) !== expected) blockers.push(`checksum_sha256_mismatch:${relative}`)
  }
  return unique(blockers)
}

function sourceKey(source) {
  if (typeof source === 'string') return val(source)
  return val(source?.url) || val(source?.label) || val(source?.source) || val(source?.id)
}

function normalizeSource(source, fallbackType = '') {
  if (typeof source === 'string') return { label: val(source), sourceType: fallbackType || undefined }
  if (!source || typeof source !== 'object') return null
  const normalized = {
    label: val(source.label || source.title || source.source || source.id) || undefined,
    url: val(source.url) || undefined,
    sourceType: val(source.sourceType || source.type) || fallbackType || undefined,
  }
  return normalized.label || normalized.url ? normalized : null
}

export function collectTraceableSources(canonicalRow, response) {
  const candidates = []
  for (const rule of list(response?.ruleAssessments)) {
    if (rule?.matched !== true) continue
    for (const source of list(rule?.sources)) candidates.push(normalizeSource(source))
  }
  for (const source of list(canonicalRow?.sourceLinks)) candidates.push(normalizeSource(source, 'catalog_source_link'))
  for (const source of list(canonicalRow?.candidateSources)) {
    if (val(source?.url) || val(source?.note)) candidates.push(normalizeSource(source, 'catalog_candidate_source'))
  }
  for (const source of list(canonicalRow?.evidenceSignals)) {
    if (val(source?.url) || val(source?.source)) candidates.push(normalizeSource(source, 'catalog_evidence_signal'))
  }

  const byKey = new Map()
  for (const source of candidates.filter(Boolean)) {
    const key = sourceKey(source)
    if (key && !byKey.has(key)) byKey.set(key, source)
  }
  return [...byKey.values()]
}

export function provenanceBlockers(evidenceStatus, sourceCount) {
  const status = val(evidenceStatus)
  const blockers = []
  if (status === 'single_secondary_supported' && sourceCount < 1) blockers.push('single_secondary_requires_one_traceable_source')
  if (status === 'multiple_secondary_supported' && sourceCount < 2) blockers.push('multiple_secondary_requires_two_traceable_sources')
  return blockers
}

function normalizeCoverage(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const normalized = number > 1 ? number / 100 : number
  if (normalized < 0 || normalized > 1) return null
  return Math.round(normalized * 10000) / 10000
}

function normalizeRule(rule) {
  const code = val(rule?.code)
  const registry = RADAR_RULE_BY_CODE[code]
  if (!registry) return { invalid: true, code }
  return {
    code,
    grade: registry.grade,
    label: registry.label,
    confidence: Math.min(1, Math.max(0, Number(rule?.confidence) || 0)),
    confidencePercent: Math.min(100, Math.max(0, Math.round((Number(rule?.confidence) || 0) * 100))),
    reason: val(rule?.reason),
    evidenceStatus: val(rule?.evidenceStatus),
    sources: list(rule?.sources),
    supportingEvidence: list(rule?.supportingEvidence).map(val).filter(Boolean),
    contradictingEvidence: list(rule?.contradictingEvidence).map(val).filter(Boolean),
  }
}

export function buildCanonicalV06Assessment({ canonicalRow, response, resolution, guard, packageManifest }) {
  const blockers = []
  const warnings = []
  const workId = val(canonicalRow?.workId)
  const siteId = val(canonicalRow?.siteId)
  const batchId = val(resolution?.batchId)

  if (val(response?.workId) !== workId) blockers.push('response_work_id_mismatch')
  if (val(response?.siteId) !== siteId) blockers.push('response_site_id_mismatch')
  if (val(resolution?.workId) !== workId) blockers.push('resolution_work_id_mismatch')
  if (val(resolution?.siteId) !== siteId) blockers.push('resolution_site_id_mismatch')
  if (val(response?.title) && val(response?.title) !== val(canonicalRow?.title)) warnings.push('response_title_differs_from_canonical')
  if (val(resolution?.title) && val(resolution?.title) !== val(canonicalRow?.title)) warnings.push('resolution_title_differs_from_canonical')

  const coverage = normalizeCoverage(response?.evidenceCoverage)
  if (coverage == null) blockers.push('invalid_evidence_coverage')
  const evidenceStatus = val(response?.evidenceStatus)
  if (!EVIDENCE_STATUSES.includes(evidenceStatus)) blockers.push('invalid_evidence_status')
  if (!val(response?.sourceSummary)) blockers.push('missing_source_summary')

  const normalizedRules = list(response?.ruleAssessments).filter((item) => item?.matched === true).map(normalizeRule)
  const invalidRules = normalizedRules.filter((rule) => rule.invalid)
  if (invalidRules.length) blockers.push(`unknown_rule_codes:${invalidRules.map((rule) => rule.code || 'missing').join(',')}`)
  const matchedRules = normalizedRules.filter((rule) => !rule.invalid)
  const matchedCodes = matchedRules.map((rule) => rule.code).sort()
  const resolutionCodes = unique(resolution?.ruleCodes).sort()
  if (JSON.stringify(matchedCodes) !== JSON.stringify(resolutionCodes)) blockers.push('resolution_rule_codes_do_not_match_response')

  const grade = val(resolution?.grade)
  if (!GRADE_LABELS[grade] || grade === 'X') blockers.push(grade === 'X' ? 'x_grade_requires_human_adjudication' : 'invalid_final_grade')
  for (const rule of matchedRules) if (rule.grade !== grade) blockers.push(`final_grade_rule_grade_mismatch:${rule.code}`)
  if (!matchedRules.length) blockers.push('no_final_matched_rules')

  const decisiveCode = resolutionCodes[0] || ''
  const decisiveRule = matchedRules.find((rule) => rule.code === decisiveCode) || matchedRules[0] || {}
  const traceableSources = collectTraceableSources(canonicalRow, response)
  blockers.push(...provenanceBlockers(evidenceStatus, traceableSources.length))

  if (canonicalRow?.writeProtection?.protected === true) blockers.push('canonical_write_protected')
  for (const reason of list(canonicalRow?.writeProtection?.reasons)) blockers.push(`canonical_write_protection:${val(reason)}`)

  const guardReasons = unique(guard?.guardReasons)
  if (guardReasons.length) warnings.push(...guardReasons.map((reason) => `publication_guard:${reason}`))
  const reviewReasons = unique([
    'radar_v06_package_import',
    ...(guardReasons.length ? ['radar_publication_guard'] : []),
    ...guardReasons.map((reason) => `radar_guard_${reason}`),
  ])

  return {
    assessmentVersion: V06_IMPORT_VERSION,
    policyVersion: val(packageManifest?.summary?.policyVersion || packageManifest?.policyVersion),
    generatedAt: new Date().toISOString(),
    assessedAt: val(packageManifest?.summary?.generatedAt),
    assessmentBatch: batchId,
    workId,
    siteId,
    title: val(canonicalRow?.title),
    currentGradeSuggestion: grade,
    currentGradeLabel: GRADE_LABELS[grade] || '',
    decisiveRule,
    matchedRules,
    allRuleAssessments: list(response?.ruleAssessments),
    overallConfidence: Number(decisiveRule?.confidence || 0),
    confidencePercent: Number(decisiveRule?.confidencePercent || 0),
    evidenceCoverage: coverage ?? 0,
    evidenceCoveragePercent: Math.round((coverage ?? 0) * 100),
    evidenceStatus,
    sourceSummary: val(response?.sourceSummary),
    sourceCount: traceableSources.length,
    traceableSources,
    contradictions: unique(response?.contradictions),
    assessmentNotes: unique(response?.assessmentNotes),
    requiresHumanReview: true,
    needsPublicationGuard: guardReasons.length > 0,
    publicationGuardReasons: guardReasons,
    reviewReasons,
    blockers: unique(blockers),
    warnings: unique(warnings),
    existingState: canonicalRow?.existingState || {},
    writeProtection: canonicalRow?.writeProtection || { protected: false, reasons: [] },
    catalogQueue: canonicalRow?.catalogQueue || {},
    safety: {
      payloadRead: false,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      canonicalIdentityAndProtectionFromCatalogOnly: true,
      autoPublishes: false,
      publicationGuardPreserved: true,
    },
  }
}

export function validatePackageManifest(manifest) {
  const blockers = []
  if (val(manifest?.summary?.policyVersion) !== V06_POLICY_ID) blockers.push('unexpected_v06_policy_id')
  if (Number(manifest?.summary?.rows) !== 10805) blockers.push('unexpected_v06_row_count')
  if (Number(manifest?.summary?.batches) !== 44) blockers.push('unexpected_v06_batch_count')
  if (Number(manifest?.summary?.responseFiles) !== 433) blockers.push('unexpected_v06_response_file_count')
  if (Number(manifest?.summary?.validationFiles) !== 433) blockers.push('unexpected_v06_validation_file_count')
  if (list(manifest?.summary?.validationErrors).length) blockers.push('package_manifest_reports_validation_errors')
  if (manifest?.summary?.safety?.payloadWrite !== 0 || manifest?.summary?.safety?.postgresqlWrite !== 0) blockers.push('package_manifest_write_safety_mismatch')
  return unique(blockers)
}

export function indexUnique(rows, label) {
  const map = new Map()
  const blockers = []
  for (const row of rows) {
    const workId = val(row?.workId)
    if (!workId) blockers.push(`${label}_missing_work_id`)
    else if (map.has(workId)) blockers.push(`${label}_duplicate_work_id:${workId}`)
    else map.set(workId, row)
  }
  return { map, blockers: unique(blockers) }
}
