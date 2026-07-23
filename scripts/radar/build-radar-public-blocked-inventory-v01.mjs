#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'radar-public-blocked-inventory-v0.1'
const EXPECTED_AUDIT_ROWS = 10805
const EXPECTED_PUBLIC_BLOCKED = 1805
const EXPECTED_PRIVATE_BLOCKED = 1444
const EXPECTED_DRAFT_WORKS = 35615
const EXPECTED_PUBLISHED_WORKS = 35615
const EXPECTED_PUBLIC_CURRENT = 9000
const ALLOWED_GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F'])
const DECISIVE_FIELDS = new Set([
  'suggestedGrade',
  'decisiveRuleCode',
  'matchedRules',
  'contradictions',
  'workId',
  'publicationKey',
  'publicationGuard',
])
const IDENTITY_BLOCKER_PATTERNS = [
  /^ambiguous_/u,
  /^payload_id_site_id_identity_mismatch$/u,
  /^stable_identifier_not_found$/u,
  /^title_mismatch_on_single_identifier$/u,
  /^missing_target_work$/u,
  /^missing_published_snapshot$/u,
]
const LIFECYCLE_BLOCKER_PATTERNS = [
  /^catalog_status_/u,
  /^payload_status_/u,
  /^lite_hidden$/u,
  /^full_hidden$/u,
]
const TECHNICAL_BLOCKERS = new Set([
  'invalid_assessed_at',
  'timestamp_precision_not_storage_safe',
  'conclusion_hash_mismatch',
  'storage_representation_mismatch',
])

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

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function unique(values) { return [...new Set(list(values).map(val).filter(Boolean))] }
function canonical(value) {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonical)
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
    const item = canonical(value[key])
    return item === undefined ? [] : [[key, item]]
  }))
}
function hashValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
function readText(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`)
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
}
function readJson(file) { return JSON.parse(readText(file)) }
function readJsonl(file) {
  return readText(file).split(/\r?\n/u).filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line) } catch (error) { throw new Error(`Invalid JSONL ${file}:${index + 1}: ${error.message}`) }
  })
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}
function csvCell(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}
function writeCsv(file, rows) {
  const columns = [
    'workId', 'publicationKey', 'siteId', 'title', 'privateStatus', 'publicStatus',
    'privateBlockers', 'publicBlockers', 'resolutionLane', 'repairClass', 'nextAction',
    'humanGrade', 'humanStatus', 'selectedCandidateSource', 'selectedCandidateAssessedAt',
    'selectedCandidateGrade', 'selectedCandidateStatus', 'evidenceCount', 'historyCount',
    'conflictCount', 'decisiveConflictCount', 'liveCatalogStatus', 'liveLiteVisible',
    'liveFullVisible', 'sourceAuditRowSha256',
  ]
  const lines = [columns.map(csvCell).join(',')]
  for (const row of rows) {
    const flat = {
      workId: row.workId,
      publicationKey: row.publicationKey,
      siteId: row.siteId,
      title: row.title,
      privateStatus: row.privateStatus,
      publicStatus: row.publicStatus,
      privateBlockers: row.privateBlockers,
      publicBlockers: row.publicBlockers,
      resolutionLane: row.resolutionLane,
      repairClass: row.repairClass,
      nextAction: row.nextAction,
      humanGrade: row.humanTrack?.grade,
      humanStatus: row.humanTrack?.status,
      selectedCandidateSource: row.selectedCandidate?.source,
      selectedCandidateAssessedAt: row.selectedCandidate?.assessedAt,
      selectedCandidateGrade: row.selectedCandidate?.grade,
      selectedCandidateStatus: row.selectedCandidateStatus,
      evidenceCount: row.evidenceCount,
      historyCount: row.history.length,
      conflictCount: row.conflicts.length,
      decisiveConflictCount: row.conflicts.filter((item) => item.decisive).length,
      liveCatalogStatus: row.liveSnapshot?.catalogStatus,
      liveLiteVisible: row.liveSnapshot?.isLiteVisible,
      liveFullVisible: row.liveSnapshot?.isFullVisible,
      sourceAuditRowSha256: row.sourceAuditRowSha256,
    }
    lines.push(columns.map((column) => csvCell(flat[column])).join(','))
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
}
function countBy(rows, getter) {
  const counts = {}
  for (const row of rows) {
    const key = val(getter(row)) || 'missing'
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 1200)}`)
  return body
}
async function login(baseUrl) {
  const email = process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) throw new Error('Missing Payload audit credentials.')
  const body = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!body?.token) throw new Error('Payload login did not return a token.')
  return body.token
}
async function fetchCollection(baseUrl, token, slug, extra = {}) {
  const docs = []
  let page = 1
  let totalPages = 1
  do {
    const params = new URLSearchParams({ limit: '200', page: String(page), depth: '0', ...extra })
    const body = await requestJson(`${baseUrl}/api/${slug}?${params}`, {
      headers: { Authorization: `JWT ${token}` },
    })
    docs.push(...list(body?.docs))
    totalPages = Number(body?.totalPages || 1)
    page += 1
  } while (page <= totalPages)
  return docs
}

