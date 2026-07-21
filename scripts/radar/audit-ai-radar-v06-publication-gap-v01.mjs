#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  loadExecuteRuns,
  reconcileVerifiedEvents,
  selectLatestRuns,
} from './audit-ai-radar-v06-reconciliation-v01.mjs'

const VERSION = 'ai-radar-v06-publication-gap-v0.1'
const DEFAULT_EXECUTE_ROOT = 'data_local/staging/ai-radar/v06-batch-execute-runs-v01'
const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/v06-publication-gap-v01'
const MATCH = new Set(['current_matches_v06_exact', 'current_matches_v06_identity_fields'])
const MISSING = new Set(['current_missing_after_verified_apply', 'current_scanned_without_valid_conclusion'])
const OBJECT_MISSING = new Set(['work_missing', 'plan_missing', 'plan_missing_radar_assessment'])

function val(value) {
  return String(value ?? '').trim()
}

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

function rowMap(rows) {
  return new Map(rows.map((row) => [val(row?.workId), row]).filter(([key]) => key))
}

export function classifyPublicationGap(published, latestDraft) {
  const publishedStatus = val(published?.status)
  const draftStatus = val(latestDraft?.status)

  if (MATCH.has(publishedStatus)) return 'published_matches_v06'
  if (MATCH.has(draftStatus) && MISSING.has(publishedStatus)) return 'draft_only_v06_match'
  if (MATCH.has(draftStatus) && publishedStatus === 'current_has_other_formal_conclusion') {
    return 'draft_matches_v06_published_other_formal'
  }
  if (draftStatus === 'current_has_other_formal_conclusion') return 'latest_draft_has_other_formal_conclusion'
  if (OBJECT_MISSING.has(publishedStatus) || OBJECT_MISSING.has(draftStatus)) return 'work_or_plan_missing'
  if (MISSING.has(publishedStatus) && MISSING.has(draftStatus)) return 'missing_from_both_views'
  return 'needs_review'
}

