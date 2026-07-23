#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  buildPlanRow,
  buildWorkIndexes,
  canonical,
  evidenceStrengthFor,
  val,
} from './lib/payload-plan-v01.mjs'
import { readJsonl, sha256File } from './lib/v06-package-import-v01.mjs'

const VERSION = 'all-remaining-radar-global-audit-v0.1'
const EXPECTED_SOURCE_ROWS = 10805
const EXPECTED_SOURCE_READY = 9364
const EXPECTED_SOURCE_BLOCKED = 1441
const EXPECTED_SOURCE_GUARDED = 698
const EXPECTED_WORKS = 35615
const DISCARDED_TEST_WORK_IDS = new Set(['10097', '32186', '25561', '32094'])
const ALLOWED_PUBLIC_GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F'])

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

function readJson(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`)
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function hashValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function unique(values) {
  return [...new Set((values || []).map(val).filter(Boolean))]
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
  if (!email || !password) throw new Error('Missing Payload credentials in RADAR_PAYLOAD_EMAIL/RADAR_PAYLOAD_PASSWORD or compatible variables.')
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
    docs.push(...(Array.isArray(body?.docs) ? body.docs : []))
    totalPages = Number(body?.totalPages || 1)
    page += 1
  } while (page <= totalPages)
  return docs
}

function humanTrackRecorded(work) {
  return Boolean(
    val(work?.humanAssessment?.grade)
    || (val(work?.humanAssessment?.status) && val(work?.humanAssessment?.status) !== 'pending')
    || val(work?.ratingNotice) === 'manual_reviewed'
    || ['reviewed', 'disputed', 'deprecated'].includes(val(work?.reviewStatus)),
  )
}

function lifecycleBlockers(work) {
  if (!work) return ['missing_target_work']
  return unique([
    val(work.catalogStatus) !== 'active' ? `catalog_status_${val(work.catalogStatus) || 'missing'}` : '',
    val(work._status) !== 'published' ? `payload_status_${val(work._status) || 'missing'}` : '',
    work.isLiteVisible === false ? 'lite_hidden' : '',
    work.isFullVisible === false ? 'full_hidden' : '',
  ])
}

function publicAssessmentFor(source, privatePlan) {
  const radar = privatePlan?.patch?.radarAssessment || privatePlan?.expectedBefore?.radarAssessment || {}
  const grade = val(source?.currentGradeSuggestion || source?.grade)
  const core = canonical({
    publicationKey: `work:${privatePlan.target.id}`,
    work: privatePlan.target.id,
    workIdSnapshot: privatePlan.target.id,
    workSiteId: privatePlan.target.siteId,
    title: privatePlan.target.title,
    recordStatus: 'current',
    conclusionMode: 'fixed_grade',
    compatibilityGrade: grade,
    bestGrade: grade,
    likelyGrade: grade,
    worstGrade: grade,
    ratingNotice: 'ai_synthesized_pending_review',
    reviewReasons: ['radar_v06_package_import'],
    evidenceStrength: evidenceStrengthFor(source),
    radarAssessment: radar,
    sourceKind: 'package',
    sourcePackageId: 'radar-v06-10805',
    sourcePackageSha256: source.__sourcePackageSha256,
    publicationVersion: 'radar-public-conclusions-import-v01',
  })
  return { ...core, conclusionSha256: hashValue(core) }
}

function comparablePublic(value) {
  if (!value) return null
  return canonical({
    publicationKey: value.publicationKey,
    work: typeof value.work === 'object' ? value.work?.id : value.work,
    workIdSnapshot: value.workIdSnapshot,
    workSiteId: value.workSiteId,
    title: value.title,
    recordStatus: value.recordStatus,
    conclusionMode: value.conclusionMode,
    compatibilityGrade: value.compatibilityGrade,
    bestGrade: value.bestGrade,
    likelyGrade: value.likelyGrade,
    worstGrade: value.worstGrade,
    ratingNotice: value.ratingNotice,
    reviewReasons: value.reviewReasons,
    evidenceStrength: value.evidenceStrength,
    radarAssessment: value.radarAssessment,
    sourceKind: value.sourceKind,
    sourcePackageId: value.sourcePackageId,
    sourcePackageSha256: value.sourcePackageSha256,
    conclusionSha256: value.conclusionSha256,
    publicationVersion: value.publicationVersion,
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  for (const key of ['source', 'source-summary', 'production-receipt', 'out-dir', 'url', 'public-schema-ready']) {
    if (!val(args[key])) throw new Error(`Required: --${key}`)
  }
  if (args.execute || args.apply || args.write || args.patch || args.confirm || args['approval-token']) {
    throw new Error('Global remaining-data audit is read-only. Execute/apply/write flags are rejected.')
  }

  const sourceFile = path.resolve(args.source)
  const sourceSummaryFile = path.resolve(args['source-summary'])
  const receiptFile = path.resolve(args['production-receipt'])
  const outDir = path.resolve(args['out-dir'])
  const baseUrl = val(args.url).replace(/\/+$/u, '')
  const publicSchemaReady = val(args['public-schema-ready']).toLowerCase() === 'true'
  const sourceSummary = readJson(sourceSummaryFile)
  const receipt = readJson(receiptFile)
  const sourceRows = readJsonl(sourceFile)

  const globalBlockers = []
  if (sourceRows.length !== EXPECTED_SOURCE_ROWS) globalBlockers.push(`source_rows_expected_${EXPECTED_SOURCE_ROWS}_received_${sourceRows.length}`)
  if (Number(sourceSummary.rowsRead) !== EXPECTED_SOURCE_ROWS) globalBlockers.push('source_summary_rows_mismatch')
  if (Number(sourceSummary.readyForPayloadPlanning) !== EXPECTED_SOURCE_READY) globalBlockers.push('source_summary_ready_mismatch')
  if (Number(sourceSummary.blockedBeforePayloadPlanning) !== EXPECTED_SOURCE_BLOCKED) globalBlockers.push('source_summary_blocked_mismatch')
  if (Number(sourceSummary.publicationGuardRows) !== EXPECTED_SOURCE_GUARDED) globalBlockers.push('source_summary_guard_mismatch')
  if (receipt.applyCommitted !== true || receipt.postMergeAcceptancePassed !== true || receipt.postMergeTableDeltasMatched !== true) {
    globalBlockers.push('test_work_merge_receipt_not_verified')
  }
  if ((receipt.targetWorkIds || []).map(String).join(',') !== '32186,10097,32094,25561') globalBlockers.push('test_work_merge_receipt_target_mismatch')

  const sourceWorkIds = sourceRows.map((row) => val(row.workId))
  const duplicateSourceIds = sourceWorkIds.filter((id, index) => id && sourceWorkIds.indexOf(id) !== index)
  if (duplicateSourceIds.length) globalBlockers.push(`duplicate_source_work_ids:${unique(duplicateSourceIds).slice(0, 20).join(',')}`)

  const token = await login(baseUrl)
  const works = await fetchCollection(baseUrl, token, 'works', { draft: 'true' })
  if (works.length !== EXPECTED_WORKS) globalBlockers.push(`payload_works_expected_${EXPECTED_WORKS}_received_${works.length}`)
  const publicConclusions = publicSchemaReady
    ? await fetchCollection(baseUrl, token, 'radar-public-conclusions')
    : []
  const publicByKey = new Map(publicConclusions.map((row) => [val(row.publicationKey), row]))
  const indexes = buildWorkIndexes(works)
  const sourcePackageSha256 = val(sourceSummary.packageManifestSha256) || sha256File(sourceFile)

  const audited = []
  for (const original of sourceRows) {
    const source = { ...original, __sourcePackageSha256: sourcePackageSha256 }
    const sourceWorkId = val(source.workId)
    if (DISCARDED_TEST_WORK_IDS.has(sourceWorkId)) {
      audited.push(canonical({
        sourceWorkId,
        siteId: val(source.siteId),
        title: val(source.title),
        assessmentBatch: val(source.assessmentBatch),
        privateStatus: 'blocked_discarded_test_assessment',
        publicStatus: 'blocked_discarded_test_assessment',
        blockers: ['discarded_test_assessment_requires_fresh_research'],
        needsPublicationGuard: source.needsPublicationGuard === true,
      }))
      continue
    }

    const privatePlan = buildPlanRow(source, indexes, { assessedAt: val(source.assessedAt) })
    const targetWork = privatePlan?.target?.id
      ? works.find((work) => val(work.id) === val(privatePlan.target.id))
      : null
    const privateStatus = privatePlan.planStatus === 'ready_for_payload_dry_run'
      ? 'ready_private_ai_write'
      : privatePlan.planStatus === 'already_current'
        ? 'already_current_private_ai'
        : 'blocked_private_ai'

    const publicBlockers = unique([
      ...(privatePlan.planStatus === 'blocked' ? privatePlan.blockers : []),
      ...(source.needsPublicationGuard === true ? ['publication_guard'] : []),
      ...(!ALLOWED_PUBLIC_GRADES.has(val(source.currentGradeSuggestion || source.grade)) ? ['public_grade_not_allowed'] : []),
      ...lifecycleBlockers(targetWork),
    ])
    let publicStatus = 'blocked_public_ai'
    let publicRecord = null
    let currentPublicId = ''
    if (!publicBlockers.length) {
      publicRecord = publicAssessmentFor(source, privatePlan)
      const current = publicByKey.get(publicRecord.publicationKey)
      currentPublicId = val(current?.id)
      if (!publicSchemaReady) publicStatus = 'ready_public_ai_after_schema'
      else if (JSON.stringify(comparablePublic(current)) === JSON.stringify(comparablePublic(publicRecord))) publicStatus = 'already_current_public_ai'
      else publicStatus = current ? 'ready_public_ai_update' : 'ready_public_ai_create'
    }

    audited.push(canonical({
      sourceWorkId,
      siteId: val(source.siteId),
      title: val(source.title),
      assessmentBatch: val(source.assessmentBatch),
      policyVersion: val(source.policyVersion),
      grade: val(source.currentGradeSuggestion || source.grade),
      target: privatePlan.target,
      humanTrackRecorded: humanTrackRecorded(targetWork),
      needsPublicationGuard: source.needsPublicationGuard === true,
      privateStatus,
      publicStatus,
      privatePlan,
      publicRecord,
      currentPublicId: currentPublicId || undefined,
      blockers: unique([...privatePlan.blockers, ...publicBlockers]),
      warnings: privatePlan.warnings,
    }))
  }

  const privateReady = audited.filter((row) => row.privateStatus === 'ready_private_ai_write')
  const privateCurrent = audited.filter((row) => row.privateStatus === 'already_current_private_ai')
  const privateBlocked = audited.filter((row) => row.privateStatus?.startsWith('blocked_'))
  const publicReady = audited.filter((row) => row.publicStatus?.startsWith('ready_public_ai'))
  const publicCurrent = audited.filter((row) => row.publicStatus === 'already_current_public_ai')
  const publicBlocked = audited.filter((row) => row.publicStatus?.startsWith('blocked_'))

  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  const outputs = {
    all: path.join(outDir, 'all-remaining-radar-global-audit.jsonl'),
    privateReady: path.join(outDir, 'private-ai-ready.jsonl'),
    privateCurrent: path.join(outDir, 'private-ai-already-current.jsonl'),
    privateBlocked: path.join(outDir, 'private-ai-blocked.jsonl'),
    publicReady: path.join(outDir, 'public-ai-ready.jsonl'),
    publicCurrent: path.join(outDir, 'public-ai-already-current.jsonl'),
    publicBlocked: path.join(outDir, 'public-ai-blocked.jsonl'),
    summary: path.join(outDir, 'all-remaining-radar-global-audit-summary.json'),
  }
  writeJsonl(outputs.all, audited)
  writeJsonl(outputs.privateReady, privateReady)
  writeJsonl(outputs.privateCurrent, privateCurrent)
  writeJsonl(outputs.privateBlocked, privateBlocked)
  writeJsonl(outputs.publicReady, publicReady)
  writeJsonl(outputs.publicCurrent, publicCurrent)
  writeJsonl(outputs.publicBlocked, publicBlocked)

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version: VERSION,
    source: {
      file: sourceFile,
      fileSha256: sha256File(sourceFile),
      summaryFile: sourceSummaryFile,
      summarySha256: sha256File(sourceSummaryFile),
      rows: sourceRows.length,
      packageManifestSha256: sourcePackageSha256,
      historicalReadyForPayloadPlanning: Number(sourceSummary.readyForPayloadPlanning),
      historicalBlockedBeforePayloadPlanning: Number(sourceSummary.blockedBeforePayloadPlanning),
      publicationGuardRows: Number(sourceSummary.publicationGuardRows),
    },
    production: {
      worksRead: works.length,
      publicSchemaReady,
      existingPublicConclusionsRead: publicConclusions.length,
      testWorkMergeReceipt: receiptFile,
      testWorkMergeReceiptSha256: sha256File(receiptFile),
    },
    privateTrack: {
      readyToWrite: privateReady.length,
      alreadyCurrent: privateCurrent.length,
      blocked: privateBlocked.length,
      byStatus: countBy(audited, (row) => row.privateStatus),
      byBlocker: countBy(privateBlocked.flatMap((row) => row.blockers || []), (item) => item),
    },
    publicTrack: {
      readyToWrite: publicReady.length,
      alreadyCurrent: publicCurrent.length,
      blocked: publicBlocked.length,
      schemaCreationRequired: !publicSchemaReady,
      byStatus: countBy(audited, (row) => row.publicStatus),
      byBlocker: countBy(publicBlocked.flatMap((row) => row.blockers || []), (item) => item),
    },
    discardedTestAssessmentRows: audited.filter((row) => row.privateStatus === 'blocked_discarded_test_assessment').length,
    globalBlockers: unique(globalBlockers),
    outputs,
    readyForSingleExecutionPlanning: globalBlockers.length === 0,
    safety: {
      payloadRead: true,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlRead: false,
      directPostgresqlWrite: false,
      migrationGenerated: false,
      migrationExecuted: false,
      schemaPush: false,
      testWorkAssessmentsReintroduced: false,
      humanTrackOverwritten: false,
    },
  }
  writeJson(outputs.summary, summary)
  writeJson(path.join(outDir, 'manifest.json'), fs.readdirSync(outDir).sort().map((name) => {
    const file = path.join(outDir, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('All remaining Radar global audit complete')
  console.log(`SourceRows: ${sourceRows.length}`)
  console.log(`ProductionWorksRead: ${works.length}`)
  console.log(`PrivateReadyToWrite: ${privateReady.length}`)
  console.log(`PrivateAlreadyCurrent: ${privateCurrent.length}`)
  console.log(`PrivateBlocked: ${privateBlocked.length}`)
  console.log(`PublicReadyToWrite: ${publicReady.length}`)
  console.log(`PublicAlreadyCurrent: ${publicCurrent.length}`)
  console.log(`PublicBlocked: ${publicBlocked.length}`)
  console.log(`PublicSchemaCreationRequired: ${!publicSchemaReady}`)
  console.log(`GlobalBlockers: ${summary.globalBlockers.length}`)
  console.log(`ReadyForSingleExecutionPlanning: ${summary.readyForSingleExecutionPlanning}`)
  console.log('PayloadWrite: False')
  console.log('PostgreSQLWrite: False')
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