function relationId(value) { return val(typeof value === 'object' ? value?.id : value) }
function instant(value) {
  const text = val(value)
  const millis = Date.parse(text)
  return Number.isFinite(millis) ? { text: new Date(millis).toISOString(), millis, valid: true } : { text, millis: Number.NEGATIVE_INFINITY, valid: false }
}
function normalizeRuleRows(value) {
  return list(value).map((item) => canonical({
    code: val(item?.code),
    grade: val(item?.grade),
    confidencePercent: Number(item?.confidencePercent ?? 0),
    reason: val(item?.reason),
  }))
}
function normalizeContradictions(value) {
  return list(value).map((item) => val(typeof item === 'string' ? item : item?.value)).filter(Boolean)
}
function radarSnapshot(value) {
  if (!value || typeof value !== 'object') return null
  return canonical({
    confidencePercent: Number(value.confidencePercent ?? 0),
    evidenceCoveragePercent: Number(value.evidenceCoveragePercent ?? 0),
    evidenceStatus: val(value.evidenceStatus),
    sourceSummary: val(value.sourceSummary),
    policyVersion: val(value.policyVersion),
    assessedAt: val(value.assessedAt),
    assessmentBatch: val(value.assessmentBatch),
    suggestedGrade: val(value.suggestedGrade),
    decisiveRuleCode: val(value.decisiveRuleCode),
    decisiveRuleReason: val(value.decisiveRuleReason),
    matchedRules: normalizeRuleRows(value.matchedRules),
    sourceCount: Number(value.sourceCount ?? 0),
    contradictions: normalizeContradictions(value.contradictions),
    requiresHumanReview: value.requiresHumanReview !== false,
  })
}
function candidateFrom({ source, radar, grade = '', workId = '', publicationKey = '', conclusionSha256 = '', metadata = {} }) {
  const snapshot = radarSnapshot(radar)
  if (!snapshot) return null
  const time = instant(snapshot.assessedAt)
  const normalizedGrade = val(grade || snapshot.suggestedGrade)
  const content = canonical({
    source,
    workId: val(workId),
    publicationKey: val(publicationKey),
    grade: normalizedGrade,
    radarAssessment: snapshot,
    metadata,
  })
  return canonical({
    source,
    workId: val(workId),
    publicationKey: val(publicationKey),
    grade: normalizedGrade,
    assessedAt: time.text,
    assessedAtValid: time.valid,
    assessedAtMillis: time.millis,
    policyVersion: snapshot.policyVersion,
    assessmentBatch: snapshot.assessmentBatch,
    evidenceCount: Math.max(0, Number(snapshot.sourceCount || 0)),
    candidateSha256: hashValue(content),
    conclusionSha256: val(conclusionSha256),
    snapshot,
    metadata,
  })
}
function candidateValidity(candidate, { discarded, identityResolved }) {
  const reasons = []
  if (!candidate) reasons.push('missing_candidate')
  else {
    if (!identityResolved) reasons.push('identity_not_resolved')
    if (discarded) reasons.push('discarded_test_assessment')
    if (!candidate.assessedAtValid) reasons.push('invalid_assessed_at')
    if (!candidate.policyVersion) reasons.push('missing_policy_version')
    if (!candidate.assessmentBatch) reasons.push('missing_assessment_batch')
    if (!ALLOWED_GRADES.has(candidate.grade)) reasons.push('invalid_grade')
    if (!candidate.snapshot?.decisiveRuleCode) reasons.push('missing_decisive_rule')
  }
  return { valid: reasons.length === 0, reasons }
}
function compareCandidates(older, newer) {
  if (!older || !newer) return []
  const fields = [
    ['suggestedGrade', older.grade, newer.grade],
    ['decisiveRuleCode', older.snapshot?.decisiveRuleCode, newer.snapshot?.decisiveRuleCode],
    ['matchedRules', older.snapshot?.matchedRules, newer.snapshot?.matchedRules],
    ['contradictions', older.snapshot?.contradictions, newer.snapshot?.contradictions],
    ['evidenceStatus', older.snapshot?.evidenceStatus, newer.snapshot?.evidenceStatus],
    ['sourceSummary', older.snapshot?.sourceSummary, newer.snapshot?.sourceSummary],
    ['sourceCount', older.snapshot?.sourceCount, newer.snapshot?.sourceCount],
    ['confidencePercent', older.snapshot?.confidencePercent, newer.snapshot?.confidencePercent],
    ['evidenceCoveragePercent', older.snapshot?.evidenceCoveragePercent, newer.snapshot?.evidenceCoveragePercent],
    ['policyVersion', older.snapshot?.policyVersion, newer.snapshot?.policyVersion],
  ]
  return fields.flatMap(([field, before, after]) => {
    if (JSON.stringify(canonical(before)) === JSON.stringify(canonical(after))) return []
    return [canonical({
      field,
      decisive: DECISIVE_FIELDS.has(field),
      olderSource: older.source,
      newerSource: newer.source,
      olderAssessedAt: older.assessedAt,
      newerAssessedAt: newer.assessedAt,
      olderValue: before,
      newerValue: after,
    })]
  })
}
function matchesAny(value, patterns) { return patterns.some((pattern) => pattern.test(value)) }
function resolutionFor({ privateBlockers, publicBlockers, decisiveConflictCount, discarded }) {
  const blockers = unique([...privateBlockers, ...publicBlockers])
  if (discarded) return {
    lane: 'fresh_research',
    repairClass: 'B_research_regeneration',
    nextAction: '从零建立新 batch、来源、evidence、assessedAt 与 hash；禁止 remap 旧测试结论。',
  }
  if (blockers.some((item) => matchesAny(item, IDENTITY_BLOCKER_PATTERNS))) return {
    lane: 'identity_review',
    repairClass: 'C_human_adjudication',
    nextAction: '核对 canonical Work、siteId、标题别名与重复组；身份未确定前保持 blocked。',
  }
  if (decisiveConflictCount > 0 || blockers.some((item) => item.startsWith('contradiction:'))) return {
    lane: 'decisive_conflict_review',
    repairClass: 'C_human_adjudication',
    nextAction: '保留冲突双方，补充来源或人工裁决 grade、decisive rule、身份或 guard。',
  }
  if (blockers.includes('missing_source_summary') || blockers.includes('multiple_secondary_requires_two_traceable_sources')) return {
    lane: 'evidence_research',
    repairClass: 'B_research_regeneration',
    nextAction: '补齐可追溯来源和人类可读 sourceSummary，再重新计算完整研究快照。',
  }
  if (blockers.includes('publication_guard')) return {
    lane: 'publication_guard_review',
    repairClass: 'C_human_adjudication',
    nextAction: '逐条确认身份、证据、live snapshot、生命周期与可见性后决定是否解除 guard。',
  }
  if (blockers.some((item) => matchesAny(item, LIFECYCLE_BLOCKER_PATTERNS))) return {
    lane: 'public_lifecycle_retained',
    repairClass: 'D_retained_blocked',
    nextAction: '保留私有研究历史；仅在 catalogStatus、live snapshot 或 visibility 合法变化后重新审计。',
  }
  if (blockers.length > 0 && blockers.every((item) => TECHNICAL_BLOCKERS.has(item))) return {
    lane: 'automatic_storage_repair',
    repairClass: 'A_automatic_format_repair',
    nextAction: '统一修复时间精度、hash 和物理存储表示后重新验证。',
  }
  return {
    lane: 'general_research_review',
    repairClass: 'B_research_regeneration',
    nextAction: '保留全部历史和 blocker，补齐缺失研究字段后重新分类。',
  }
}
function humanTrack(work) {
  const value = work?.humanAssessment || {}
  return canonical({
    grade: val(value.grade),
    status: val(value.status),
    confidencePercent: Number(value.confidencePercent ?? 0),
    assessedAt: val(value.assessedAt),
    assessor: val(value.assessor),
    recorded: Boolean(val(value.grade) || (val(value.status) && val(value.status) !== 'pending')),
  })
}
function publicSnapshot(work) {
  if (!work) return null
  return canonical({
    id: val(work.id),
    siteId: val(work.siteId),
    title: val(work.title),
    catalogStatus: val(work.catalogStatus),
    isLiteVisible: work.isLiteVisible !== false,
    isFullVisible: work.isFullVisible !== false,
    payloadStatus: val(work._status),
    updatedAt: val(work.updatedAt),
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  for (const key of ['audit-dir', 'production-receipt-dir', 'out-dir', 'url']) {
    if (!val(args[key])) throw new Error(`Required: --${key}`)
  }
  if (args.execute || args.apply || args.write || args.patch || args.confirm || args['approval-token']) {
    throw new Error('Blocked inventory is read-only. Execute/apply/write flags are rejected.')
  }

  const auditDir = path.resolve(args['audit-dir'])
  const receiptDir = path.resolve(args['production-receipt-dir'])
  const outDir = path.resolve(args['out-dir'])
  const baseUrl = val(args.url).replace(/\/+$/u, '')
  const auditSummaryPath = path.join(auditDir, 'all-remaining-radar-global-audit-summary.json')
  const auditAllPath = path.join(auditDir, 'all-remaining-radar-global-audit.jsonl')
  const blockedPath = path.join(auditDir, 'public-ai-blocked.jsonl')
  const receiptPath = path.join(receiptDir, 'production-apply-receipt.json')
  const auditSummary = readJson(auditSummaryPath)
  const auditAll = readJsonl(auditAllPath)
  const blockedRows = readJsonl(blockedPath)
  const receipt = readJson(receiptPath)

  const globalBlockers = []
  if (auditAll.length !== EXPECTED_AUDIT_ROWS) globalBlockers.push(`audit_rows_expected_${EXPECTED_AUDIT_ROWS}_received_${auditAll.length}`)
  if (blockedRows.length !== EXPECTED_PUBLIC_BLOCKED) globalBlockers.push(`public_blocked_expected_${EXPECTED_PUBLIC_BLOCKED}_received_${blockedRows.length}`)
  if (Number(auditSummary.publicTrack?.blocked) !== EXPECTED_PUBLIC_BLOCKED) globalBlockers.push('audit_summary_public_blocked_mismatch')
  if (Number(auditSummary.privateTrack?.blocked) !== EXPECTED_PRIVATE_BLOCKED) globalBlockers.push('audit_summary_private_blocked_mismatch')
  if (receipt.productionPublicRowsWritten !== EXPECTED_PUBLIC_CURRENT || receipt.productionAcceptancePassed !== true || receipt.productionTableDeltasMatched !== true) {
    globalBlockers.push('production_receipt_not_verified')
  }
  const allBlockedHashes = new Set(auditAll.filter((row) => val(row.publicStatus).startsWith('blocked_')).map(hashValue))
  for (const row of blockedRows) {
    if (!allBlockedHashes.has(hashValue(row))) globalBlockers.push(`blocked_row_not_in_full_audit:${val(row.sourceWorkId)}`)
  }

  const token = await login(baseUrl)
  const [draftWorks, publishedWorks, publicConclusions] = await Promise.all([
    fetchCollection(baseUrl, token, 'works', { draft: 'true' }),
    fetchCollection(baseUrl, token, 'works', { draft: 'false' }),
    fetchCollection(baseUrl, token, 'radar-public-conclusions'),
  ])
  if (draftWorks.length !== EXPECTED_DRAFT_WORKS) globalBlockers.push(`draft_works_expected_${EXPECTED_DRAFT_WORKS}_received_${draftWorks.length}`)
  if (publishedWorks.length !== EXPECTED_PUBLISHED_WORKS) globalBlockers.push(`published_works_expected_${EXPECTED_PUBLISHED_WORKS}_received_${publishedWorks.length}`)
  const currentPublic = publicConclusions.filter((row) => val(row.recordStatus) === 'current')
  if (currentPublic.length !== EXPECTED_PUBLIC_CURRENT) globalBlockers.push(`current_public_expected_${EXPECTED_PUBLIC_CURRENT}_received_${currentPublic.length}`)

  const draftById = new Map(draftWorks.map((work) => [val(work.id), work]))
  const publishedById = new Map(publishedWorks.map((work) => [val(work.id), work]))
  const publicByKey = new Map()
  const duplicatePublicKeys = []
  for (const row of currentPublic) {
    const key = val(row.publicationKey)
    if (publicByKey.has(key)) duplicatePublicKeys.push(key)
    else publicByKey.set(key, row)
  }
  if (duplicatePublicKeys.length) globalBlockers.push(`duplicate_current_public_keys:${unique(duplicatePublicKeys).slice(0, 20).join(',')}`)

  const inventory = []
  for (const row of blockedRows) {
    const sourceWorkId = val(row.sourceWorkId)
    const targetWorkId = val(row.target?.id || sourceWorkId)
    const publicationKey = `work:${targetWorkId}`
    const draftWork = draftById.get(targetWorkId) || draftById.get(sourceWorkId) || null
    const liveWork = publishedById.get(targetWorkId) || publishedById.get(sourceWorkId) || null
    const currentPublicRow = publicByKey.get(publicationKey) || null
    const privateBlockers = unique(row.privateBlockers || row.privatePlan?.blockers || row.blockers)
    const publicBlockers = unique(row.publicBlockers || row.blockers)
    const discarded = val(row.publicStatus) === 'blocked_discarded_test_assessment'
    const identityResolved = Boolean(row.target?.id && draftById.has(val(row.target.id))) && !privateBlockers.some((item) => matchesAny(item, IDENTITY_BLOCKER_PATTERNS))

    const auditRadar = row.privatePlan?.patch?.radarAssessment || row.privatePlan?.expectedBefore?.radarAssessment || null
    const candidates = [
      candidateFrom({
        source: 'accepted_audit_candidate',
        radar: auditRadar,
        grade: row.grade,
        workId: targetWorkId,
        publicationKey,
        metadata: {
          assessmentBatch: val(row.assessmentBatch),
          policyVersion: val(row.policyVersion),
          auditPublicStatus: val(row.publicStatus),
          auditPrivateStatus: val(row.privateStatus),
          auditRowSha256: hashValue(row),
        },
      }),
      candidateFrom({
        source: 'production_private_current',
        radar: draftWork?.radarAssessment,
        grade: draftWork?.radarAssessment?.suggestedGrade,
        workId: targetWorkId,
        publicationKey,
        metadata: {
          workUpdatedAt: val(draftWork?.updatedAt),
          reviewStatus: val(draftWork?.reviewStatus),
          ratingNotice: val(draftWork?.ratingNotice),
        },
      }),
      candidateFrom({
        source: 'production_public_current',
        radar: currentPublicRow?.radarAssessment,
        grade: currentPublicRow?.compatibilityGrade,
        workId: relationId(currentPublicRow?.work) || targetWorkId,
        publicationKey: val(currentPublicRow?.publicationKey || publicationKey),
        conclusionSha256: currentPublicRow?.conclusionSha256,
        metadata: {
          publicRecordId: val(currentPublicRow?.id),
          publicationVersion: val(currentPublicRow?.publicationVersion),
          recordStatus: val(currentPublicRow?.recordStatus),
        },
      }),
    ].filter(Boolean)

    const history = candidates.map((candidate) => {
      const validity = candidateValidity(candidate, { discarded, identityResolved })
      return canonical({ ...candidate, structurallyValid: validity.valid, invalidReasons: validity.reasons })
    }).sort((a, b) => a.assessedAtMillis - b.assessedAtMillis || a.source.localeCompare(b.source))
    const structurallyValid = history.filter((candidate) => candidate.structurallyValid)
    const selectedCandidate = structurallyValid.at(-1) || history.at(-1) || null
    const selectedCandidateStatus = !selectedCandidate
      ? 'missing_candidate'
      : structurallyValid.length
        ? (privateBlockers.length || publicBlockers.length ? 'latest_valid_but_blocked' : 'latest_valid')
        : 'latest_available_invalid'
    const conflicts = []
    for (let index = 1; index < history.length; index += 1) {
      conflicts.push(...compareCandidates(history[index - 1], history[index]))
    }
    const decisiveConflictCount = conflicts.filter((item) => item.decisive).length
    const resolution = resolutionFor({ privateBlockers, publicBlockers, decisiveConflictCount, discarded })
    const evidenceCount = Math.max(0, ...history.map((candidate) => Number(candidate.evidenceCount || 0)))

    inventory.push(canonical({
      schemaVersion: 1,
      inventoryVersion: VERSION,
      workId: targetWorkId,
      sourceWorkId,
      publicationKey,
      siteId: val(row.siteId || draftWork?.siteId || liveWork?.siteId),
      title: val(liveWork?.title || draftWork?.title || row.title),
      privateStatus: val(row.privateStatus),
      publicStatus: val(row.publicStatus),
      privateBlockers,
      publicBlockers,
      warnings: unique(row.warnings || row.privatePlan?.warnings),
      needsPublicationGuard: row.needsPublicationGuard === true,
      humanTrack: humanTrack(draftWork),
      latestDraftSnapshot: publicSnapshot(draftWork),
      liveSnapshot: publicSnapshot(liveWork),
      currentPublicRecord: currentPublicRow ? canonical({
        id: val(currentPublicRow.id),
        publicationKey: val(currentPublicRow.publicationKey),
        conclusionSha256: val(currentPublicRow.conclusionSha256),
        compatibilityGrade: val(currentPublicRow.compatibilityGrade),
        assessedAt: val(currentPublicRow.radarAssessment?.assessedAt),
      }) : null,
      identityResolved,
      discardedTestAssessment: discarded,
      selectedCandidate,
      selectedCandidateStatus,
      evidenceCount,
      history,
      conflicts,
      supersessionCandidates: history.slice(1).map((candidate, index) => canonical({
        olderCandidateSha256: history[index].candidateSha256,
        newerCandidateSha256: candidate.candidateSha256,
        action: conflicts.some((item) => item.decisive && item.olderSource === history[index].source && item.newerSource === candidate.source)
          ? 'retain_both_blocked_pending_resolution'
          : 'newer_valid_candidate_may_supersede_after_resolution',
      })),
      resolutionLane: resolution.lane,
      repairClass: resolution.repairClass,
      nextAction: resolution.nextAction,
      sourceAuditRowSha256: hashValue(row),
      sourceAuditRow: row,
    }))
  }

  const duplicateInventoryWorkIds = inventory.map((row) => row.workId).filter((id, index, values) => id && values.indexOf(id) !== index)
  if (duplicateInventoryWorkIds.length) globalBlockers.push(`duplicate_inventory_work_ids:${unique(duplicateInventoryWorkIds).slice(0, 20).join(',')}`)
  if (inventory.length !== EXPECTED_PUBLIC_BLOCKED) globalBlockers.push('inventory_cardinality_mismatch')

  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  const outputs = {
    inventory: path.join(outDir, 'radar-public-blocked-inventory.jsonl'),
    inventoryCsv: path.join(outDir, 'radar-public-blocked-inventory.csv'),
    conflictLedger: path.join(outDir, 'radar-public-blocked-conflict-ledger.jsonl'),
    automatic: path.join(outDir, 'radar-public-blocked-lane-automatic-storage-repair.jsonl'),
    research: path.join(outDir, 'radar-public-blocked-lane-research.jsonl'),
    human: path.join(outDir, 'radar-public-blocked-lane-human-review.jsonl'),
    retained: path.join(outDir, 'radar-public-blocked-lane-retained.jsonl'),
    summary: path.join(outDir, 'radar-public-blocked-inventory-summary.json'),
  }
  writeJsonl(outputs.inventory, inventory)
  writeCsv(outputs.inventoryCsv, inventory)
  writeJsonl(outputs.conflictLedger, inventory.filter((row) => row.conflicts.length).map((row) => canonical({
    workId: row.workId,
    publicationKey: row.publicationKey,
    title: row.title,
    selectedCandidate: row.selectedCandidate,
    conflicts: row.conflicts,
    nextAction: row.nextAction,
  })))
  writeJsonl(outputs.automatic, inventory.filter((row) => row.repairClass === 'A_automatic_format_repair'))
  writeJsonl(outputs.research, inventory.filter((row) => row.repairClass === 'B_research_regeneration'))
  writeJsonl(outputs.human, inventory.filter((row) => row.repairClass === 'C_human_adjudication'))
  writeJsonl(outputs.retained, inventory.filter((row) => row.repairClass === 'D_retained_blocked'))

  const summary = canonical({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version: VERSION,
    sourceAudit: {
      directory: auditDir,
      summarySha256: sha256File(auditSummaryPath),
      allRowsSha256: sha256File(auditAllPath),
      blockedRowsSha256: sha256File(blockedPath),
      rows: auditAll.length,
      publicBlocked: blockedRows.length,
      privateBlocked: Number(auditSummary.privateTrack?.blocked),
    },
    productionReceipt: {
      directory: receiptDir,
      receiptSha256: sha256File(receiptPath),
      executionId: val(receipt.executionId),
      publicRowsWritten: Number(receipt.productionPublicRowsWritten),
      acceptancePassed: receipt.productionAcceptancePassed === true,
    },
    currentProduction: {
      draftWorksRead: draftWorks.length,
      publishedWorksRead: publishedWorks.length,
      publicConclusionsRead: publicConclusions.length,
      currentPublicConclusionsRead: currentPublic.length,
      uniqueCurrentPublicationKeys: publicByKey.size,
    },
    inventory: {
      rows: inventory.length,
      uniqueWorkIds: new Set(inventory.map((row) => row.workId)).size,
      withHistory: inventory.filter((row) => row.history.length > 0).length,
      withConflicts: inventory.filter((row) => row.conflicts.length > 0).length,
      withDecisiveConflicts: inventory.filter((row) => row.conflicts.some((item) => item.decisive)).length,
      withHumanTrack: inventory.filter((row) => row.humanTrack?.recorded).length,
      selectedLatestValidButBlocked: inventory.filter((row) => row.selectedCandidateStatus === 'latest_valid_but_blocked').length,
      selectedLatestAvailableInvalid: inventory.filter((row) => row.selectedCandidateStatus === 'latest_available_invalid').length,
      missingCandidate: inventory.filter((row) => row.selectedCandidateStatus === 'missing_candidate').length,
      byPrivateBlocker: countBy(inventory.flatMap((row) => row.privateBlockers), (item) => item),
      byPublicBlocker: countBy(inventory.flatMap((row) => row.publicBlockers), (item) => item),
      byResolutionLane: countBy(inventory, (row) => row.resolutionLane),
      byRepairClass: countBy(inventory, (row) => row.repairClass),
      bySelectedCandidateSource: countBy(inventory, (row) => row.selectedCandidate?.source),
      byLiveCatalogStatus: countBy(inventory, (row) => row.liveSnapshot?.catalogStatus),
    },
    conflictPolicy: {
      latestAloneNeverWins: true,
      latestValidCompleteIdentityResolvedWins: true,
      decisiveConflictsRemainBlocked: true,
      historicalCandidatesPreserved: true,
      fieldResidualMergeForbidden: true,
      humanTrackNeverOverwritten: true,
    },
    globalBlockers: unique(globalBlockers),
    readyForRemediationPlanning: globalBlockers.length === 0,
    outputs,
    safety: {
      payloadRead: true,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlRead: false,
      directPostgresqlWrite: false,
      migrationGenerated: false,
      migrationExecuted: false,
      schemaPush: false,
      productionApplyAuthorized: false,
    },
  })
  writeJson(outputs.summary, summary)
  writeJson(path.join(outDir, 'manifest.json'), fs.readdirSync(outDir).sort().map((name) => {
    const file = path.join(outDir, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('Radar public blocked inventory complete')
  console.log(`InventoryRows: ${inventory.length}`)
  console.log(`UniqueWorkIds: ${summary.inventory.uniqueWorkIds}`)
  console.log(`WithConflicts: ${summary.inventory.withConflicts}`)
  console.log(`WithDecisiveConflicts: ${summary.inventory.withDecisiveConflicts}`)
  console.log(`CurrentPublicConclusionsRead: ${currentPublic.length}`)
  console.log(`GlobalBlockers: ${summary.globalBlockers.length}`)
  console.log(`ReadyForRemediationPlanning: ${summary.readyForRemediationPlanning}`)
  console.log('PayloadWrite: False')
  console.log('PostgreSQLWrite: False')
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
