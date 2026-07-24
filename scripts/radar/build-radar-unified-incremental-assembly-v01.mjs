#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  PUBLIC_CONCLUSION_STORAGE_VERSION,
  canonical,
  conclusionSha256ForRecord,
  normalizePublicRecordForStorage,
  sha256Canonical,
} from './lib/public-conclusion-storage-v01.mjs'

export const VERSION = 'radar-unified-1804-incremental-assembly-v0.1'
export const EXPECTED_OLD_ASSEMBLY_SHA256 = 'd41fb41951e35e8dc0c2cdde1fb904968af3df5d3564bddb8a13a3fb002c14c2'
export const EXPECTED_PHASE2_SHA256 = 'ae6908ab6e375fbcfa7602ffa39115fba20300d816105e76421dbd9e8d012330'
export const EXPECTED_PRIOR_LAB_EVIDENCE_SHA256 = '621c6d2bda4e064fc9781b56ef178188d39aff9ebe648b3ca5b24f0496705561'
export const EXPECTED_OLD_ROWS = 683
export const EXPECTED_NEW_ROWS = 1121
export const EXPECTED_BLOCKED_ROWS = 1
export const EXPECTED_ROWS = 1804
export const EXPECTED_BASELINE_ROWS = 9000
export const EXPECTED_INCREMENTAL_GRADES = canonical({ A: 104, B: 692, C: 182, D: 779, E: 39, F: 8 })
export const PHASE2_PACKAGE_ID = 'RADAR-REMAINING-1122-PHASE2-LIVE-GUARD-CLOSEOUT-20260725-005950'
export const PUBLICATION_VERSION = 'radar-public-conclusions-unified-closeout-v0.1'
const ALLOWED_GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F'])
const ALLOWED_EVIDENCE_STATUSES = new Set([
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
const FORBIDDEN_FLAGS = new Set(['execute', 'apply', 'write', 'patch', 'publish', 'restore', 'confirm', 'approval-token'])

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function unique(values) { return [...new Set(values.filter(Boolean))] }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')) }
function readJsonl(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
  return text.split(/\r?\n/u).filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line) }
    catch (error) { throw new Error(`Invalid JSONL ${file}:${index + 1}: ${error.message}`) }
  })
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
export function asciiSafeJson(value) {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/gu, (item) => {
    const codePoint = item.codePointAt(0)
    if (codePoint <= 0xffff) return `\\u${codePoint.toString(16).padStart(4, '0')}`
    const offset = codePoint - 0x10000
    const high = 0xd800 + (offset >> 10)
    const low = 0xdc00 + (offset & 0x3ff)
    return `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`
  })
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => asciiSafeJson(row)).join('\n') + (rows.length ? '\n' : ''), 'ascii')
}
function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; index += 1 }
  }
  return args
}
function required(args, key) {
  const value = val(args[key])
  if (!value) throw new Error(`Required: --${key}`)
  return path.resolve(value)
}
function countBy(rows, getter) {
  const counts = {}
  for (const row of rows) {
    const key = val(getter(row)) || 'missing'
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])))
}
export function assertManifest(directory) {
  const manifestPath = path.join(directory, 'manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`)
  const manifest = readJson(manifestPath)
  const expected = new Set()
  for (const entry of manifest) {
    const relative = val(entry.file).replaceAll('\\', '/')
    const file = path.join(directory, ...relative.split('/'))
    if (!fs.existsSync(file)) throw new Error(`Manifest file missing: ${relative}`)
    if (fs.statSync(file).size !== Number(entry.bytes)) throw new Error(`Manifest bytes mismatch: ${relative}`)
    if (sha256File(file) !== val(entry.sha256).toLowerCase()) throw new Error(`Manifest SHA-256 mismatch: ${relative}`)
    expected.add(relative)
  }
  const actual = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else {
        const relative = path.relative(directory, file).replaceAll('\\', '/')
        if (relative !== 'manifest.json') actual.push(relative)
      }
    }
  }
  walk(directory)
  if (actual.length !== expected.size || actual.some((item) => !expected.has(item))) {
    throw new Error(`Manifest coverage mismatch: ${directory}`)
  }
  return manifest
}

