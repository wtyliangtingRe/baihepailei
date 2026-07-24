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

export const VERSION = 'radar-blocked-assembly-dryrun-v0.1'
export const EXPECTED_ASSEMBLY_ZIP_SHA256 = 'ecd2b30f925c2c20ef40f69a000d3bbd3950c6e42917aecad0449f7e79dd4d68'
export const EXPECTED_RESEARCH_ZIP_SHA256 = 'bfd991789b582faf4e780c973804d7ee8af4669f7ddb9724c3c52f9133d680a1'
export const EXPECTED_REMEDIATION_ZIP_SHA256 = '954c595e92c91f140b568389022c529196f5b4dbac00a83964377166b9eee729'
export const EXPECTED_ROWS = 683
export const EXPECTED_PUBLIC_BASELINE = 9000
export const ASSESSMENT_BATCH = 'RADAR-BLOCKED-ASSEMBLY-20260724'
export const SOURCE_PACKAGE_ID = 'RADAR-BLOCKED-RESEARCH-ALL-1805-20260724'
export const PUBLICATION_VERSION = 'radar-public-conclusions-incremental-assembly-v0.1'
export const EXPECTED_GRADES = canonical({ A: 51, B: 423, C: 146, D: 40, E: 15, F: 8 })

const SNAPSHOT_FIELDS = [
  'assessedAt',
  'assessmentBatch',
  'confidencePercent',
  'contradictions',
  'decisiveRuleCode',
  'decisiveRuleReason',
  'evidenceCoveragePercent',
  'evidenceStatus',
  'matchedRules',
  'policyVersion',
  'requiresHumanReview',
  'sourceCount',
  'sourceSummary',
  'suggestedGrade',
]
const ALLOWED_GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F'])
const ASSEMBLY_CATEGORIES = new Set([
  'assembly_ready_manual_verified',
  'assembly_ready_structured_cross_source',
])
const FORBIDDEN_FLAGS = new Set(['execute', 'apply', 'write', 'patch', 'publish', 'restore', 'confirm', 'approval-token'])

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function unique(values) { return [...new Set(values.filter(Boolean))].sort() }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }
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
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')) }
function readJsonl(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
  return text.split(/\r?\n/u).filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line) } catch (error) { throw new Error(`Invalid JSONL ${file}:${index + 1}: ${error.message}`) }
  })
}
function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; i += 1 }
  }
  return args
}
function required(args, key) {
  const value = val(args[key])
  if (!value) throw new Error(`Required: --${key}`)
  return path.resolve(value)
}
function countBy(rows, getter) {
  const result = {}
  for (const row of rows) {
    const key = val(getter(row)) || 'missing'
    result[key] = (result[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function assertManifest(directory) {
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
  if (actual.length !== expected.size || actual.some((item) => !expected.has(item))) throw new Error(`Manifest coverage mismatch: ${directory}`)
  return manifest
}

function providerFamily(urlValue) {
  try {
    let host = new URL(val(urlValue)).hostname.toLowerCase().replace(/^www\./u, '')
    if (['bgm.tv', 'api.bgm.tv', 'bangumi.tv', 'bangumi.moe'].includes(host)) return 'bangumi'
    if (['anilist.co', 'graphql.anilist.co'].includes(host)) return 'anilist'
    if (['vndb.org', 'api.vndb.org'].includes(host)) return 'vndb'
    if (host.endsWith('myanimelist.net')) return 'myanimelist'
    if (host.endsWith('wikipedia.org')) return 'wikipedia'
    if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'youtube'
    return host
  } catch { return '' }
}

export function evidenceProviderFamilies(researchRow) {
  const category = val(researchRow?.decision?.category)
  if (category === 'assembly_ready_manual_verified') {
    return unique(list(researchRow?.sourceEvidence?.manualEvidence).map((item) => providerFamily(item?.url)))
  }
  return unique(list(researchRow?.sourceEvidence?.providerFamilies).map(val))
}

function exactSnapshot(candidateSnapshot) {
  const out = {}
  for (const key of SNAPSHOT_FIELDS) out[key] = structuredClone(candidateSnapshot?.[key] ?? null)
  if (!Array.isArray(out.matchedRules)) out.matchedRules = []
  if (!Array.isArray(out.contradictions)) out.contradictions = []
  return out
}

export function buildAssembledSnapshot({ ledgerRow, researchRow, researchGeneratedAt }) {
  const selected = ledgerRow?.selectedCandidate
  const source = selected?.snapshot
  const category = val(researchRow?.decision?.category)
  if (!source || !ASSEMBLY_CATEGORIES.has(category)) throw new Error('Invalid assembly source row.')
  const providers = evidenceProviderFamilies(researchRow)
  if (providers.length < 2) throw new Error(`Insufficient independent providers for Work ${ledgerRow?.workId}`)
  const snapshot = exactSnapshot(source)
  snapshot.assessedAt = val(researchGeneratedAt)
  snapshot.assessmentBatch = ASSESSMENT_BATCH
  snapshot.sourceCount = providers.length
  if (category === 'assembly_ready_manual_verified') {
    const findings = val(researchRow?.manualOverride?.findings)
    if (findings) snapshot.sourceSummary = findings
  }
  return canonical(snapshot)
}

function assertSnapshot(snapshot, workId) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error(`Missing assembled snapshot: ${workId}`)
  if (!ALLOWED_GRADES.has(val(snapshot.suggestedGrade))) throw new Error(`Invalid grade: ${workId}`)
  if (!val(snapshot.decisiveRuleCode)) throw new Error(`Missing decisive rule: ${workId}`)
  if (!val(snapshot.sourceSummary)) throw new Error(`Missing source summary: ${workId}`)
  if (Number(snapshot.sourceCount) < 2) throw new Error(`Source count remains below two: ${workId}`)
  if (val(snapshot.assessmentBatch) !== ASSESSMENT_BATCH) throw new Error(`Assessment batch mismatch: ${workId}`)
  if (!Number.isFinite(Date.parse(val(snapshot.assessedAt)))) throw new Error(`Invalid assessedAt: ${workId}`)
  if (!list(snapshot.matchedRules).some((rule) => val(rule?.code) === val(snapshot.decisiveRuleCode) && val(rule?.grade) === val(snapshot.suggestedGrade))) {
    throw new Error(`Decisive rule is not represented in matchedRules: ${workId}`)
  }
}

export function buildPublicRecord({ ledgerRow, assembledSnapshot, researchZipSha256 }) {
  const grade = val(assembledSnapshot.suggestedGrade)
  const originalPlan = ledgerRow?.sourceAuditRow?.privatePlan
  const core = canonical({
    publicationKey: val(ledgerRow.publicationKey),
    work: val(ledgerRow.workId),
    workIdSnapshot: val(ledgerRow.workId),
    workSiteId: val(ledgerRow.siteId),
    title: val(ledgerRow.liveSnapshot?.title || ledgerRow.title),
    recordStatus: 'current',
    conclusionMode: 'fixed_grade',
    compatibilityGrade: grade,
    bestGrade: grade,
    likelyGrade: grade,
    worstGrade: grade,
    ratingNotice: 'ai_synthesized_pending_review',
    reviewReasons: ['radar_v06_package_import'],
    evidenceStrength: val(originalPlan?.patch?.evidenceStrength) || 'strong',
    radarAssessment: assembledSnapshot,
    sourceKind: 'package',
    sourcePackageId: SOURCE_PACKAGE_ID,
    sourcePackageSha256: val(researchZipSha256).toLowerCase(),
    publicationVersion: PUBLICATION_VERSION,
  })
  return canonical({ ...core, conclusionSha256: sha256Canonical(core) })
}

function equalCanonical(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

export function privatePatchFor(ledgerRow, assembledSnapshot) {
  const sourcePlan = structuredClone(ledgerRow?.sourceAuditRow?.privatePlan || {})
  const patch = canonical({
    ...(sourcePlan.patch || {}),
    radarAssessment: assembledSnapshot,
    rank: assembledSnapshot.suggestedGrade,
  })
  const expectedBefore = sourcePlan.expectedBefore || null
  const changedFields = Object.keys(patch).filter((key) => !equalCanonical(expectedBefore?.[key], patch[key])).sort()
  return canonical({
    version: 'radar-blocked-private-whole-snapshot-plan-v0.1',
    workId: val(ledgerRow.workId),
    siteId: val(ledgerRow.siteId),
    target: sourcePlan.target || { id: val(ledgerRow.workId), siteId: val(ledgerRow.siteId), title: val(ledgerRow.title) },
    expectedBefore,
    expectedBeforeHash: val(sourcePlan.expectedBeforeHash),
    patch,
    patchSha256: sha256Canonical(patch),
    changedFields,
    planStatus: 'ready_private_ai_write',
    blockers: [],
    wholeSnapshotReplacement: true,
    explicitNullClearsOldValue: true,
    fieldResidualMergeForbidden: true,
    historicalCandidatesPreserved: true,
    safety: canonical({ payloadRead: false, payloadWrite: false, directPostgresqlWrite: false, productionApplyAuthorized: false }),
  })
}

export function buildDryRunRow({ ledgerRow, researchRow, researchGeneratedAt, researchZipSha256 }) {
  const blockers = []
  const warnings = []
  const workId = val(ledgerRow?.workId)
  const selected = ledgerRow?.selectedCandidate
  const candidateSha = val(selected?.candidateSha256)

  if (!workId || val(ledgerRow?.publicationKey) !== `work:${workId}`) blockers.push('publication_identity_mismatch')
  if (val(researchRow?.workId) !== workId || val(researchRow?.publicationKey) !== `work:${workId}`) blockers.push('research_identity_mismatch')
  if (val(researchRow?.candidate?.candidateSha256) !== candidateSha) blockers.push('research_candidate_sha256_mismatch')
  if (val(researchRow?.assemblyPatch?.preserveCandidateSha256) !== candidateSha) blockers.push('assembly_patch_candidate_sha256_mismatch')
  const sourcePrivatePlan = ledgerRow?.sourceAuditRow?.privatePlan
  if (!sourcePrivatePlan?.expectedBefore || sha256Canonical(sourcePrivatePlan.expectedBefore) !== val(sourcePrivatePlan.expectedBeforeHash)) blockers.push('source_private_expected_before_hash_mismatch')
  if (researchRow?.decision?.readyForOfflineAssemblyDryRun !== true) blockers.push('research_row_not_ready_for_assembly')
  if (researchRow?.decision?.sourceBlockerResolved !== true) blockers.push('source_blocker_not_resolved')
  if (!ASSEMBLY_CATEGORIES.has(val(researchRow?.decision?.category))) blockers.push('unexpected_research_category')
  if (ledgerRow?.selectedCandidateStatus !== 'latest_structurally_valid_complete') blockers.push('selected_candidate_not_complete')
  if (ledgerRow?.identityResolved !== true) blockers.push('identity_unresolved')
  if (ledgerRow?.discardedTestAssessment === true) blockers.push('discarded_test_assessment')
  if (ledgerRow?.currentPublicRecord != null) blockers.push('current_public_record_overlap')
  if (ledgerRow?.liveSnapshot?.catalogStatus !== 'active') blockers.push('live_catalog_not_active')
  if (ledgerRow?.liveSnapshot?.payloadStatus !== 'published') blockers.push('live_payload_not_published')
  if (ledgerRow?.liveSnapshot?.isLiteVisible !== true || ledgerRow?.liveSnapshot?.isFullVisible !== true) blockers.push('live_visibility_guard')
  if (ledgerRow?.humanTrack?.recorded === true) blockers.push('valid_human_track_present')
  if (JSON.stringify(list(ledgerRow?.remainingNonConflictBlockers)) !== JSON.stringify(['multiple_secondary_requires_two_traceable_sources'])) blockers.push('unexpected_remaining_blockers')
  for (const [field, expected] of [
    ['latestStructurallyValidIdentityResolvedWins', true],
    ['wholeSnapshotReplacementRequired', true],
    ['explicitNullClearsOldValue', true],
    ['fieldResidualMergeForbidden', true],
    ['historicalCandidatesPreserved', true],
  ]) if (ledgerRow?.[field] !== expected) blockers.push(`ledger_guard_missing:${field}`)

  if (val(researchRow?.decision?.category) === 'assembly_ready_structured_cross_source') {
    warnings.push('structured_source_evidence_is_triage_not_manual_page_review')
  }

  let assembledSnapshot = null
  let assembledCandidateSha256 = ''
  let privatePlan = null
  let publicRecordPreStorage = null
  let publicRecordStorageReady = null
  let storageMapping = null

  if (!blockers.length) {
    try {
      assembledSnapshot = buildAssembledSnapshot({ ledgerRow, researchRow, researchGeneratedAt })
      assertSnapshot(assembledSnapshot, workId)
      if (val(assembledSnapshot.suggestedGrade) !== val(selected?.grade)) blockers.push('assembled_grade_changed')
      if (val(assembledSnapshot.decisiveRuleCode) !== val(selected?.snapshot?.decisiveRuleCode)) blockers.push('assembled_decisive_rule_changed')
      assembledCandidateSha256 = sha256Canonical(canonical({
        workId,
        publicationKey: `work:${workId}`,
        source: 'blocked_research_assembly',
        sourceCandidateSha256: candidateSha,
        snapshot: assembledSnapshot,
      }))
      privatePlan = privatePatchFor(ledgerRow, assembledSnapshot)
      publicRecordPreStorage = buildPublicRecord({ ledgerRow, assembledSnapshot, researchZipSha256 })
      if (conclusionSha256ForRecord(publicRecordPreStorage) !== publicRecordPreStorage.conclusionSha256) blockers.push('pre_storage_public_hash_mismatch')
      const normalized = normalizePublicRecordForStorage(publicRecordPreStorage)
      publicRecordStorageReady = normalized.normalizedRecord
      storageMapping = normalized.mapping
      if (conclusionSha256ForRecord(publicRecordStorageReady) !== publicRecordStorageReady.conclusionSha256) blockers.push('storage_public_hash_mismatch')
    } catch (error) {
      blockers.push(`assembly_exception:${val(error?.message) || 'unknown'}`)
    }
  }

  return canonical({
    version: VERSION,
    dryRunStatus: blockers.length ? 'blocked' : 'ready_for_offline_assembly',
    workId,
    publicationKey: val(ledgerRow?.publicationKey),
    siteId: val(ledgerRow?.siteId),
    title: val(ledgerRow?.liveSnapshot?.title || ledgerRow?.title),
    sourceCandidateSha256: candidateSha,
    assembledCandidateSha256,
    researchCategory: val(researchRow?.decision?.category),
    sourceProviderFamilies: evidenceProviderFamilies(researchRow),
    assembledSnapshot,
    privatePlan,
    publicStatus: blockers.length ? 'blocked_public_ai' : 'ready_public_ai_create',
    publicRecordPreStorage,
    publicRecordStorageReady,
    storageMapping,
    historyCount: list(ledgerRow?.history).length,
    conflictCount: list(ledgerRow?.conflicts).length,
    wholeSnapshotReplacement: true,
    explicitNullClearsOldValue: true,
    fieldResidualMergeForbidden: true,
    historicalCandidatesPreserved: true,
    blockers: unique(blockers),
    warnings: unique(warnings),
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
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  for (const flag of FORBIDDEN_FLAGS) if (args[flag]) throw new Error(`Offline assembly dry-run rejects --${flag}.`)
  const assemblyDir = required(args, 'assembly-dir')
  const researchDir = required(args, 'research-dir')
  const remediationDir = required(args, 'remediation-dir')
  const outDir = required(args, 'out-dir')
  const assemblyZipSha256 = val(args['assembly-zip-sha256']).toLowerCase()
  const researchZipSha256 = val(args['research-zip-sha256']).toLowerCase()
  const remediationZipSha256 = val(args['remediation-zip-sha256']).toLowerCase()
  if (assemblyZipSha256 !== EXPECTED_ASSEMBLY_ZIP_SHA256) throw new Error('Assembly input ZIP SHA-256 mismatch.')
  if (researchZipSha256 !== EXPECTED_RESEARCH_ZIP_SHA256) throw new Error('Research ZIP SHA-256 mismatch.')
  if (remediationZipSha256 !== EXPECTED_REMEDIATION_ZIP_SHA256) throw new Error('Remediation ZIP SHA-256 mismatch.')
  if (fs.existsSync(outDir)) throw new Error(`Output directory already exists: ${outDir}`)

  assertManifest(assemblyDir)
  assertManifest(researchDir)
  assertManifest(remediationDir)

  const assemblySummary = readJson(path.join(assemblyDir, 'assembly-input-summary.json'))
  const researchSummary = readJson(path.join(researchDir, 'research-summary.json'))
  const remediationSummary = readJson(path.join(remediationDir, 'remediation', 'radar-public-blocked-remediation-summary.json'))
  if (assemblySummary?.rows !== EXPECTED_ROWS || assemblySummary?.uniqueWorkIds !== EXPECTED_ROWS || assemblySummary?.uniquePublicationKeys !== EXPECTED_ROWS) throw new Error('Assembly input summary cardinality mismatch.')
  if (val(assemblySummary?.sourceResearchBundleSha256).toLowerCase() !== EXPECTED_RESEARCH_ZIP_SHA256) throw new Error('Assembly input is not bound to the accepted research ZIP.')
  if (researchSummary?.rows !== 1805 || researchSummary?.totals?.assemblyReadyForOfflineDryRun !== EXPECTED_ROWS) throw new Error('Research summary mismatch.')
  if (val(researchSummary?.sourceBundleSha256).toLowerCase() !== EXPECTED_REMEDIATION_ZIP_SHA256) throw new Error('Research summary is not bound to remediation ZIP.')
  if (remediationSummary?.currentProductionPublicBaseline !== EXPECTED_PUBLIC_BASELINE || remediationSummary?.ledger?.rows !== 1805) throw new Error('Remediation public baseline mismatch.')
  if (remediationSummary?.conflictPolicy?.wholeSnapshotReplacement !== true || remediationSummary?.conflictPolicy?.explicitNullClearsOldValue !== true || remediationSummary?.conflictPolicy?.fieldResidualMergeForbidden !== true) throw new Error('Remediation conflict policy mismatch.')

  const assemblyRows = readJsonl(path.join(assemblyDir, 'radar-blocked-assembly-ready.jsonl'))
  const researchRows = readJsonl(path.join(researchDir, 'radar-blocked-research-results.jsonl'))
  const ledgerRows = readJsonl(path.join(researchDir, 'normalized-input-ledger.jsonl'))
  if (assemblyRows.length !== EXPECTED_ROWS || researchRows.length !== 1805 || ledgerRows.length !== 1805) throw new Error('Input row cardinality mismatch.')
  const researchByWork = new Map(researchRows.map((row) => [val(row.workId), row]))
  const ledgerByWork = new Map(ledgerRows.map((row) => [val(row.workId), row]))
  if (researchByWork.size !== 1805 || ledgerByWork.size !== 1805) throw new Error('Duplicate Work identity in research or ledger.')

  const rows = assemblyRows.map((assemblyRow) => {
    const workId = val(assemblyRow.workId)
    const researchRow = researchByWork.get(workId)
    const ledgerRow = ledgerByWork.get(workId)
    if (!researchRow || !ledgerRow) throw new Error(`Missing joined row: ${workId}`)
    if (JSON.stringify(canonical(assemblyRow)) !== JSON.stringify(canonical(researchRow))) throw new Error(`Assembly input row drift from full research result: ${workId}`)
    return buildDryRunRow({ ledgerRow, researchRow, researchGeneratedAt: researchSummary.generatedAt, researchZipSha256 })
  })

  const ready = rows.filter((row) => row.dryRunStatus === 'ready_for_offline_assembly')
  const blocked = rows.filter((row) => row.dryRunStatus === 'blocked')
  const warnings = rows.filter((row) => row.warnings.length)
  const publicPreStorage = ready.map((row) => canonical({
    sourceWorkId: row.workId,
    siteId: row.siteId,
    title: row.title,
    assessmentBatch: ASSESSMENT_BATCH,
    policyVersion: row.assembledSnapshot.policyVersion,
    grade: row.assembledSnapshot.suggestedGrade,
    target: { id: row.workId, siteId: row.siteId, title: row.title },
    humanTrackRecorded: false,
    needsPublicationGuard: false,
    privateStatus: 'ready_private_ai_write',
    publicStatus: 'ready_public_ai_create',
    privatePlan: row.privatePlan,
    publicRecord: row.publicRecordPreStorage,
    privateBlockers: [],
    publicBlockers: [],
    blockers: [],
    warnings: row.warnings,
  }))
  const publicStorageReady = ready.map((row) => canonical({
    sourceWorkId: row.workId,
    siteId: row.siteId,
    title: row.title,
    assessmentBatch: ASSESSMENT_BATCH,
    policyVersion: row.assembledSnapshot.policyVersion,
    grade: row.assembledSnapshot.suggestedGrade,
    target: { id: row.workId, siteId: row.siteId, title: row.title },
    humanTrackRecorded: false,
    needsPublicationGuard: false,
    privateStatus: 'ready_private_ai_write',
    publicStatus: 'ready_public_ai_create',
    privatePlan: row.privatePlan,
    publicRecord: row.publicRecordStorageReady,
    storageStatus: 'ready_public_ai_storage_normalized',
    storageNormalizationVersion: PUBLIC_CONCLUSION_STORAGE_VERSION,
    privateBlockers: [],
    publicBlockers: [],
    blockers: [],
    warnings: row.warnings,
  }))
  const privatePlans = ready.map((row) => row.privatePlan)
  const rewriteMap = ready.map((row) => row.storageMapping)
  const boundLedger = assemblyRows.map((row) => ledgerByWork.get(val(row.workId)))
  const gradeCounts = countBy(ready, (row) => row.assembledSnapshot.suggestedGrade)
  const researchCategories = countBy(rows, (row) => row.researchCategory)
  const conclusionHashes = new Set(ready.map((row) => row.publicRecordStorageReady.conclusionSha256))
  const candidateHashes = new Set(ready.map((row) => row.assembledCandidateSha256))
  const publicationKeys = new Set(ready.map((row) => row.publicationKey))
  const workIds = new Set(ready.map((row) => row.workId))
  const globalBlockers = []
  if (ready.length !== EXPECTED_ROWS) globalBlockers.push(`ready_expected_${EXPECTED_ROWS}_received_${ready.length}`)
  if (blocked.length) globalBlockers.push(`blocked_rows_${blocked.length}`)
  if (JSON.stringify(canonical(gradeCounts)) !== JSON.stringify(EXPECTED_GRADES)) globalBlockers.push('grade_distribution_mismatch')
  if (publicationKeys.size !== EXPECTED_ROWS || workIds.size !== EXPECTED_ROWS) globalBlockers.push('identity_uniqueness_mismatch')
  if (conclusionHashes.size !== EXPECTED_ROWS || candidateHashes.size !== EXPECTED_ROWS) globalBlockers.push('hash_uniqueness_mismatch')
  if (researchCategories.assembly_ready_manual_verified !== 20 || researchCategories.assembly_ready_structured_cross_source !== 663) globalBlockers.push('research_category_distribution_mismatch')
  if (warnings.length !== 663) globalBlockers.push('structured_warning_count_mismatch')
  if (publicPreStorage.some((row) => conclusionSha256ForRecord(row.publicRecord) !== row.publicRecord.conclusionSha256)) globalBlockers.push('pre_storage_hash_reproduction_failed')
  if (publicStorageReady.some((row) => conclusionSha256ForRecord(row.publicRecord) !== row.publicRecord.conclusionSha256)) globalBlockers.push('storage_hash_reproduction_failed')

  fs.mkdirSync(outDir, { recursive: true })
  const outputs = {
    all: path.join(outDir, 'radar-blocked-assembly-dryrun.jsonl'),
    ready: path.join(outDir, 'ready-for-offline-assembly.jsonl'),
    privatePlans: path.join(outDir, 'private-ai-whole-snapshot-plan.jsonl'),
    publicPreStorage: path.join(outDir, 'public-ai-pre-storage-ready.jsonl'),
    publicStorageReady: path.join(outDir, 'public-ai-storage-ready.jsonl'),
    rewriteMap: path.join(outDir, 'public-conclusion-storage-rewrite-map.jsonl'),
    boundLedger: path.join(outDir, 'bound-selected-ledger.jsonl'),
    warnings: path.join(outDir, 'warnings.jsonl'),
    blocked: path.join(outDir, 'blocked.jsonl'),
    summary: path.join(outDir, 'radar-blocked-assembly-dryrun-summary.json'),
    validation: path.join(outDir, 'assembly-dryrun-validation.json'),
  }
  writeJsonl(outputs.all, rows)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.privatePlans, privatePlans)
  writeJsonl(outputs.publicPreStorage, publicPreStorage)
  writeJsonl(outputs.publicStorageReady, publicStorageReady)
  writeJsonl(outputs.rewriteMap, rewriteMap)
  writeJsonl(outputs.boundLedger, boundLedger)
  writeJsonl(outputs.warnings, warnings)
  writeJsonl(outputs.blocked, blocked)

  const summary = canonical({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version: VERSION,
    sources: {
      assemblyZipSha256,
      researchZipSha256,
      remediationZipSha256,
      researchGeneratedAt: researchSummary.generatedAt,
      productionPublicBaseline: EXPECTED_PUBLIC_BASELINE,
    },
    rows: rows.length,
    readyForOfflineAssembly: ready.length,
    privateAIWholeSnapshotPlans: privatePlans.length,
    readyPublicAICreate: publicPreStorage.length,
    alreadyCurrentPublicAI: 0,
    readyPublicAIUpdate: 0,
    storageNormalized: publicStorageReady.length,
    blocked: blocked.length,
    warnings: warnings.length,
    byGrade: gradeCounts,
    byResearchCategory: researchCategories,
    identity: { uniqueWorkIds: workIds.size, uniquePublicationKeys: publicationKeys.size },
    hashes: { uniqueAssembledCandidates: candidateHashes.size, uniqueStorageConclusions: conclusionHashes.size },
    conflictPolicy: {
      latestStructurallyValidIdentityResolvedWins: true,
      wholeSnapshotReplacement: true,
      explicitNullClearsOldValue: true,
      fieldResidualMergeForbidden: true,
      historicalCandidatesPreserved: true,
    },
    globalBlockers,
    readyForNextStorageLabPlanning: globalBlockers.length === 0,
    outputs,
    safety: {
      networkFetch: false,
      payloadRead: false,
      payloadWrite: false,
      payloadPatchRequests: 0,
      postgresqlRead: false,
      postgresqlWrite: false,
      productionDatabaseWrite: false,
      productionApplyAuthorized: false,
      applyModeExists: false,
    },
  })
  const validation = canonical({
    schemaVersion: 1,
    expectedRows: EXPECTED_ROWS,
    observedRows: rows.length,
    allInputsManifestVerified: true,
    exactInputHashesVerified: true,
    assemblyRowsEqualFullResearchRows: true,
    candidateShaBindingsVerified: rows.filter((row) => !row.blockers.includes('research_candidate_sha256_mismatch')).length,
    currentPublicOverlap: rows.filter((row) => row.blockers.includes('current_public_record_overlap')).length,
    lifecycleAndVisibilityPassed: rows.filter((row) => !row.blockers.some((item) => item.includes('live_'))).length,
    humanTrackProtected: rows.filter((row) => !row.blockers.includes('valid_human_track_present')).length,
    wholeSnapshotRows: rows.filter((row) => row.wholeSnapshotReplacement === true).length,
    explicitNullRows: rows.filter((row) => row.explicitNullClearsOldValue === true).length,
    residualMergeForbiddenRows: rows.filter((row) => row.fieldResidualMergeForbidden === true).length,
    preStorageHashRows: publicPreStorage.length,
    storageHashRows: publicStorageReady.length,
    storageChangedFieldsOnly: rewriteMap.every((row) => JSON.stringify(row.changedFields) === JSON.stringify(['publicRecord.radarAssessment.assessedAt', 'publicRecord.conclusionSha256'])),
    globalBlockers,
    passed: globalBlockers.length === 0,
    safety: summary.safety,
  })
  writeJson(outputs.summary, summary)
  writeJson(outputs.validation, validation)

  console.log(`Radar blocked assembly dry-run complete`)
  console.log(`Rows: ${rows.length}`)
  console.log(`ReadyForOfflineAssembly: ${ready.length}`)
  console.log(`PrivateAIWholeSnapshotPlans: ${privatePlans.length}`)
  console.log(`ReadyPublicAICreate: ${publicPreStorage.length}`)
  console.log(`StorageNormalized: ${publicStorageReady.length}`)
  console.log(`Blocked: ${blocked.length}`)
  console.log(`Warnings: ${warnings.length}`)
  console.log(`GlobalBlockers: ${globalBlockers.length}`)
  console.log(`PayloadRead: False`)
  console.log(`PayloadWrite: False`)
  console.log(`PostgreSQLRead: False`)
  console.log(`PostgreSQLWrite: False`)
  console.log(`ProductionApplyAuthorized: False`)
  if (globalBlockers.length) process.exitCode = 2
}

const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isDirectRun) main()
