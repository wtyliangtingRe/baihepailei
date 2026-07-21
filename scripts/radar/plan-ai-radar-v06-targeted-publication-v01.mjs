#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import { classifyRadarCoverage } from './audit-ai-radar-coverage-v01.mjs'
import { loadExecuteRuns } from './audit-ai-radar-v06-reconciliation-v01.mjs'
import {
  canonical,
  equal,
  humanTrackRecorded,
  payloadComparable,
  val,
} from './lib/payload-plan-v01.mjs'

const VERSION = 'ai-radar-v06-targeted-publication-plan-v0.1'
const DEFAULT_GAP_ROOT = 'data_local/staging/ai-radar/v06-publication-gap-v01'
const DEFAULT_EXECUTE_ROOT = 'data_local/staging/ai-radar/v06-batch-execute-runs-v01'
const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/v06-targeted-publication-plan-v01'
const COMPATIBILITY_FIELDS = ['rank', 'ratingNotice', 'reviewStatus', 'reviewReasons', 'evidenceStrength']
const ALLOWED_PATCH_FIELDS = new Set(['_status', 'radarAssessment', ...COMPATIBILITY_FIELDS])
const VALID_GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F'])

function list(value) {
  return Array.isArray(value) ? value : []
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function readJsonl(file) {
  if (!file || !fs.existsSync(file)) throw new Error(`JSONL input not found: ${file}`)
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  return raw ? raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)) : []
}

function readRows(file) {
  if (!file || !fs.existsSync(file)) throw new Error(`Input not found: ${file}`)
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  if (!raw) return []
  if (/\.jsonl$/iu.test(file)) return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) return parsed
  for (const key of ['docs', 'rows', 'items', 'works', 'data']) {
    if (Array.isArray(parsed?.[key])) return parsed[key]
  }
  return [parsed]
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex')
}

function countBy(values) {
  const counts = {}
  for (const raw of values) {
    const key = val(raw) || 'missing'
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function newestFile(root, basename) {
  if (!fs.existsSync(root)) return ''
  const matches = []
  const walk = (dir, depth = 0) => {
    if (depth > 8) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file, depth + 1)
      else if (entry.name.toLowerCase() === basename.toLowerCase()) {
        matches.push({ file, mtimeMs: fs.statSync(file).mtimeMs })
      }
    }
  }
  walk(root)
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file))
  return matches[0]?.file || ''
}

function timeValue(value) {
  const parsed = Date.parse(val(value))
  return Number.isFinite(parsed) ? parsed : 0
}

export function latestVerifiedEventByWork(runs) {
  const result = new Map()
  for (const run of runs) {
    for (const event of list(run?.events)) {
      if (!['applied_and_verified', 'already_applied_preflight'].includes(val(event?.evidenceKind))) continue
      const workId = val(event?.workId)
      if (!workId) continue
      const previous = result.get(workId)
      if (!previous || timeValue(event?.generatedAt) >= timeValue(previous?.generatedAt)) result.set(workId, event)
    }
  }
  return result
}

function workMap(rows) {
  const map = new Map()
  for (const row of rows) {
    const id = val(row?.id)
    if (id) map.set(id, row)
  }
  return map
}