export function buildPublicationGap(publishedWorks, latestDraftWorks, runs) {
  const publishedRows = reconcileVerifiedEvents(publishedWorks, runs)
  const draftRows = reconcileVerifiedEvents(latestDraftWorks, runs)
  const publishedByWork = rowMap(publishedRows)
  const draftByWork = rowMap(draftRows)
  const workIds = [...new Set([...publishedByWork.keys(), ...draftByWork.keys()])].sort()

  const rows = workIds.map((workId) => {
    const published = publishedByWork.get(workId) || null
    const latestDraft = draftByWork.get(workId) || null
    const status = classifyPublicationGap(published, latestDraft)
    return {
      status,
      workId,
      targetId: val(latestDraft?.targetId || published?.targetId),
      siteId: val(latestDraft?.siteId || published?.siteId),
      title: val(latestDraft?.title || published?.title),
      batchId: val(latestDraft?.batchId || published?.batchId),
      publishedStatus: val(published?.status),
      publishedSuggestedGrade: val(published?.currentSuggestedGrade),
      publishedPolicyVersion: val(published?.currentPolicyVersion),
      publishedAssessmentBatch: val(published?.currentAssessmentBatch),
      latestDraftStatus: val(latestDraft?.status),
      latestDraftSuggestedGrade: val(latestDraft?.currentSuggestedGrade),
      latestDraftPolicyVersion: val(latestDraft?.currentPolicyVersion),
      latestDraftAssessmentBatch: val(latestDraft?.currentAssessmentBatch),
      expectedSuggestedGrade: val(latestDraft?.expectedSuggestedGrade || published?.expectedSuggestedGrade),
      expectedPolicyVersion: val(latestDraft?.expectedPolicyVersion || published?.expectedPolicyVersion),
      expectedAssessmentBatch: val(latestDraft?.expectedAssessmentBatch || published?.expectedAssessmentBatch),
      humanAssessmentPresent: latestDraft?.humanAssessmentPresent === true || published?.humanAssessmentPresent === true,
    }
  })

  return {
    rows,
    publishedRows,
    draftRows,
    byStatus: countBy(rows.map((row) => row.status)),
  }
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
    throw new Error('v0.6 publication gap audit is read-only. Execute/apply/write/patch/publish/restore flags are rejected.')
  }

  const baseUrl = val(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const email = val(process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.SITE_OWNER_EMAIL)
  const password = val(process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD)
  if (!email || !password) throw new Error('Payload credentials are required.')

  const token = await login(baseUrl, email, password)
  const publishedWorks = await readWorks(baseUrl, token, { draft: false })
  const latestDraftWorks = await readWorks(baseUrl, token, { draft: true })
  const executeRoot = val(args['execute-root']) || DEFAULT_EXECUTE_ROOT
  const loaded = loadExecuteRuns(executeRoot)
  const latestRuns = selectLatestRuns(loaded.runs)
  const result = buildPublicationGap(publishedWorks, latestDraftWorks, loaded.runs)

  const runId = `${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${process.pid}`
  const outDir = val(args['out-dir']) || path.join(DEFAULT_OUT_ROOT, runId)
  if (fs.existsSync(outDir)) throw new Error(`Output directory already exists: ${outDir}`)

  const outputs = {
    summary: path.join(outDir, 'summary.json'),
    all: path.join(outDir, 'publication-gap-all.jsonl'),
    draftOnly: path.join(outDir, 'draft-only-v06-match.jsonl'),
    publishedMatches: path.join(outDir, 'published-matches-v06.jsonl'),
    otherFormal: path.join(outDir, 'other-formal-conclusions.jsonl'),
    needsReview: path.join(outDir, 'needs-review.jsonl'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    sources: { baseUrl, executeRoot },
    publishedWorksRead: publishedWorks.length,
    latestDraftWorksRead: latestDraftWorks.length,
    executeSummaryFiles: loaded.runs.length,
    latestExecuteRuns: latestRuns.length,
    uniqueWorksWithVerifiedApplyEvidence: result.rows.length,
    byPublicationGapStatus: result.byStatus,
    publishedMatchesV06: result.rows.filter((row) => row.status === 'published_matches_v06').length,
    draftOnlyV06Matches: result.rows.filter((row) => row.status === 'draft_only_v06_match').length,
    draftMatchesV06PublishedOtherFormal: result.rows.filter((row) => row.status === 'draft_matches_v06_published_other_formal').length,
    latestDraftHasOtherFormalConclusion: result.rows.filter((row) => row.status === 'latest_draft_has_other_formal_conclusion').length,
    missingFromBothViews: result.rows.filter((row) => row.status === 'missing_from_both_views').length,
    workOrPlanMissing: result.rows.filter((row) => row.status === 'work_or_plan_missing').length,
    needsReview: result.rows.filter((row) => row.status === 'needs_review').length,
    artifactIntegrityIssues: loaded.issues.length,
    outputs,
    safety: {
      payloadRead: true,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      publishesDrafts: false,
    },
    interpretation: [
      'The standard Works read represents the published/main collection view.',
      'The draft=true read represents the latest version from the versions table.',
      'draft_only_v06_match means the verified v0.6 result exists in the latest draft but is absent from the published view.',
      'This audit does not prove that whole-document draft publication is safe; a later plan must isolate AI fields and preserve human and unrelated content.',
    ],
  }

  writeJson(outputs.summary, summary)
  writeJsonl(outputs.all, result.rows)
  writeJsonl(outputs.draftOnly, result.rows.filter((row) => row.status === 'draft_only_v06_match'))
  writeJsonl(outputs.publishedMatches, result.rows.filter((row) => row.status === 'published_matches_v06'))
  writeJsonl(outputs.otherFormal, result.rows.filter((row) => ['draft_matches_v06_published_other_formal', 'latest_draft_has_other_formal_conclusion'].includes(row.status)))
  writeJsonl(outputs.needsReview, result.rows.filter((row) => ['missing_from_both_views', 'work_or_plan_missing', 'needs_review'].includes(row.status)))

  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isDirectRun) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
