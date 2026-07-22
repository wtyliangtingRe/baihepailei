#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import {
  normalizePayloadValue,
  normalizedDocumentState,
  sha256,
  unrelatedPublishedState,
} from './lab-ai-radar-v06-version-roundtrip-v01.mjs'

const VERSION = 'ai-radar-full-coverage-publication-v0.1'
const PACKAGE_ID = 'RADAR-WAVE5-FULL-COVERAGE-8183-PUBLICATION-v01'
const CONFIRMATION = 'PUBLISH-ALL-VALID-AI-FIXED-OR-RANGE-CONCLUSIONS'
const DEFAULT_PACKAGE_DIR = 'data_local/outputs/ai-radar/wave5-full-coverage-8183-v01'
const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/full-coverage-publication-v01'
const VALID_GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F'])
const ALLOWED_PATCH_FIELDS = new Set([
  '_status',
  'radarAssessment',
  'rank',
  'ratingNotice',
  'reviewReasons',
  'evidenceStrength',
])
const PACKAGE_PRIORITY = {
  package_fixed: 400,
  latest_draft_fixed: 350,
  latest_draft_range: 320,
  published_fixed: 300,
  published_range: 280,
  package_range: 250,
}

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}
function equal(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)) }
function unique(values) { return [...new Set(values.filter(Boolean))] }
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
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')) }
function readJsonl(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  return raw ? raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)) : []
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}
function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8')
}
function countBy(values) {
  const counts = {}
  for (const raw of values) {
    const key = val(raw) || 'missing'
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}
function isGrade(value) { return VALID_GRADES.has(val(value).toUpperCase()) }
function radarOf(work) {
  return work?.radarAssessment && typeof work.radarAssessment === 'object' ? work.radarAssessment : {}
}
function boundedOf(value) {
  return {
    best: val(value?.bestGrade || value?.proposedBestGrade).toUpperCase(),
    likely: val(value?.likelyGrade || value?.proposedLikelyGrade).toUpperCase(),
    worst: val(value?.worstGrade || value?.proposedWorstGrade).toUpperCase(),
  }
}

export function classifyConclusion(value) {
  const radar = value?.radarAssessment && typeof value.radarAssessment === 'object' ? value.radarAssessment : value || {}
  const suggested = val(radar?.suggestedGrade).toUpperCase()
  if (isGrade(suggested)) return { mode: 'fixed_grade', suggestedGrade: suggested, compatibilityGrade: suggested }
  const range = boundedOf(radar)
  if (val(radar?.conclusionMode) === 'bounded_range' && isGrade(range.best) && isGrade(range.likely) && isGrade(range.worst)) {
    return { mode: 'bounded_range', bestGrade: range.best, likelyGrade: range.likely, worstGrade: range.worst, compatibilityGrade: range.likely }
  }
  return { mode: 'none' }
}

function packageConclusionCandidate(row) {
  const mode = val(row?.conclusionMode)
  if (mode === 'fixed_grade' && isGrade(row?.suggestedGrade)) {
    return { priority: PACKAGE_PRIORITY.package_fixed, source: 'package_fixed', mode, compatibilityGrade: val(row.suggestedGrade).toUpperCase(), conclusion: row }
  }
  const range = boundedOf(row)
  if (mode === 'bounded_range' && isGrade(range.best) && isGrade(range.likely) && isGrade(range.worst)) {
    return { priority: PACKAGE_PRIORITY.package_range, source: 'package_range', mode, compatibilityGrade: range.likely, conclusion: row }
  }
  return null
}
function workConclusionCandidate(work, source) {
  const classified = classifyConclusion(work)
  if (classified.mode === 'none') return null
  const suffix = classified.mode === 'fixed_grade' ? 'fixed' : 'range'
  return { priority: PACKAGE_PRIORITY[`${source}_${suffix}`], source: `${source}_${suffix}`, mode: classified.mode, compatibilityGrade: classified.compatibilityGrade, conclusion: radarOf(work) }
}
export function chooseConclusionCandidate({ packageRow, latestDraft, published }) {
  const candidates = [packageConclusionCandidate(packageRow), workConclusionCandidate(latestDraft, 'latest_draft'), workConclusionCandidate(published, 'published')].filter(Boolean)
  candidates.sort((a, b) => b.priority - a.priority || a.source.localeCompare(b.source))
  return candidates[0] || null
}

function sourceTypeForEvidenceStatus(status) {
  if (status === 'official_confirmed') return 'official'
  if (status === 'primary_material_confirmed') return 'primary'
  if (['multiple_secondary_supported', 'single_secondary_supported'].includes(status)) return 'secondary'
  if (status === 'community_consensus') return 'community'
  return 'other'
}
function riskSignalsFromRules(rules) {
  const text = list(rules).map((rule) => val(rule?.code || rule)).join(' ').toUpperCase()
  const values = []
  if (/MALE|HET|BOY|STRAIGHT/u.test(text)) values.push('male_involvement')
  if (/NTR/u.test(text)) values.push('ntr')
  if (/FUTA/u.test(text)) values.push('futa')
  if (/OTOKONOKO|CROSSDRESS/u.test(text)) values.push('otokonoko')
  if (/(^|[-_])TS($|[-_])/u.test(text)) values.push('ts')
  if (/PAST-MALE|PRIOR-MALE/u.test(text)) values.push('prior_male_relationship')
  if (/ABO/u.test(text)) values.push('abo')
  if (!values.length && /SPECIAL|RISK|UNCLEAR|GENERAL/u.test(text)) values.push('other')
  return unique(values)
}
function researchRecordBody(packageRow, targetId) {
  const mode = val(packageRow?.conclusionMode)
  const fixed = val(packageRow?.suggestedGrade).toUpperCase()
  const range = boundedOf(packageRow)
  const likely = mode === 'fixed_grade' ? fixed : range.likely
  const best = mode === 'fixed_grade' ? fixed : range.best
  const worst = mode === 'fixed_grade' ? fixed : range.worst
  const urls = list(packageRow?.sourceUrls)
  const status = val(packageRow?.evidenceStatus)
  return {
    researchKey: `wave5-full-coverage-v01|${val(packageRow?.workId)}|${val(packageRow?.siteId)}`,
    title: val(packageRow?.title), programId: 'RADAR-WAVE5-FULL-COVERAGE-8183', importBatch: PACKAGE_ID,
    batchId: val(packageRow?.assessmentBatch) || 'RADAR-WAVE5-FULL-COVERAGE-8183', wave: 'wave5',
    lane: mode === 'fixed_grade' ? 'exact_research' : 'coarse_bounded_range', milestone: 3,
    work: targetId, workIdSnapshot: val(packageRow?.workId), workSiteId: val(packageRow?.siteId), recordShape: 'catalog',
    researchStatus: mode === 'fixed_grade' ? 'resolved' : 'partial',
    yuriRelevance: ['S', 'A', 'B'].includes(likely) ? 'high' : ['C', 'D'].includes(likely) ? 'possible' : 'unknown',
    riskSignals: riskSignalsFromRules(packageRow?.matchedRules), proposedLikelyGrade: likely, proposedBestGrade: best, proposedWorstGrade: worst,
    sourceSummary: val(packageRow?.sourceSummary),
    sources: urls.map((url, index) => ({ title: `Wave 5 source ${index + 1}`, url, sourceType: sourceTypeForEvidenceStatus(status) })),
    unresolvedQuestions: list(packageRow?.uncertaintyReasons).map((value) => ({ value: val(value) })).filter((item) => item.value),
    confidencePercent: Number.isFinite(Number(packageRow?.confidencePercent)) ? Math.max(0, Math.min(100, Math.round(Number(packageRow.confidencePercent)))) : null,
    recommendedNextAction: 'human_review', recommendedNextQueue: mode === 'fixed_grade' ? 'low_priority' : 'full_assessment',
    researchNote: [mode === 'fixed_grade' ? 'Wave 5 精确 AI 结论。' : 'Wave 5 有界范围粗评；最可能等级仅用于目录兼容。', val(packageRow?.uncertaintySummary)].filter(Boolean).join(' '),
    sourceResponseSha256: sha256(canonical(packageRow)), importedAt: val(packageRow?.assessedAt) || new Date().toISOString(), recordStatus: 'current',
  }
}
function packageRadarAssessment(row) {
  const mode = val(row?.conclusionMode)
  const fixed = val(row?.suggestedGrade).toUpperCase()
  const range = boundedOf(row)
  const likely = mode === 'fixed_grade' ? fixed : range.likely
  const rangePrefix = mode === 'bounded_range' ? `AI 暂定范围：${range.best}–${range.worst}，最可能 ${range.likely}。` : ''
  return canonical({
    confidencePercent: row?.confidencePercent, evidenceCoveragePercent: row?.evidenceCoveragePercent,
    evidenceStatus: row?.evidenceStatus, sourceSummary: `${rangePrefix}${val(row?.sourceSummary)}`.trim(), sourceCount: row?.sourceCount,
    policyVersion: row?.policyVersion, assessmentBatch: row?.assessmentBatch, suggestedGrade: likely,
    decisiveRuleCode: row?.decisiveRuleCode || (mode === 'bounded_range' ? 'RANGE-PROVISIONAL' : ''),
    decisiveRuleReason: mode === 'bounded_range' ? `该等级是有界范围的最可能值；完整范围为 ${range.best}–${range.worst}。${val(row?.decisiveRuleReason)}` : row?.decisiveRuleReason,
    matchedRules: list(row?.matchedRules),
    contradictions: [...list(row?.contradictions), ...(mode === 'bounded_range' ? [{ value: `AI 暂定范围 ${range.best}–${range.worst}；最可能 ${range.likely}，尚需人工复核。` }] : [])],
    requiresHumanReview: true, assessedAt: row?.assessedAt,
  })
}
function humanTrackRecorded(work) {
  const human = work?.humanAssessment
  return Boolean(isGrade(human?.grade) || ['reviewed', 'disputed'].includes(val(human?.status)) || val(human?.note) || val(human?.sourceSummary) || val(human?.assessedAt) || val(work?.humanReviewNote) || val(work?.humanReviewedAt) || val(work?.humanReviewedBy))
}
function evidenceStrengthFromRadar(radar) {
  const coverage = Number(radar?.evidenceCoveragePercent)
  const status = val(radar?.evidenceStatus)
  if (['official_confirmed', 'primary_material_confirmed'].includes(status) && coverage >= 65) return 'strong'
  if (status === 'multiple_secondary_supported' || coverage >= 50) return 'medium'
  return 'weak'
}
function candidateRadar(candidate) {
  if (!candidate) return null
  return candidate.source.startsWith('package_') ? packageRadarAssessment(candidate.conclusion) : canonical(candidate.conclusion)
}
function patchMatches(document, patch) {
  return Object.entries(patch || {}).every(([key, value]) => equal(normalizePayloadValue(document?.[key]), normalizePayloadValue(value)))
}
function selectedHumanState(work) {
  return canonical(normalizePayloadValue({ humanAssessment: work?.humanAssessment || null, humanReviewNote: work?.humanReviewNote || null, humanReviewedAt: work?.humanReviewedAt || null, humanReviewedBy: work?.humanReviewedBy || null }))
}
export function buildPublicationPatch({ candidate, published }) {
  const radarAssessment = candidateRadar(candidate)
  if (!radarAssessment) return null
  const patch = { _status: 'published', radarAssessment }
  if (!humanTrackRecorded(published)) {
    patch.rank = candidate.compatibilityGrade
    patch.ratingNotice = 'ai_synthesized_pending_review'
    patch.reviewReasons = unique([...list(published?.reviewReasons), 'radar_v06_package_import', ...(candidate.mode === 'bounded_range' ? ['radar_guard_low_evidence_coverage'] : [])]).sort()
    patch.evidenceStrength = evidenceStrengthFromRadar(radarAssessment)
  }
  return canonical(patch)
}
function normalizeIgnoringRootStatus(document) {
  const state = structuredClone(normalizedDocumentState(document))
  if (state && typeof state === 'object' && !Array.isArray(state)) delete state._status
  return canonical(state)
}
function parentId(versionRow) {
  if (typeof versionRow?.parent === 'string' || typeof versionRow?.parent === 'number') return val(versionRow.parent)
  return val(versionRow?.parent?.id || versionRow?.parent?.value)
}
function matchingPublishedVersions(versionRows, published) {
  const expected = normalizeIgnoringRootStatus(published)
  return list(versionRows).filter((row) => equal(normalizeIgnoringRootStatus(row?.version), expected)).sort((a, b) => Date.parse(val(b?.createdAt)) - Date.parse(val(a?.createdAt)))
}
function matchingExactVersions(versionRows, document) {
  const expected = normalizedDocumentState(document)
  return list(versionRows).filter((row) => equal(normalizedDocumentState(row?.version), expected)).sort((a, b) => Date.parse(val(b?.createdAt)) - Date.parse(val(a?.createdAt)))
}
function workMap(rows) {
  const byId = new Map(); const bySiteId = new Map()
  for (const row of rows) { const id = val(row?.id); const siteId = val(row?.siteId); if (id) byId.set(id, row); if (siteId) bySiteId.set(siteId, row) }
  return { byId, bySiteId }
}
function resolvePackageTarget(packageRow, publishedMaps, draftMaps) {
  const workId = val(packageRow?.workId); const siteId = val(packageRow?.siteId)
  const publishedById = publishedMaps.byId.get(workId) || null; const publishedBySite = publishedMaps.bySiteId.get(siteId) || null
  const draftById = draftMaps.byId.get(workId) || null; const draftBySite = draftMaps.bySiteId.get(siteId) || null
  const blockers = []; const ids = unique([val(publishedById?.id), val(publishedBySite?.id), val(draftById?.id), val(draftBySite?.id)])
  if (ids.length > 1) blockers.push('work_id_and_site_id_resolve_to_different_targets')
  const published = publishedById || publishedBySite; const latestDraft = draftById || draftBySite
  if (!published) blockers.push('published_work_missing'); if (!latestDraft) blockers.push('latest_draft_work_missing')
  if (published && siteId && val(published?.siteId) !== siteId) blockers.push('published_site_id_mismatch')
  if (latestDraft && siteId && val(latestDraft?.siteId) !== siteId) blockers.push('latest_draft_site_id_mismatch')
  return { published, latestDraft, blockers: unique(blockers) }
}
function buildPlanRow({ packageRow, published, latestDraft, sourceKind = 'package' }) {
  const blockers = []; const warnings = []; const targetId = val(published?.id || latestDraft?.id || packageRow?.workId)
  const candidate = chooseConclusionCandidate({ packageRow, latestDraft, published })
  if (!published) blockers.push('published_work_missing'); if (!latestDraft) blockers.push('latest_draft_work_missing'); if (!candidate) blockers.push('no_valid_fixed_or_bounded_conclusion')
  if (val(published?.catalogStatus) === 'archived' || val(latestDraft?.catalogStatus) === 'archived') blockers.push('catalog_archived')
  if (val(published?.reviewStatus) === 'deprecated' || val(latestDraft?.reviewStatus) === 'deprecated') blockers.push('review_status_deprecated')
  const patch = candidate ? buildPublicationPatch({ candidate, published }) : null
  if (patch) { for (const field of Object.keys(patch)) if (!ALLOWED_PATCH_FIELDS.has(field)) blockers.push(`unexpected_patch_field:${field}`); if ('humanAssessment' in patch) blockers.push('human_assessment_patch_forbidden') }
  const packageResearch = packageRow && targetId ? researchRecordBody(packageRow, targetId) : null
  const alreadyPublished = Boolean(patch && published && val(published?._status) === 'published' && patchMatches(published, patch))
  const sameUnrelated = Boolean(patch && published && latestDraft && equal(unrelatedPublishedState(published, patch), unrelatedPublishedState(latestDraft, patch)))
  let strategy = 'blocked'
  if (!blockers.length && alreadyPublished) strategy = 'already_published'
  else if (!blockers.length && sameUnrelated) strategy = 'direct_field_publish'
  else if (!blockers.length) strategy = 'version_roundtrip'
  if (candidate?.source === 'latest_draft_fixed' && packageRow?.conclusionMode === 'bounded_range') warnings.push('existing_draft_fixed_grade_preserved_over_new_coarse_range')
  if (humanTrackRecorded(published)) warnings.push('human_track_present_compatibility_fields_omitted')
  return canonical({
    version: VERSION, sourceKind, planStatus: blockers.length ? 'blocked' : strategy === 'already_published' ? 'already_published' : 'ready', strategy,
    workId: val(packageRow?.workId || published?.id || latestDraft?.id), siteId: val(packageRow?.siteId || published?.siteId || latestDraft?.siteId), title: val(packageRow?.title || published?.title || latestDraft?.title), targetId,
    selectedCandidate: candidate ? { source: candidate.source, mode: candidate.mode, priority: candidate.priority, compatibilityGrade: candidate.compatibilityGrade } : null,
    publishedCoverage: classifyConclusion(published), patch, patchSha256: patch ? sha256(patch) : '',
    expectedBefore: { publishedStateSha256: published ? sha256(normalizedDocumentState(published)) : '', draftStateSha256: latestDraft ? sha256(normalizedDocumentState(latestDraft)) : '', publishedHumanStateSha256: published ? sha256(selectedHumanState(published)) : '', publishedUnrelatedStateSha256: published && patch ? sha256(unrelatedPublishedState(published, patch)) : '', draftUnrelatedStateSha256: latestDraft && patch ? sha256(unrelatedPublishedState(latestDraft, patch)) : '' },
    researchRecord: packageResearch, researchRecordSha256: packageResearch ? sha256(packageResearch) : '', humanTrackRecorded: humanTrackRecorded(published),
    humanTrackPreservedByOmission: Boolean(patch && !('humanAssessment' in patch)), wholeDraftPublicationForbidden: true, blockers: unique(blockers).sort(), warnings: unique(warnings).sort(),
  })
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
  const text = await response.text(); let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 1200)}`)
  return body
}
async function login(baseUrl, email, password) {
  const body = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
  const token = val(body?.token); if (!token) throw new Error('Payload login response did not include a token'); return token
}
async function readCollection(baseUrl, token, collection, { draft = false } = {}) {
  const rows = []; let page = 1
  while (true) {
    const params = new URLSearchParams({ depth: '0', limit: '200', page: String(page), sort: 'id' }); if (draft) params.set('draft', 'true')
    const body = await requestJson(`${baseUrl}/api/${collection}?${params}`, { headers: { authorization: `JWT ${token}` } })
    const docs = list(body?.docs); rows.push(...docs); if (!body?.hasNextPage || docs.length === 0) break; page += 1
  }
  return rows
}
async function readWork(baseUrl, token, id, { draft = false } = {}) {
  const params = new URLSearchParams({ depth: '0' }); if (draft) params.set('draft', 'true')
  return requestJson(`${baseUrl}/api/works/${encodeURIComponent(id)}?${params}`, { headers: { authorization: `JWT ${token}` } })
}
async function readVersions(baseUrl, token, id) {
  const rows = []; let page = 1
  while (true) {
    const params = new URLSearchParams({ depth: '0', limit: '100', page: String(page), sort: '-createdAt', 'where[parent][equals]': id })
    const body = await requestJson(`${baseUrl}/api/works/versions?${params}`, { headers: { authorization: `JWT ${token}` } })
    const docs = list(body?.docs).filter((row) => parentId(row) === id); rows.push(...docs); if (!body?.hasNextPage || docs.length === 0) break; page += 1
  }
  return rows
}
async function restoreVersion(baseUrl, token, versionId) { return requestJson(`${baseUrl}/api/works/versions/${encodeURIComponent(versionId)}?depth=0`, { method: 'POST', headers: { authorization: `JWT ${token}` }, body: '{}' }) }
async function publishPatch(baseUrl, token, id, patch) { return requestJson(`${baseUrl}/api/works/${encodeURIComponent(id)}?draft=false&depth=0`, { method: 'PATCH', headers: { authorization: `JWT ${token}` }, body: JSON.stringify(patch) }) }
async function upsertResearch(baseUrl, token, existing, body) {
  if (!body) return { action: 'none' }
  if (existing && equal(normalizePayloadValue(existing), normalizePayloadValue({ ...existing, ...body }))) return { action: 'unchanged', id: existing.id }
  if (existing) {
    const result = await requestJson(`${baseUrl}/api/radar-research-records/${encodeURIComponent(existing.id)}?depth=0`, { method: 'PATCH', headers: { authorization: `JWT ${token}` }, body: JSON.stringify(body) })
    return { action: 'updated', id: result?.doc?.id || result?.id || existing.id }
  }
  const result = await requestJson(`${baseUrl}/api/radar-research-records?depth=0`, { method: 'POST', headers: { authorization: `JWT ${token}` }, body: JSON.stringify(body) })
  return { action: 'created', id: result?.doc?.id || result?.id || null }
}
function validatePackage(packageDir) {
  const manifestFile = path.join(packageDir, 'package-manifest.json'); const summaryFile = path.join(packageDir, 'summary/full-coverage-summary-v01.json'); const validationFile = path.join(packageDir, 'validation/package-validation-v01.json')
  for (const file of [manifestFile, summaryFile, validationFile]) if (!fs.existsSync(file)) throw new Error(`Package file missing: ${file}`)
  const manifest = readJson(manifestFile); const summary = readJson(summaryFile); const validation = readJson(validationFile)
  if (val(manifest?.packageId) !== PACKAGE_ID) throw new Error('Package ID mismatch')
  if (Number(manifest?.rows) !== 8183 || Number(manifest?.fixedRows) !== 265 || Number(manifest?.boundedRows) !== 7918) throw new Error('Package fixed/bounded counts mismatch')
  if (validation?.complete !== true || Number(validation?.scannedWithoutValidConclusionRows) !== 0) throw new Error('Package validation did not pass')
  const allFile = path.join(packageDir, val(manifest?.allFile)); if (!fs.existsSync(allFile)) throw new Error(`Package all-file missing: ${allFile}`)
  const actual = crypto.createHash('sha256').update(fs.readFileSync(allFile)).digest('hex'); if (actual !== val(manifest?.allFileSha256)) throw new Error('Package all-file SHA-256 mismatch')
  const rows = readJsonl(allFile); if (rows.length !== 8183) throw new Error(`Expected 8,183 package rows, found ${rows.length}`)
  if (new Set(rows.map((row) => `${val(row?.workId)}|${val(row?.siteId)}`)).size !== 8183) throw new Error('Package identities are not unique')
  return { manifest, rows, summary, validation, files: { manifestFile, allFile } }
}
function validateLoopback(baseUrl) { const url = new URL(baseUrl); if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('Publication runner requires a loopback Payload URL') }
function gitOutput(args) { return execFileSync('git', args, { encoding: 'utf8' }).trim() }
function validateExecutionEnvironment(args, proof) {
  const blockers = []; if (gitOutput(['branch', '--show-current']) !== 'main') blockers.push('execution_requires_main_branch')
  const head = gitOutput(['rev-parse', 'HEAD']); if (val(proof?.gitCommit) !== head) blockers.push('backup_proof_git_commit_mismatch')
  if (val(args?.confirmation) !== CONFIRMATION) blockers.push('exact_confirmation_missing')
  if (val(proof?.version) !== 'ai-radar-full-coverage-backup-proof-v0.1') blockers.push('backup_proof_version_mismatch')
  const generatedAt = Date.parse(val(proof?.generatedAt)); if (!Number.isFinite(generatedAt) || Date.now() - generatedAt > 3600000 || generatedAt > Date.now() + 60000) blockers.push('backup_proof_expired_or_invalid')
  const dumpFile = val(proof?.dumpFile); if (!dumpFile || !fs.existsSync(dumpFile)) blockers.push('backup_dump_missing')
  else { const actual = crypto.createHash('sha256').update(fs.readFileSync(dumpFile)).digest('hex'); if (actual !== val(proof?.dumpSha256).toLowerCase()) blockers.push('backup_dump_sha256_mismatch') }
  if (Number(proof?.dumpBytes) <= 0) blockers.push('backup_dump_empty')
  if (blockers.length) throw new Error(`Execution environment blocked: ${blockers.join(', ')}`)
}
function planSummary(planRows, packageRows, publishedWorks, latestDraftWorks, researchRecords) {
  return { generatedAt: new Date().toISOString(), version: VERSION, packageId: PACKAGE_ID, packageRows: packageRows.length, publishedWorksRead: publishedWorks.length, latestDraftWorksRead: latestDraftWorks.length, researchRecordsRead: researchRecords.length, planRows: planRows.length,
    byStatus: countBy(planRows.map((row) => row.planStatus)), byStrategy: countBy(planRows.map((row) => row.strategy)), byCandidateSource: countBy(planRows.map((row) => row?.selectedCandidate?.source)), byCandidateMode: countBy(planRows.map((row) => row?.selectedCandidate?.mode)),
    packageResearchRecordsPlanned: planRows.filter((row) => row.researchRecord).length, humanTrackRows: planRows.filter((row) => row.humanTrackRecorded).length, humanTrackPatchFields: planRows.filter((row) => row.patch && 'humanAssessment' in row.patch).length, wholeDraftPublicationRows: 0, blockedReasons: countBy(planRows.flatMap((row) => row.blockers)),
    safety: { payloadRead: true, payloadWrite: false, directPostgresqlWrite: false, humanAssessmentMutation: false, wholeDraftPublication: false } }
}
async function buildPlan({ baseUrl, token, packageRows }) {
  const [publishedWorks, latestDraftWorks, researchRecords] = await Promise.all([readCollection(baseUrl, token, 'works'), readCollection(baseUrl, token, 'works', { draft: true }), readCollection(baseUrl, token, 'radar-research-records')])
  const publishedMaps = workMap(publishedWorks); const draftMaps = workMap(latestDraftWorks); const packageByTarget = new Map(); const planRows = []
  for (const packageRow of packageRows) {
    const resolved = resolvePackageTarget(packageRow, publishedMaps, draftMaps)
    const row = buildPlanRow({ packageRow, published: resolved.published, latestDraft: resolved.latestDraft, sourceKind: 'wave5_package' })
    row.blockers = unique([...row.blockers, ...resolved.blockers]).sort(); if (row.blockers.length) { row.planStatus = 'blocked'; row.strategy = 'blocked' }
    planRows.push(canonical(row)); if (row.targetId) packageByTarget.set(row.targetId, packageRow)
  }
  for (const latestDraft of latestDraftWorks) {
    const id = val(latestDraft?.id); if (!id || packageByTarget.has(id)) continue
    const published = publishedMaps.byId.get(id) || null; if (classifyConclusion(latestDraft).mode === 'none') continue
    planRows.push(buildPlanRow({ packageRow: null, published, latestDraft, sourceKind: 'existing_latest_draft' }))
  }
  planRows.sort((a, b) => Number(a.targetId) - Number(b.targetId) || a.targetId.localeCompare(b.targetId))
  return { planRows, publishedWorks, latestDraftWorks, researchRecords, summary: planSummary(planRows, packageRows, publishedWorks, latestDraftWorks, researchRecords) }
}
async function executeDirect({ baseUrl, token, row, publishedBefore }) {
  const humanBefore = sha256(selectedHumanState(publishedBefore)); const unrelatedBefore = sha256(unrelatedPublishedState(publishedBefore, row.patch))
  await publishPatch(baseUrl, token, row.targetId, row.patch); const publishedAfter = await readWork(baseUrl, token, row.targetId); const blockers = []
  if (!patchMatches(publishedAfter, row.patch)) blockers.push('direct_patch_not_present')
  if (sha256(selectedHumanState(publishedAfter)) !== humanBefore) blockers.push('direct_human_state_changed')
  if (sha256(unrelatedPublishedState(publishedAfter, row.patch)) !== unrelatedBefore) blockers.push('direct_unrelated_state_changed')
  if (blockers.length) throw new Error(`Direct publication verification failed: ${blockers.join(', ')}`)
  return { writes: 1, strategy: 'direct_field_publish' }
}
async function executeRoundtrip({ baseUrl, token, row, publishedBefore, draftBefore }) {
  const versions = await readVersions(baseUrl, token, row.targetId); const publishedVersion = matchingPublishedVersions(versions, publishedBefore)[0] || null; const draftVersion = matchingExactVersions(versions, draftBefore)[0] || null
  if (!publishedVersion?.id) throw new Error('matching_published_baseline_version_missing'); if (!draftVersion?.id) throw new Error('matching_original_draft_version_missing')
  const publishedHumanBefore = sha256(selectedHumanState(publishedBefore)); const publishedUnrelatedBefore = sha256(unrelatedPublishedState(publishedBefore, row.patch)); const draftStateBefore = sha256(normalizedDocumentState(draftBefore)); let writes = 0
  try {
    await restoreVersion(baseUrl, token, publishedVersion.id); writes += 1
    const cleanPublished = await readWork(baseUrl, token, row.targetId); const cleanDraft = await readWork(baseUrl, token, row.targetId, { draft: true })
    if (sha256(unrelatedPublishedState(cleanPublished, row.patch)) !== publishedUnrelatedBefore) throw new Error('clean_restore_changed_unrelated_published_state')
    if (sha256(selectedHumanState(cleanPublished)) !== publishedHumanBefore) throw new Error('clean_restore_changed_human_state')
    if (!equal(normalizeIgnoringRootStatus(cleanDraft), normalizeIgnoringRootStatus(publishedBefore))) throw new Error('clean_restore_draft_not_equal_published_baseline')
    await publishPatch(baseUrl, token, row.targetId, row.patch); writes += 1
    const afterPublish = await readWork(baseUrl, token, row.targetId)
    if (!patchMatches(afterPublish, row.patch)) throw new Error('roundtrip_patch_not_published')
    if (sha256(unrelatedPublishedState(afterPublish, row.patch)) !== publishedUnrelatedBefore) throw new Error('roundtrip_changed_unrelated_published_state')
    if (sha256(selectedHumanState(afterPublish)) !== publishedHumanBefore) throw new Error('roundtrip_changed_human_state')
    await restoreVersion(baseUrl, token, draftVersion.id); writes += 1
    const finalPublished = await readWork(baseUrl, token, row.targetId); const finalDraft = await readWork(baseUrl, token, row.targetId, { draft: true })
    if (!patchMatches(finalPublished, row.patch)) throw new Error('roundtrip_final_published_lost_patch')
    if (sha256(unrelatedPublishedState(finalPublished, row.patch)) !== publishedUnrelatedBefore) throw new Error('roundtrip_final_unrelated_published_state_changed')
    if (sha256(selectedHumanState(finalPublished)) !== publishedHumanBefore) throw new Error('roundtrip_final_human_state_changed')
    if (sha256(normalizedDocumentState(finalDraft)) !== draftStateBefore) throw new Error('roundtrip_original_draft_not_restored')
    return { writes, strategy: 'version_roundtrip', versionsRead: versions.length }
  } catch (error) {
    if (draftVersion?.id) { try { await restoreVersion(baseUrl, token, draftVersion.id); writes += 1 } catch {} }
    const wrapped = new Error(`Roundtrip failed after ${writes} write requests: ${error?.message || error}`); wrapped.writeRequests = writes; throw wrapped
  }
}
function collectionsCounter() { const counts = {}; return { increment(key) { counts[key] = (counts[key] || 0) + 1 }, snapshot() { return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]))) } } }
async function executePlan({ baseUrl, token, planRows, researchRecords, ledgerFile, delayMs = 0, maxRows = Infinity }) {
  const existingResearch = new Map(researchRecords.map((row) => [val(row?.researchKey), row]).filter(([key]) => key)); const completed = new Map()
  if (fs.existsSync(ledgerFile)) for (const event of readJsonl(ledgerFile)) if (val(event?.status) === 'completed_verified') completed.set(`${val(event?.targetId)}|${val(event?.patchSha256)}`, event)
  const counters = collectionsCounter(); let processed = 0
  for (const row of planRows) {
    if (processed >= maxRows) break; const resumeKey = `${row.targetId}|${row.patchSha256}`
    if (completed.has(resumeKey)) { counters.increment('resume_skipped'); continue }
    if (row.planStatus === 'blocked') { appendJsonl(ledgerFile, { generatedAt: new Date().toISOString(), status: 'blocked', targetId: row.targetId, patchSha256: row.patchSha256, blockers: row.blockers }); counters.increment('blocked'); continue }
    processed += 1
    const event = { generatedAt: new Date().toISOString(), targetId: row.targetId, siteId: row.siteId, title: row.title, strategy: row.strategy, patchSha256: row.patchSha256, research: null, workPublication: null, status: 'started' }
    try {
      if (row.researchRecord) { const key = val(row.researchRecord?.researchKey); event.research = await upsertResearch(baseUrl, token, existingResearch.get(key), row.researchRecord); if (event.research?.id) existingResearch.set(key, { ...row.researchRecord, id: event.research.id }); counters.increment(`research_${event.research.action}`) }
      const publishedBefore = await readWork(baseUrl, token, row.targetId); const draftBefore = await readWork(baseUrl, token, row.targetId, { draft: true })
      if (val(publishedBefore?.catalogStatus) === 'archived' || val(draftBefore?.catalogStatus) === 'archived') throw new Error('runtime_catalog_archived')
      if (val(publishedBefore?.reviewStatus) === 'deprecated' || val(draftBefore?.reviewStatus) === 'deprecated') throw new Error('runtime_review_status_deprecated')
      if (row.patch && patchMatches(publishedBefore, row.patch) && val(publishedBefore?._status) === 'published') event.workPublication = { writes: 0, strategy: 'already_published' }
      else {
        if (sha256(normalizedDocumentState(publishedBefore)) !== val(row?.expectedBefore?.publishedStateSha256) || sha256(normalizedDocumentState(draftBefore)) !== val(row?.expectedBefore?.draftStateSha256)) throw new Error('runtime_state_changed_after_plan')
        const safeDirect = equal(unrelatedPublishedState(publishedBefore, row.patch), unrelatedPublishedState(draftBefore, row.patch))
        event.workPublication = safeDirect ? await executeDirect({ baseUrl, token, row, publishedBefore }) : await executeRoundtrip({ baseUrl, token, row, publishedBefore, draftBefore })
      }
      event.status = 'completed_verified'; counters.increment('completed_verified'); counters.increment(`publication_${event.workPublication.strategy}`); appendJsonl(ledgerFile, event)
    } catch (error) {
      event.status = 'execution_failed'; event.error = error?.stack || String(error); event.writeRequestsBeforeFailure = Number(error?.writeRequests || 0); appendJsonl(ledgerFile, event); counters.increment('execution_failed'); if (event.writeRequestsBeforeFailure > 0) throw error
    }
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  return counters.snapshot()
}

async function main() {
  const args = parseArgs(process.argv.slice(2)); const packageDir = path.resolve(val(args['package-dir']) || DEFAULT_PACKAGE_DIR); const baseUrl = val(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://127.0.0.1:3000').replace(/\/+$/u, ''); const outRoot = path.resolve(val(args['out-root']) || DEFAULT_OUT_ROOT); const execute = args.execute === true
  validateLoopback(baseUrl)
  const email = val(process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.SITE_OWNER_EMAIL); const password = val(process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD)
  if (!email || !password) throw new Error('Payload credentials are required in RADAR_PAYLOAD_EMAIL/RADAR_PAYLOAD_PASSWORD')
  const packageData = validatePackage(packageDir); const token = await login(baseUrl, email, password); const planned = await buildPlan({ baseUrl, token, packageRows: packageData.rows })
  const runId = `${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${process.pid}`; const outDir = path.join(outRoot, runId)
  const outputs = { plan: path.join(outDir, 'publication-plan.jsonl'), planSummary: path.join(outDir, 'publication-plan-summary.json'), executionLedger: path.join(outDir, 'execution-ledger.jsonl'), executionSummary: path.join(outDir, 'execution-summary.json') }
  writeJsonl(outputs.plan, planned.planRows); writeJson(outputs.planSummary, { ...planned.summary, packageFiles: packageData.files, outputs })
  if (!execute) { console.log(JSON.stringify({ ok: true, mode: 'plan', summary: planned.summary, outputs }, null, 2)); return }
  const proofFile = path.resolve(val(args['backup-proof'])); if (!proofFile || !fs.existsSync(proofFile)) throw new Error('Use --backup-proof <fresh-proof.json> for execution')
  const proof = readJson(proofFile); validateExecutionEnvironment(args, proof)
  const counters = await executePlan({ baseUrl, token, planRows: planned.planRows, researchRecords: planned.researchRecords, ledgerFile: outputs.executionLedger, delayMs: Math.max(0, Number(args['delay-ms'] || 25)), maxRows: args['max-rows'] ? Math.max(1, Number(args['max-rows'])) : Infinity })
  const finalPublished = await readCollection(baseUrl, token, 'works'); const finalDrafts = await readCollection(baseUrl, token, 'works', { draft: true })
  const finalSummary = { generatedAt: new Date().toISOString(), version: VERSION, mode: 'execute', counters, finalPublishedWorksRead: finalPublished.length, finalLatestDraftWorksRead: finalDrafts.length, finalPublishedWithAiConclusion: finalPublished.filter((work) => classifyConclusion(work).mode !== 'none').length, finalLatestDraftWithAiConclusion: finalDrafts.filter((work) => classifyConclusion(work).mode !== 'none').length, executionLedger: outputs.executionLedger, backupProof: proofFile,
    safety: { directPostgresqlWrite: false, humanAssessmentMutation: false, wholeDraftPublication: false, partialPayloadFieldPublication: true, versionRoundtripUsedWhenDraftUnrelatedFieldsDiffer: true } }
  writeJson(outputs.executionSummary, finalSummary); console.log(JSON.stringify({ ok: true, summary: finalSummary, outputs }, null, 2))
}
const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isDirectRun) main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1 })