function normalizeTitle(value) {
  return val(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function radarOf(work) {
  return work?.radarAssessment && typeof work.radarAssessment === 'object' ? work.radarAssessment : {}
}

function comparable(value) {
  return canonical(payloadComparable(value))
}

function selectedPublishedState(work) {
  return canonical({
    id: val(work?.id),
    siteId: val(work?.siteId),
    title: val(work?.title),
    _status: val(work?._status),
    rank: work?.rank,
    ratingNotice: work?.ratingNotice,
    reviewStatus: work?.reviewStatus,
    reviewReasons: list(work?.reviewReasons),
    evidenceStrength: work?.evidenceStrength,
    radarAssessment: radarOf(work),
    humanAssessment: work?.humanAssessment || null,
  })
}

function selectedHumanState(work) {
  return canonical({
    humanAssessment: work?.humanAssessment || null,
    humanReviewNote: work?.humanReviewNote || null,
    humanReviewedAt: work?.humanReviewedAt || null,
    humanReviewedBy: work?.humanReviewedBy || null,
  })
}

function fieldChanges(work, patch) {
  const changes = []
  for (const [key, value] of Object.entries(patch)) {
    if (!equal(comparable(work?.[key]), comparable(value))) changes.push(key)
  }
  return changes.sort()
}

export function buildTargetedPublicationPlanRow(gapRow, event, published, latestDraft) {
  const blockers = []
  const warnings = []
  const plan = event?.plan || null
  const expectedRadar = plan?.patch?.radarAssessment
  const workId = val(gapRow?.workId || event?.workId)
  const targetId = val(gapRow?.targetId || event?.targetId || plan?.target?.id || workId)

  if (val(gapRow?.status) !== 'draft_only_v06_match') blockers.push('publication_gap_not_draft_only_v06_match')
  if (!event) blockers.push('verified_apply_event_missing')
  if (!plan) blockers.push('source_plan_missing')
  if (!published) blockers.push('published_work_missing')
  if (!latestDraft) blockers.push('latest_draft_work_missing')
  if (!expectedRadar || typeof expectedRadar !== 'object') blockers.push('source_plan_radar_assessment_missing')

  if (published && val(published?.id) !== targetId) blockers.push('published_target_id_mismatch')
  if (latestDraft && val(latestDraft?.id) !== targetId) blockers.push('draft_target_id_mismatch')
  if (published && latestDraft && val(published?.siteId) !== val(latestDraft?.siteId)) blockers.push('published_draft_site_id_mismatch')
  if (plan && published && val(plan?.target?.siteId) && val(plan.target.siteId) !== val(published?.siteId)) blockers.push('plan_site_id_mismatch')

  const expectedGrade = val(expectedRadar?.suggestedGrade)
  if (!VALID_GRADES.has(expectedGrade)) blockers.push('v06_expected_grade_invalid')
  if (!val(expectedRadar?.policyVersion)) blockers.push('v06_policy_version_missing')
  if (!val(expectedRadar?.assessmentBatch)) blockers.push('v06_assessment_batch_missing')

  if (latestDraft && expectedRadar && !equal(comparable(radarOf(latestDraft)), comparable(expectedRadar))) {
    blockers.push('latest_draft_radar_no_longer_matches_verified_v06_plan')
  }

  if (published) {
    const coverage = classifyRadarCoverage(published)
    if (['fixed_grade', 'bounded_range'].includes(coverage)) blockers.push('published_has_formal_ai_conclusion')
  }

  if (latestDraft) {
    const coverage = classifyRadarCoverage(latestDraft)
    if (coverage !== 'fixed_grade') blockers.push('latest_draft_does_not_have_v06_fixed_grade')
  }

  if (published && latestDraft && normalizeTitle(published?.title) !== normalizeTitle(latestDraft?.title)) {
    warnings.push('published_draft_title_mismatch_stable_id_preserved')
  }

  const currentHumanTrack = published ? humanTrackRecorded(published) : false
  const patch = { _status: 'published' }
  if (expectedRadar && typeof expectedRadar === 'object') patch.radarAssessment = canonical(expectedRadar)
  if (!currentHumanTrack && plan?.patch) {
    for (const field of COMPATIBILITY_FIELDS) {
      if (field in plan.patch) patch[field] = canonical(plan.patch[field])
    }
  }

  for (const key of Object.keys(patch)) {
    if (!ALLOWED_PATCH_FIELDS.has(key)) blockers.push(`unexpected_targeted_patch_field:${key}`)
  }
  if ('humanAssessment' in patch) blockers.push('human_assessment_must_not_be_patched')

  const changedFields = published ? fieldChanges(published, patch) : Object.keys(patch).sort()
  if (!changedFields.includes('radarAssessment')) warnings.push('published_radar_already_equal_to_v06_despite_gap_classification')

  const planStatus = blockers.length ? 'blocked' : 'ready_for_publication_dry_run'
  const publishedState = published ? selectedPublishedState(published) : null
  const humanState = published ? selectedHumanState(published) : null

  return canonical({
    version: VERSION,
    planStatus,
    workId,
    target: {
      id: targetId,
      siteId: val(published?.siteId || latestDraft?.siteId || plan?.target?.siteId),
      title: val(published?.title || latestDraft?.title || gapRow?.title),
    },
    source: {
      gapStatus: val(gapRow?.status),
      batchId: val(event?.batchId),
      evidenceKind: val(event?.evidenceKind),
      executeGeneratedAt: val(event?.generatedAt),
      executeSummaryFile: val(event?.summaryFile),
      planFile: val(event?.planFile),
      expectedSuggestedGrade: expectedGrade,
      expectedPolicyVersion: val(expectedRadar?.policyVersion),
      expectedAssessmentBatch: val(expectedRadar?.assessmentBatch),
    },
    expectedBefore: {
      publishedState,
      publishedStateSha256: publishedState ? sha256(publishedState) : '',
      humanStateSha256: humanState ? sha256(humanState) : '',
      latestDraftRadarSha256: latestDraft ? sha256(comparable(radarOf(latestDraft))) : '',
    },
    patch,
    patchSha256: sha256(patch),
    changedFields,
    humanTrackRecorded: currentHumanTrack,
    humanTrackPreservedByOmission: !('humanAssessment' in patch),
    wholeDraftPublicationForbidden: true,
    blockers: [...new Set(blockers)].sort(),
    warnings: [...new Set(warnings)].sort(),
  })
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`)
  return body
}

async function login(baseUrl, email, password) {
  const body = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  const token = val(body?.token)
  if (!token) throw new Error('Payload login response did not include a token')
  return token
}

async function readWorks(baseUrl, token, { draft }) {
  const rows = []
  let page = 1
  while (true) {
    const params = new URLSearchParams({ limit: '200', page: String(page), depth: '0', sort: 'id' })
    if (draft) params.set('draft', 'true')
    const body = await requestJson(`${baseUrl}/api/works?${params}`, {
      headers: { authorization: `JWT ${token}` },
    })
    const docs = list(body?.docs)
    rows.push(...docs)
    if (!body?.hasNextPage || docs.length === 0) break
    page += 1
  }
  return rows
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.write || args.patch || args.confirm || args.publish || args.restore) {
    throw new Error('Targeted publication planning is read-only. Execute/apply/write/patch/publish/restore flags are rejected.')
  }

  const gapFile = val(args['gap-file']) || newestFile(val(args['gap-root']) || DEFAULT_GAP_ROOT, 'draft-only-v06-match.jsonl')
  if (!gapFile) throw new Error('No draft-only-v06-match.jsonl was found. Run the publication gap audit first or pass --gap-file.')
  const gapRows = readJsonl(gapFile)

  const baseUrl = val(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const publishedFile = val(args['published-file'])
  const draftFile = val(args['draft-file'])
  if (Boolean(publishedFile) !== Boolean(draftFile)) throw new Error('--published-file and --draft-file must be supplied together.')

  let publishedWorks
  let latestDraftWorks
  let payloadRead = false
  if (publishedFile && draftFile) {
    publishedWorks = readRows(publishedFile)
    latestDraftWorks = readRows(draftFile)
  } else {
    const email = val(process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.SITE_OWNER_EMAIL)
    const password = val(process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD)
    if (!email || !password) throw new Error('Payload credentials are required unless published and draft files are supplied.')
    const token = await login(baseUrl, email, password)
    publishedWorks = await readWorks(baseUrl, token, { draft: false })
    latestDraftWorks = await readWorks(baseUrl, token, { draft: true })
    payloadRead = true
  }

  const executeRoot = val(args['execute-root']) || DEFAULT_EXECUTE_ROOT
  const loaded = loadExecuteRuns(executeRoot)
  const events = latestVerifiedEventByWork(loaded.runs)
  const publishedById = workMap(publishedWorks)
  const draftById = workMap(latestDraftWorks)

  const rows = gapRows.map((gapRow) => {
    const workId = val(gapRow?.workId)
    const event = events.get(workId) || null
    const targetId = val(gapRow?.targetId || event?.targetId || event?.plan?.target?.id || workId)
    return buildTargetedPublicationPlanRow(
      gapRow,
      event,
      publishedById.get(targetId) || publishedById.get(workId) || null,
      draftById.get(targetId) || draftById.get(workId) || null,
    )
  })

  const runId = `${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${process.pid}`
  const outDir = val(args['out-dir']) || path.join(DEFAULT_OUT_ROOT, runId)
  if (fs.existsSync(outDir)) throw new Error(`Output directory already exists: ${outDir}`)

  const ready = rows.filter((row) => row.planStatus === 'ready_for_publication_dry_run')
  const blocked = rows.filter((row) => row.planStatus === 'blocked')
  const outputs = {
    summary: path.join(outDir, 'summary.json'),
    plan: path.join(outDir, 'targeted-publication-plan.jsonl'),
    ready: path.join(outDir, 'ready-for-publication-dry-run.jsonl'),
    blocked: path.join(outDir, 'blocked.jsonl'),
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    sources: {
      gapFile,
      executeRoot,
      publishedWorks: publishedFile || baseUrl,
      latestDraftWorks: draftFile || baseUrl,
    },
    gapRowsRead: gapRows.length,
    publishedWorksRead: publishedWorks.length,
    latestDraftWorksRead: latestDraftWorks.length,
    planRows: rows.length,
    readyForPublicationDryRun: ready.length,
    blocked: blocked.length,
    byPlanStatus: countBy(rows.map((row) => row.planStatus)),
    byBlocker: countBy(blocked.flatMap((row) => row.blockers)),
    withHumanTrack: rows.filter((row) => row.humanTrackRecorded).length,
    patchFieldCounts: countBy(rows.flatMap((row) => row.changedFields)),
    artifactIntegrityIssues: loaded.issues.length,
    outputs,
    safety: {
      payloadRead,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      publishesWholeDrafts: false,
      patchFieldsAllowlisted: true,
      humanAssessmentPatchForbidden: true,
    },
    nextStep: 'Run a separate dry-run that re-fetches both published and latest-draft views, validates the stored hashes, and simulates only the allowlisted partial PATCH. Do not execute this plan directly.',
  }

  writeJsonl(outputs.plan, rows)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.blocked, blocked)
  writeJson(outputs.summary, summary)
  console.log(JSON.stringify({ ok: blocked.length === 0 && loaded.issues.length === 0, summary }, null, 2))
  if (blocked.length || loaded.issues.length) process.exitCode = 2
}

const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isDirectRun) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