function numeric(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
export function evidenceStrengthFor(snapshot) {
  const sourceCount = numeric(snapshot?.sourceCount)
  const confidence = numeric(snapshot?.confidencePercent)
  const coverage = numeric(snapshot?.evidenceCoveragePercent)
  if (sourceCount <= 1) return 'weak'
  if (confidence >= 80 && coverage >= 70) return 'strong'
  return 'medium'
}
export function ratingNoticeFor(snapshot) {
  const sourceCount = numeric(snapshot?.sourceCount)
  const confidence = numeric(snapshot?.confidencePercent)
  const coverage = numeric(snapshot?.evidenceCoveragePercent)
  return sourceCount <= 1 || confidence < 60 || coverage < 50
    ? 'insufficient_information'
    : 'ai_synthesized_pending_review'
}
export function reviewReasonsFor(snapshot) {
  const sourceCount = numeric(snapshot?.sourceCount)
  const confidence = numeric(snapshot?.confidencePercent)
  const coverage = numeric(snapshot?.evidenceCoveragePercent)
  const evidenceStatus = val(snapshot?.evidenceStatus).toLowerCase()
  const reasons = ['radar_v06_package_import']
  if (sourceCount <= 1 || coverage < 60) reasons.push('radar_guard_low_evidence_coverage')
  if (
    sourceCount <= 1 ||
    list(snapshot?.contradictions).length > 0 ||
    evidenceStatus.includes('conflict') ||
    evidenceStatus.includes('weak')
  ) reasons.push('radar_guard_weak_or_conflicting_source')
  if (val(snapshot?.decisiveRuleCode).includes('UNCLEAR') || confidence < 60) {
    reasons.push('radar_guard_unclear_provisional_grade')
  }
  return unique(reasons)
}
export function storageEvidenceStatusFor(value) {
  const source = val(value)
  if (source === 'single_traceable_source_ai_conclusion') return 'single_secondary_supported'
  if (ALLOWED_EVIDENCE_STATUSES.has(source)) return source
  throw new Error(`Unsupported public evidenceStatus: ${source || 'missing'}`)
}
function normalizedSnapshot(snapshot) {
  const out = structuredClone(snapshot || {})
  out.evidenceStatus = storageEvidenceStatusFor(out.evidenceStatus)
  out.matchedRules = list(out.matchedRules).map((rule) => canonical({
    ...(val(rule?.id) ? { id: val(rule.id) } : {}),
    code: val(rule?.code),
    grade: val(rule?.grade),
    confidencePercent: numeric(rule?.confidencePercent),
    reason: val(rule?.reason),
  }))
  out.contradictions = list(out.contradictions).map((item) => {
    if (typeof item === 'string') return canonical({ value: val(item) })
    return canonical({
      ...(val(item?.id) ? { id: val(item.id) } : {}),
      value: val(item?.value),
    })
  }).filter((item) => item.value)
  return canonical(out)
}
function assertSnapshot(snapshot, workId) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error(`Missing snapshot: ${workId}`)
  if (!ALLOWED_GRADES.has(val(snapshot.suggestedGrade))) throw new Error(`Invalid grade: ${workId}`)
  if (!val(snapshot.decisiveRuleCode)) throw new Error(`Missing decisive rule: ${workId}`)
  if (!val(snapshot.decisiveRuleReason)) throw new Error(`Missing decisive rule reason: ${workId}`)
  if (!val(snapshot.sourceSummary)) throw new Error(`Missing source summary: ${workId}`)
  if (!val(snapshot.policyVersion) || !val(snapshot.assessmentBatch)) throw new Error(`Missing policy/batch: ${workId}`)
  if (!Number.isFinite(Date.parse(val(snapshot.assessedAt)))) throw new Error(`Invalid assessedAt: ${workId}`)
  if (numeric(snapshot.sourceCount) < 1) throw new Error(`Invalid source count: ${workId}`)
  if (!list(snapshot.matchedRules).some((rule) => (
    val(rule?.code) === val(snapshot.decisiveRuleCode) &&
    val(rule?.grade) === val(snapshot.suggestedGrade)
  ))) throw new Error(`Decisive rule missing from matchedRules: ${workId}`)
}
export function buildPhase2StorageRow(phase2Row, phase2ZipSha256 = EXPECTED_PHASE2_SHA256) {
  const workId = val(phase2Row?.workId)
  const publicationKey = val(phase2Row?.publicationKey)
  if (!/^\d+$/u.test(workId) || publicationKey !== `work:${workId}`) {
    throw new Error(`Phase2 publication identity mismatch: ${workId}`)
  }
  if (phase2Row?.finalState !== 'ready_for_unified_incremental_assembly') {
    throw new Error(`Phase2 row is not ready: ${workId}`)
  }
  if (phase2Row?.liveGuard?.passed !== true) throw new Error(`Phase2 live guard failed: ${workId}`)
  if (phase2Row?.coverageExemptNoncanonical === true) throw new Error(`Noncanonical row entered ready set: ${workId}`)
  const sourceEvidenceStatus = val(phase2Row?.resolvedSnapshot?.evidenceStatus)
  const snapshot = normalizedSnapshot(phase2Row.resolvedSnapshot)
  assertSnapshot(snapshot, workId)
  const grade = val(snapshot.suggestedGrade)
  const core = canonical({
    publicationKey,
    work: workId,
    workIdSnapshot: workId,
    workSiteId: val(phase2Row.siteId),
    title: val(phase2Row?.liveGuard?.live?.title || phase2Row.title),
    recordStatus: 'current',
    conclusionMode: 'fixed_grade',
    compatibilityGrade: grade,
    bestGrade: grade,
    likelyGrade: grade,
    worstGrade: grade,
    ratingNotice: ratingNoticeFor(snapshot),
    reviewReasons: reviewReasonsFor(snapshot),
    evidenceStrength: evidenceStrengthFor(snapshot),
    radarAssessment: snapshot,
    sourceKind: 'package',
    sourcePackageId: PHASE2_PACKAGE_ID,
    sourcePackageSha256: val(phase2ZipSha256).toLowerCase(),
    publicationVersion: PUBLICATION_VERSION,
  })
  const preStorage = canonical({ ...core, conclusionSha256: sha256Canonical(core) })
  const normalized = normalizePublicRecordForStorage(preStorage)
  if (conclusionSha256ForRecord(normalized.normalizedRecord) !== normalized.normalizedRecord.conclusionSha256) {
    throw new Error(`Storage hash mismatch: ${workId}`)
  }
  return canonical({
    sourceWorkId: workId,
    siteId: val(phase2Row.siteId),
    title: core.title,
    assessmentBatch: snapshot.assessmentBatch,
    policyVersion: snapshot.policyVersion,
    grade,
    target: { id: workId, siteId: val(phase2Row.siteId), title: core.title },
    humanTrackRecorded: phase2Row?.liveGuard?.draft?.humanTrackRecorded === true,
    humanTrackAffectsAIStorage: false,
    needsPublicationGuard: false,
    privateStatus: 'ai_track_independent_no_works_write_planned',
    publicStatus: 'ready_public_ai_create',
    privatePlan: null,
    publicRecord: normalized.normalizedRecord,
    storageStatus: 'ready_public_ai_storage_normalized',
    storageNormalizationVersion: PUBLIC_CONCLUSION_STORAGE_VERSION,
    sourceCohort: 'phase2_remaining_1122_closeout',
    sourceCandidateSha256: val(phase2Row.resolvedCandidateSha256),
    sourceEvidenceStatus,
    storageEvidenceStatus: snapshot.evidenceStatus,
    privateBlockers: [],
    publicBlockers: [],
    blockers: [],
    warnings: unique([
      ...list(phase2Row.warnings).map(val),
      ...(numeric(snapshot.sourceCount) <= 1 ? ['single_provider_ai_conclusion_requires_future_multilingual_scan'] : []),
      ...(sourceEvidenceStatus !== snapshot.evidenceStatus
        ? [`storage_evidence_status_mapped:${sourceEvidenceStatus}->${snapshot.evidenceStatus}`]
        : []),
      'ai_track_storage_independent_from_human_display_precedence',
    ]),
  })
}
export function validateCombinedRows(oldRows, newRows) {
  if (oldRows.length !== EXPECTED_OLD_ROWS) throw new Error(`Old rows mismatch: ${oldRows.length}`)
  if (newRows.length !== EXPECTED_NEW_ROWS) throw new Error(`New rows mismatch: ${newRows.length}`)
  const rows = [...oldRows, ...newRows].sort((a, b) => numeric(a.sourceWorkId) - numeric(b.sourceWorkId))
  const publicationKeys = new Set()
  const workIds = new Set()
  const hashes = new Set()
  for (const [index, row] of rows.entries()) {
    const record = row?.publicRecord
    const workId = val(row?.sourceWorkId)
    const key = val(record?.publicationKey)
    const hash = val(record?.conclusionSha256).toLowerCase()
    if (row?.publicStatus !== 'ready_public_ai_create' || row?.storageStatus !== 'ready_public_ai_storage_normalized') {
      throw new Error(`Combined row status mismatch: ${index + 1}`)
    }
    if (list(row?.blockers).length || list(row?.privateBlockers).length || list(row?.publicBlockers).length) {
      throw new Error(`Combined row contains blockers: ${workId}`)
    }
    if (!record || key !== `work:${workId}` || val(record.work) !== workId || val(record.workIdSnapshot) !== workId) {
      throw new Error(`Combined publication identity mismatch: ${workId}`)
    }
    if (!/^[0-9a-f]{64}$/u.test(hash) || conclusionSha256ForRecord(record) !== hash) {
      throw new Error(`Combined conclusion hash mismatch: ${workId}`)
    }
    if (publicationKeys.has(key) || workIds.has(workId) || hashes.has(hash)) {
      throw new Error(`Combined duplicate identity/hash: ${workId}`)
    }
    publicationKeys.add(key)
    workIds.add(workId)
    hashes.add(hash)
  }
  if (rows.length !== EXPECTED_ROWS || publicationKeys.size !== EXPECTED_ROWS || workIds.size !== EXPECTED_ROWS || hashes.size !== EXPECTED_ROWS) {
    throw new Error('Combined cardinality mismatch.')
  }
  const grades = countBy(rows, (row) => row?.publicRecord?.compatibilityGrade)
  if (JSON.stringify(canonical(grades)) !== JSON.stringify(EXPECTED_INCREMENTAL_GRADES)) {
    throw new Error(`Combined grade distribution mismatch: ${JSON.stringify(grades)}`)
  }
  return { rows, grades }
}
export function buildOutputs({
  oldAssemblyDir,
  oldAssemblyZipSha256,
  phase2Dir,
  phase2ZipSha256,
  priorLabEvidenceSha256,
  outDir,
}) {
  if (val(oldAssemblyZipSha256).toLowerCase() !== EXPECTED_OLD_ASSEMBLY_SHA256) {
    throw new Error('Old 683 assembly ZIP SHA-256 mismatch.')
  }
  if (val(phase2ZipSha256).toLowerCase() !== EXPECTED_PHASE2_SHA256) {
    throw new Error('Phase2 ZIP SHA-256 mismatch.')
  }
  if (val(priorLabEvidenceSha256).toLowerCase() !== EXPECTED_PRIOR_LAB_EVIDENCE_SHA256) {
    throw new Error('Prior 683 lab evidence ZIP SHA-256 mismatch.')
  }
  assertManifest(oldAssemblyDir)
  assertManifest(phase2Dir)

  const oldSummary = readJson(path.join(oldAssemblyDir, 'radar-blocked-assembly-dryrun-summary.json'))
  const oldValidation = readJson(path.join(oldAssemblyDir, 'assembly-dryrun-validation.json'))
  const phase2Summary = readJson(path.join(phase2Dir, 'phase2-closeout-summary.json'))
  const phase2Validation = readJson(path.join(phase2Dir, 'phase2-validation.json'))
  if (
    oldSummary?.rows !== EXPECTED_OLD_ROWS ||
    oldSummary?.storageNormalized !== EXPECTED_OLD_ROWS ||
    oldSummary?.blocked !== 0 ||
    oldSummary?.readyForNextStorageLabPlanning !== true ||
    oldValidation?.passed !== true
  ) throw new Error('Old 683 assembly evidence is not accepted.')
  if (
    phase2Summary?.rows !== 1122 ||
    phase2Summary?.readyForUnifiedIncrementalAssembly !== EXPECTED_NEW_ROWS ||
    phase2Summary?.retainedBlockedFinal !== EXPECTED_BLOCKED_ROWS ||
    phase2Summary?.humanDecisionRequired !== 0 ||
    phase2Summary?.readyForUnifiedAssemblyPlanning !== true ||
    phase2Validation?.passed !== true ||
    phase2Validation?.unresolvedCanonicalAICoverageRows !== 0 ||
    phase2Validation?.noncanonicalCoverageExemptRows !== EXPECTED_BLOCKED_ROWS
  ) throw new Error('Phase2 closeout evidence is not accepted.')

  const oldRows = readJsonl(path.join(oldAssemblyDir, 'public-ai-storage-ready.jsonl'))
  const phase2Ready = readJsonl(path.join(phase2Dir, 'phase2-ready-for-unified-incremental-assembly.jsonl'))
  const phase2Blocked = readJsonl(path.join(phase2Dir, 'phase2-retained-blocked-final.jsonl'))
  if (phase2Blocked.length !== EXPECTED_BLOCKED_ROWS || phase2Blocked[0]?.coverageExemptNoncanonical !== true) {
    throw new Error('Phase2 noncanonical exemption mismatch.')
  }
  const newRows = phase2Ready.map((row) => buildPhase2StorageRow(row, phase2ZipSha256))
  const combined = validateCombinedRows(oldRows, newRows)
  const oldKeys = new Set(oldRows.map((row) => val(row?.publicRecord?.publicationKey)))
  const newKeys = new Set(newRows.map((row) => val(row?.publicRecord?.publicationKey)))
  const overlap = [...oldKeys].filter((key) => newKeys.has(key))
  if (overlap.length) throw new Error(`Old/new publication overlap: ${overlap.slice(0, 10).join(',')}`)

  fs.mkdirSync(outDir, { recursive: true })
  const outputs = {
    ready: path.join(outDir, 'public-ai-storage-ready.jsonl'),
    lineage: path.join(outDir, 'unified-incremental-source-lineage.jsonl'),
    blocked: path.join(outDir, 'noncanonical-coverage-exempt.jsonl'),
    summary: path.join(outDir, 'radar-unified-incremental-assembly-summary.json'),
    validation: path.join(outDir, 'unified-incremental-assembly-validation.json'),
  }
  writeJsonl(outputs.ready, combined.rows)
  writeJsonl(outputs.lineage, combined.rows.map((row) => canonical({
    workId: val(row.sourceWorkId),
    publicationKey: val(row?.publicRecord?.publicationKey),
    conclusionSha256: val(row?.publicRecord?.conclusionSha256),
    sourceCohort: val(row.sourceCohort) || 'prior_683_accepted_assembly',
    sourcePackageId: val(row?.publicRecord?.sourcePackageId),
    sourcePackageSha256: val(row?.publicRecord?.sourcePackageSha256),
    evidenceStrength: val(row?.publicRecord?.evidenceStrength),
    ratingNotice: val(row?.publicRecord?.ratingNotice),
    reviewReasons: list(row?.publicRecord?.reviewReasons),
  })))
  writeJsonl(outputs.blocked, phase2Blocked)

  const strengthCounts = countBy(combined.rows, (row) => row?.publicRecord?.evidenceStrength)
  const noticeCounts = countBy(combined.rows, (row) => row?.publicRecord?.ratingNotice)
  const sourceCohorts = countBy(combined.rows, (row) => val(row.sourceCohort) || 'prior_683_accepted_assembly')
  const singleProviderRows = newRows.filter((row) => numeric(row?.publicRecord?.radarAssessment?.sourceCount) <= 1).length
  const evidenceStatusMappedRows = newRows.filter((row) => row.sourceEvidenceStatus !== row.storageEvidenceStatus).length
  const globalBlockers = []
  if (singleProviderRows !== 728) globalBlockers.push(`single_provider_expected_728_received_${singleProviderRows}`)
  if (evidenceStatusMappedRows !== 728) globalBlockers.push(`evidence_status_mapping_expected_728_received_${evidenceStatusMappedRows}`)
  if (phase2Blocked[0]?.workId !== '25561') globalBlockers.push('noncanonical_exemption_work_mismatch')
  if (newRows.some((row) => row.humanTrackAffectsAIStorage !== false)) globalBlockers.push('human_track_storage_independence_failed')

  const summary = canonical({
    schemaVersion: 1,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    rows: combined.rows.length,
    storageNormalized: combined.rows.length,
    blocked: 0,
    oldAcceptedRows: oldRows.length,
    newPhase2Rows: newRows.length,
    noncanonicalCoverageExemptRows: phase2Blocked.length,
    productionPublicBaseline: EXPECTED_BASELINE_ROWS,
    postApplyRowsInIsolatedLabExpected: EXPECTED_BASELINE_ROWS + EXPECTED_ROWS,
    byGrade: combined.grades,
    byEvidenceStrength: strengthCounts,
    byRatingNotice: noticeCounts,
    bySourceCohort: sourceCohorts,
    singleProviderAIConclusionRows: singleProviderRows,
    storageEvidenceStatusMappedRows: evidenceStatusMappedRows,
    storageEvidenceStatusMapping: canonical({
      from: 'single_traceable_source_ai_conclusion',
      to: 'single_secondary_supported',
      semanticChange: false,
      gradeOrRuleMutation: false,
    }),
    uniqueWorkIds: new Set(combined.rows.map((row) => val(row.sourceWorkId))).size,
    uniquePublicationKeys: new Set(combined.rows.map((row) => val(row?.publicRecord?.publicationKey))).size,
    uniqueConclusionHashes: new Set(combined.rows.map((row) => val(row?.publicRecord?.conclusionSha256))).size,
    sources: canonical({
      oldAssemblyZipSha256: val(oldAssemblyZipSha256).toLowerCase(),
      phase2ZipSha256: val(phase2ZipSha256).toLowerCase(),
      prior683LabEvidenceSha256: val(priorLabEvidenceSha256).toLowerCase(),
      productionPublicBaseline: EXPECTED_BASELINE_ROWS,
    }),
    coveragePolicy: canonical({
      canonicalWorkRequiresCurrentAIConclusion: true,
      humanTrackBlocksAIConclusion: false,
      evidenceShortageBlocksAIConclusion: false,
      lifecycleVisibilityBlocksAIStorage: false,
      displayAndSearchPrecedenceOnly: 'valid_human_then_current_ai_then_unknown',
    }),
    globalBlockers,
    readyForStorageLabPlanning: globalBlockers.length === 0,
    safety: canonical({
      networkFetch: false,
      payloadRead: false,
      payloadWrite: false,
      postgresqlRead: false,
      postgresqlWrite: false,
      productionDatabaseWrite: false,
      productionApplyAuthorized: false,
    }),
  })
  writeJson(outputs.summary, summary)
  const validation = canonical({
    schemaVersion: 1,
    passed: globalBlockers.length === 0,
    expectedRows: EXPECTED_ROWS,
    observedRows: combined.rows.length,
    oldNewPublicationOverlap: overlap.length,
    uniqueWorkIds: summary.uniqueWorkIds,
    uniquePublicationKeys: summary.uniquePublicationKeys,
    uniqueConclusionHashes: summary.uniqueConclusionHashes,
    allConclusionHashesReproduce: combined.rows.every((row) => (
      conclusionSha256ForRecord(row.publicRecord) === row.publicRecord.conclusionSha256
    )),
    allStorageRowsUnblocked: combined.rows.every((row) => (
      !list(row.blockers).length && !list(row.privateBlockers).length && !list(row.publicBlockers).length
    )),
    allWorkIdentitiesNumericAndExact: combined.rows.every((row) => (
      /^\d+$/u.test(val(row.sourceWorkId)) &&
      val(row?.publicRecord?.publicationKey) === `work:${val(row.sourceWorkId)}` &&
      val(row?.publicRecord?.work) === val(row.sourceWorkId) &&
      val(row?.publicRecord?.workIdSnapshot) === val(row.sourceWorkId)
    )),
    humanTrackNeverBlocksAIStorage: true,
    singleProviderRowsRemainExplicitAIConclusions: singleProviderRows === 728,
    storageEvidenceStatusMappedRows: evidenceStatusMappedRows,
    storageEvidenceStatusMappingPreservesGradeAndRule: true,
    noncanonicalCoverageExemptRows: phase2Blocked.length,
    retainedBlockedWorkIds: phase2Blocked.map((row) => val(row.workId)),
    gradeDistribution: combined.grades,
    globalBlockers,
    safety: summary.safety,
  })
  writeJson(outputs.validation, validation)
  const readySha256 = sha256File(outputs.ready)
  summary.readyFile = 'public-ai-storage-ready.jsonl'
  summary.readyFileSha256 = readySha256
  writeJson(outputs.summary, canonical(summary))
  return { outputs, summary: canonical(summary), validation }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  for (const flag of FORBIDDEN_FLAGS) if (args[flag]) throw new Error(`Unified assembly rejects --${flag}.`)
  const result = buildOutputs({
    oldAssemblyDir: required(args, 'old-assembly-dir'),
    oldAssemblyZipSha256: val(args['old-assembly-zip-sha256']),
    phase2Dir: required(args, 'phase2-dir'),
    phase2ZipSha256: val(args['phase2-zip-sha256']),
    priorLabEvidenceSha256: val(args['prior-lab-evidence-sha256']),
    outDir: required(args, 'out-dir'),
  })
  console.log(JSON.stringify({ ok: true, summary: result.summary, validation: result.validation }, null, 2))
}

const direct = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (direct) main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1 })
