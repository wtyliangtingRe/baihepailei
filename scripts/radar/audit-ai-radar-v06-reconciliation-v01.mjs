#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { classifyRadarCoverage } from './audit-ai-radar-coverage-v01.mjs'
import {
  canonical,
  equal,
  payloadComparable,
  val,
} from './lib/payload-plan-v01.mjs'

const VERSION = 'ai-radar-v06-reconciliation-v0.1'
const DEFAULT_EXECUTE_ROOT = 'data_local/staging/ai-radar/v06-batch-execute-runs-v01'
const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/v06-reconciliation-v01'
const VALID_GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X'])

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

function readJsonl(file) {
  if (!file || !fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

function readRows(file) {
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

function countBy(values) {
  const counts = {}
  for (const raw of values) {
    const key = val(raw) || 'missing'
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function runtimePath(value) {
  const raw = val(value)
  if (!raw) return ''
  if (process.platform === 'win32') return raw.replace(/\//gu, '\\')
  return raw.replace(/\\/gu, '/')
}

function existingOrSibling(requested, summaryFile, fallbackName) {
  const normalized = runtimePath(requested)
  if (normalized && fs.existsSync(normalized)) return normalized
  const sibling = path.join(path.dirname(summaryFile), fallbackName)
  return fs.existsSync(sibling) ? sibling : normalized || sibling
}

function walkSummaryFiles(root) {
  if (!fs.existsSync(root)) return []
  const files = []
  const walk = (dir, depth = 0) => {
    if (depth > 8) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file, depth + 1)
      else if (entry.name.toLowerCase() === 'summary.json') files.push(file)
    }
  }
  walk(root)
  return files.sort()
}

function timeValue(value) {
  const parsed = Date.parse(val(value))
  return Number.isFinite(parsed) ? parsed : 0
}

export function selectLatestRuns(runs) {
  const latest = new Map()
  for (const run of runs) {
    const batchId = val(run?.batchId)
    if (!batchId) continue
    const previous = latest.get(batchId)
    if (!previous || timeValue(run?.generatedAt) >= timeValue(previous?.generatedAt)) latest.set(batchId, run)
  }
  return [...latest.values()].sort((a, b) => val(a?.batchId).localeCompare(val(b?.batchId)))
}

function planFileFromSummary(summary, summaryFile, issues) {
  const candidateFile = runtimePath(summary?.candidateManifestFile)
  if (!candidateFile || !fs.existsSync(candidateFile)) {
    issues.push(`candidate_manifest_missing:${summaryFile}`)
    return ''
  }
  try {
    const candidate = readJson(candidateFile)
    const planFile = runtimePath(candidate?.files?.plan?.path)
    if (!planFile || !fs.existsSync(planFile)) {
      issues.push(`plan_file_missing:${candidateFile}`)
      return ''
    }
    return planFile
  } catch (error) {
    issues.push(`candidate_manifest_unreadable:${candidateFile}:${val(error?.message || error)}`)
    return ''
  }
}

export function loadExecuteRuns(executeRoot) {
  const issues = []
  const runs = []
  for (const summaryFile of walkSummaryFiles(executeRoot)) {
    let summary
    try {
      summary = readJson(summaryFile)
    } catch (error) {
      issues.push(`summary_unreadable:${summaryFile}:${val(error?.message || error)}`)
      continue
    }
    if (val(summary?.mode) && val(summary?.mode) !== 'execute') continue
    if (val(summary?.version) !== 'ai-radar-v06-batch-apply-v0.1') continue

    const appliedFile = existingOrSibling(summary?.outputs?.applied, summaryFile, 'applied.jsonl')
    const preflightFile = existingOrSibling(summary?.outputs?.preflight, summaryFile, 'preflight.jsonl')
    const journalFile = existingOrSibling(summary?.outputs?.journal, summaryFile, 'journal.jsonl')
    const appliedRows = readJsonl(appliedFile)
    const preflightRows = readJsonl(preflightFile)
    const journalRows = readJsonl(journalFile)
    const planFile = planFileFromSummary(summary, summaryFile, issues)
    const plans = planFile ? readJsonl(planFile) : []
    const planByWorkId = new Map(plans.map((row) => [val(row?.workId), row]).filter(([key]) => key))

    const declaredApplied = Number(summary?.appliedAndVerified || 0)
    if (declaredApplied !== appliedRows.length) {
      issues.push(`applied_count_mismatch:${summaryFile}:summary_${declaredApplied}:file_${appliedRows.length}`)
    }
    if (Number(summary?.payloadPatchRequests || 0) < appliedRows.length) {
      issues.push(`patch_request_count_less_than_applied:${summaryFile}`)
    }

    const events = []
    for (const row of appliedRows) {
      const workId = val(row?.workId)
      events.push({
        evidenceKind: 'applied_and_verified',
        workId,
        targetId: val(row?.targetId),
        batchId: val(summary?.batchId),
        generatedAt: val(summary?.generatedAt),
        summaryFile,
        appliedFile,
        planFile,
        plan: planByWorkId.get(workId) || null,
        appliedRow: row,
      })
    }

    for (const row of preflightRows.filter((item) => val(item?.status) === 'already_applied')) {
      const workId = val(row?.workId)
      events.push({
        evidenceKind: 'already_applied_preflight',
        workId,
        targetId: val(row?.targetId),
        batchId: val(summary?.batchId),
        generatedAt: val(summary?.generatedAt),
        summaryFile,
        appliedFile,
        planFile,
        plan: planByWorkId.get(workId) || null,
        appliedRow: row,
      })
    }

    runs.push({
      summaryFile,
      appliedFile,
      preflightFile,
      journalFile,
      planFile,
      batchId: val(summary?.batchId),
      generatedAt: val(summary?.generatedAt),
      planRowsRead: Number(summary?.planRowsRead || 0),
      readyPlanRows: Number(summary?.readyPlanRows || 0),
      pendingOriginal: Number(summary?.pendingOriginal || 0),
      alreadyApplied: Number(summary?.alreadyApplied || 0),
      drifted: Number(summary?.drifted || 0),
      appliedAndVerified: declaredApplied,
      completedAfterRun: Number(summary?.completedAfterRun || 0),
      remainingAfterRun: Number(summary?.remainingAfterRun || 0),
      payloadPatchRequests: Number(summary?.payloadPatchRequests || 0),
      stoppedAfterFailure: summary?.stoppedAfterFailure === true,
      staticBlockers: list(summary?.staticBlockers),
      gateBlockers: list(summary?.gateBlockers),
      appliedFileRows: appliedRows.length,
      journalRows: journalRows.length,
      events,
    })
  }
  return { runs, issues }
}

function currentRadarOf(work) {
  return work?.radarAssessment && typeof work.radarAssessment === 'object' ? work.radarAssessment : {}
}

function isGrade(value) {
  return VALID_GRADES.has(val(value))
}

function comparable(value) {
  return canonical(payloadComparable(value))
}

export function classifyCurrentAgainstV06(work, event) {
  const plan = event?.plan
  if (!work) return 'work_missing'
  if (!plan) return 'plan_missing'

  const expectedRadar = plan?.patch?.radarAssessment
  if (!expectedRadar || typeof expectedRadar !== 'object') return 'plan_missing_radar_assessment'

  const currentRadar = currentRadarOf(work)
  const currentCoverage = classifyRadarCoverage(work)
  if (equal(comparable(currentRadar), comparable(expectedRadar))) return 'current_matches_v06_exact'

  const expectedGrade = val(expectedRadar?.suggestedGrade)
  const currentGrade = val(currentRadar?.suggestedGrade)
  const expectedBatch = val(expectedRadar?.assessmentBatch)
  const currentBatch = val(currentRadar?.assessmentBatch)
  const expectedPolicy = val(expectedRadar?.policyVersion)
  const currentPolicy = val(currentRadar?.policyVersion)

  if (
    isGrade(expectedGrade)
    && currentGrade === expectedGrade
    && (!expectedBatch || currentBatch === expectedBatch)
    && (!expectedPolicy || currentPolicy === expectedPolicy)
  ) return 'current_matches_v06_identity_fields'

  if (currentCoverage === 'fixed_grade' || currentCoverage === 'bounded_range') return 'current_has_other_formal_conclusion'
  if (currentCoverage === 'scanned_without_valid_conclusion') return 'current_scanned_without_valid_conclusion'
  return 'current_missing_after_verified_apply'
}

function compactReconciliation(work, event, status) {
  const planRadar = event?.plan?.patch?.radarAssessment || {}
  const currentRadar = currentRadarOf(work)
  return {
    status,
    workId: val(event?.workId),
    targetId: val(event?.targetId || event?.plan?.target?.id),
    siteId: val(work?.siteId || event?.plan?.siteId),
    title: val(work?.title || event?.plan?.title || event?.appliedRow?.title),
    batchId: val(event?.batchId),
    evidenceKind: val(event?.evidenceKind),
    executeGeneratedAt: val(event?.generatedAt),
    summaryFile: val(event?.summaryFile),
    planFile: val(event?.planFile),
    expectedSuggestedGrade: val(planRadar?.suggestedGrade),
    expectedPolicyVersion: val(planRadar?.policyVersion),
    expectedAssessmentBatch: val(planRadar?.assessmentBatch),
    currentCoverageMode: work ? classifyRadarCoverage(work) : 'work_missing',
    currentSuggestedGrade: val(currentRadar?.suggestedGrade),
    currentPolicyVersion: val(currentRadar?.policyVersion),
    currentAssessmentBatch: val(currentRadar?.assessmentBatch),
    currentAssessedAt: val(currentRadar?.assessedAt),
    currentRatingNotice: val(work?.ratingNotice),
    currentEvidenceStrength: val(work?.evidenceStrength),
    humanAssessmentPresent: Boolean(
      val(work?.humanAssessment?.grade)
      || (val(work?.humanAssessment?.status) && val(work?.humanAssessment?.status) !== 'pending'),
    ),
  }
}

export function reconcileVerifiedEvents(works, runs) {
  const workById = new Map()
  for (const work of works) {
    const id = val(work?.id)
    if (id) workById.set(id, work)
  }

  const latestEventByWorkId = new Map()
  for (const run of runs) {
    for (const event of list(run?.events)) {
      const workId = val(event?.workId)
      if (!workId) continue
      const previous = latestEventByWorkId.get(workId)
      if (!previous || timeValue(event?.generatedAt) >= timeValue(previous?.generatedAt)) {
        latestEventByWorkId.set(workId, event)
      }
    }
  }

  const rows = []
  for (const event of latestEventByWorkId.values()) {
    const targetId = val(event?.targetId || event?.plan?.target?.id || event?.workId)
    const work = workById.get(targetId) || workById.get(val(event?.workId)) || null
    const status = classifyCurrentAgainstV06(work, event)
    rows.push(compactReconciliation(work, event, status))
  }

  rows.sort((a, b) => a.status.localeCompare(b.status) || a.batchId.localeCompare(b.batchId) || a.workId.localeCompare(b.workId))
  return rows
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

async function readWorks(baseUrl, token) {
  const rows = []
  let page = 1
  while (true) {
    const params = new URLSearchParams({ limit: '200', page: String(page), depth: '0', draft: 'true', sort: 'id' })
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
    throw new Error('v0.6 reconciliation audit is read-only. Execute/apply/write/patch/publish/restore flags are rejected.')
  }

  const baseUrl = val(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const worksFile = val(args['works-file'])
  let works
  let payloadRead = false
  if (worksFile) works = readRows(worksFile)
  else {
    const email = val(process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.SITE_OWNER_EMAIL)
    const password = val(process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD)
    if (!email || !password) throw new Error('Payload credentials are required unless --works-file is supplied.')
    const token = await login(baseUrl, email, password)
    works = await readWorks(baseUrl, token)
    payloadRead = true
  }

  const executeRoot = val(args['execute-root']) || DEFAULT_EXECUTE_ROOT
  const loaded = loadExecuteRuns(executeRoot)
  const latestRuns = selectLatestRuns(loaded.runs)
  const reconciliation = reconcileVerifiedEvents(works, loaded.runs)
  const byStatus = countBy(reconciliation.map((row) => row.status))
  const incompleteRuns = loaded.runs.filter((run) => (
    run.stoppedAfterFailure
    || run.staticBlockers.length
    || run.gateBlockers.length
    || run.drifted > 0
    || run.appliedAndVerified !== run.appliedFileRows
  ))

  const runId = `${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${process.pid}`
  const outDir = val(args['out-dir']) || path.join(DEFAULT_OUT_ROOT, runId)
  if (fs.existsSync(outDir)) throw new Error(`Output directory already exists: ${outDir}`)

  const outputs = {
    summary: path.join(outDir, 'summary.json'),
    all: path.join(outDir, 'reconciliation-all.jsonl'),
    currentMatches: path.join(outDir, 'current-matches-v06.jsonl'),
    currentMissing: path.join(outDir, 'current-missing-after-verified-apply.jsonl'),
    currentDiverged: path.join(outDir, 'current-diverged-from-v06.jsonl'),
    workMissing: path.join(outDir, 'work-or-plan-missing.jsonl'),
    latestRuns: path.join(outDir, 'latest-execute-run-per-batch.json'),
    allRuns: path.join(outDir, 'all-execute-runs.json'),
    incompleteRuns: path.join(outDir, 'incomplete-or-inconsistent-runs.json'),
    issues: path.join(outDir, 'artifact-integrity-issues.json'),
  }

  const matchStatuses = new Set(['current_matches_v06_exact', 'current_matches_v06_identity_fields'])
  const missingStatuses = new Set(['current_missing_after_verified_apply', 'current_scanned_without_valid_conclusion'])
  const missingObjectStatuses = new Set(['work_missing', 'plan_missing', 'plan_missing_radar_assessment'])

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    sources: {
      works: worksFile || baseUrl,
      executeRoot,
    },
    worksRead: works.length,
    executeSummaryFiles: loaded.runs.length,
    executeBatchesObserved: new Set(loaded.runs.map((run) => run.batchId).filter(Boolean)).size,
    latestExecuteRuns: latestRuns.length,
    allRunsPayloadPatchRequests: loaded.runs.reduce((sum, run) => sum + run.payloadPatchRequests, 0),
    latestRunsPayloadPatchRequests: latestRuns.reduce((sum, run) => sum + run.payloadPatchRequests, 0),
    latestRunsAppliedAndVerified: latestRuns.reduce((sum, run) => sum + run.appliedAndVerified, 0),
    latestRunsCompletedAfterRun: latestRuns.reduce((sum, run) => sum + run.completedAfterRun, 0),
    uniqueWorksWithVerifiedApplyEvidence: reconciliation.length,
    byCurrentReconciliationStatus: byStatus,
    currentMatchesV06: reconciliation.filter((row) => matchStatuses.has(row.status)).length,
    currentMissingAfterVerifiedApply: reconciliation.filter((row) => missingStatuses.has(row.status)).length,
    currentHasOtherFormalConclusion: reconciliation.filter((row) => row.status === 'current_has_other_formal_conclusion').length,
    workOrPlanMissing: reconciliation.filter((row) => missingObjectStatuses.has(row.status)).length,
    incompleteOrInconsistentRuns: incompleteRuns.length,
    artifactIntegrityIssues: loaded.issues.length,
    outputs,
    safety: {
      payloadRead,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      restoresHistoricalData: false,
    },
    interpretation: [
      'payloadPatchRequests alone are not treated as success; applied.jsonl and per-row verified evidence are required.',
      'A current missing conclusion after verified apply is a restoration candidate, not automatic proof that the old result should be republished.',
      'Any future restoration must revalidate identity, policy compatibility, source traceability, and human-track immutability.',
    ],
  }

  writeJson(outputs.summary, summary)
  writeJsonl(outputs.all, reconciliation)
  writeJsonl(outputs.currentMatches, reconciliation.filter((row) => matchStatuses.has(row.status)))
  writeJsonl(outputs.currentMissing, reconciliation.filter((row) => missingStatuses.has(row.status)))
  writeJsonl(outputs.currentDiverged, reconciliation.filter((row) => row.status === 'current_has_other_formal_conclusion'))
  writeJsonl(outputs.workMissing, reconciliation.filter((row) => missingObjectStatuses.has(row.status)))
  writeJson(outputs.latestRuns, latestRuns.map(({ events, ...run }) => ({ ...run, eventCount: events.length })))
  writeJson(outputs.allRuns, loaded.runs.map(({ events, ...run }) => ({ ...run, eventCount: events.length })))
  writeJson(outputs.incompleteRuns, incompleteRuns.map(({ events, ...run }) => ({ ...run, eventCount: events.length })))
  writeJson(outputs.issues, loaded.issues)

  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isDirectRun) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
