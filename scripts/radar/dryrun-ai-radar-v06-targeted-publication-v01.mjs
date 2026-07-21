#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import {
  canonical,
  equal,
  humanTrackRecorded,
  payloadComparable,
  val,
} from './lib/payload-plan-v01.mjs'

const VERSION = 'ai-radar-v06-targeted-publication-dryrun-v0.1'
const PLAN_VERSION = 'ai-radar-v06-targeted-publication-plan-v0.1'
const DEFAULT_PLAN_ROOT = 'data_local/staging/ai-radar/v06-targeted-publication-plan-v01'
const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/v06-targeted-publication-dryrun-v01'
const COMPATIBILITY_FIELDS = ['rank', 'ratingNotice', 'reviewStatus', 'reviewReasons', 'evidenceStrength']
const ALLOWED_PATCH_FIELDS = new Set(['_status', 'radarAssessment', ...COMPATIBILITY_FIELDS])

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

export function targetedPublicationSha256(value) {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(canonical(value)))
    .digest('hex')
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
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

function workMap(rows) {
  const map = new Map()
  for (const row of rows) {
    const id = val(row?.id)
    if (id) map.set(id, row)
  }
  return map
}

function radarOf(work) {
  return work?.radarAssessment && typeof work.radarAssessment === 'object' ? work.radarAssessment : {}
}

function comparable(value) {
  return canonical(payloadComparable(value))
}

export function targetedPublicationPublishedState(work) {
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

export function targetedPublicationHumanState(work) {
  return canonical({
    humanAssessment: work?.humanAssessment || null,
    humanReviewNote: work?.humanReviewNote || null,
    humanReviewedAt: work?.humanReviewedAt || null,
    humanReviewedBy: work?.humanReviewedBy || null,
  })
}

export function targetedPublicationExpectations(published, latestDraft) {
  const publishedState = targetedPublicationPublishedState(published)
  const humanState = targetedPublicationHumanState(published)
  return {
    publishedState,
    publishedStateSha256: targetedPublicationSha256(publishedState),
    humanStateSha256: targetedPublicationSha256(humanState),
    latestDraftRadarSha256: targetedPublicationSha256(comparable(radarOf(latestDraft))),
  }
}

function fieldChanges(work, patch) {
  const changes = []
  for (const [key, value] of Object.entries(patch || {})) {
    if (!equal(comparable(work?.[key]), comparable(value))) changes.push(key)
  }
  return changes.sort()
}

function equalStringLists(a, b) {
  const left = [...new Set(list(a).map(val).filter(Boolean))].sort()
  const right = [...new Set(list(b).map(val).filter(Boolean))].sort()
  return equal(left, right)
}

function patchAlreadyApplied(work, patch) {
  return Object.entries(patch || {}).every(([key, value]) => equal(comparable(work?.[key]), comparable(value)))
}

export function buildTargetedPublicationDryRunRow(plan, published, latestDraft) {
  const blockers = []
  const warnings = []
  const patch = plan?.patch && typeof plan.patch === 'object' ? canonical(plan.patch) : null
  const targetId = val(plan?.target?.id || plan?.workId)

  if (val(plan?.version) !== PLAN_VERSION) blockers.push('plan_version_mismatch')
  if (val(plan?.planStatus) !== 'ready_for_publication_dry_run') blockers.push('plan_not_ready_for_publication_dry_run')
  if (list(plan?.blockers).length) blockers.push('plan_contains_blockers')
  if (!targetId) blockers.push('target_id_missing')
  if (!published) blockers.push('published_work_missing')
  if (!latestDraft) blockers.push('latest_draft_work_missing')
  if (!patch) blockers.push('publication_patch_missing')

  if (published && val(published?.id) !== targetId) blockers.push('published_target_id_mismatch')
  if (latestDraft && val(latestDraft?.id) !== targetId) blockers.push('draft_target_id_mismatch')
  if (published && val(plan?.target?.siteId) !== val(published?.siteId)) blockers.push('published_site_id_drift')
  if (latestDraft && val(plan?.target?.siteId) !== val(latestDraft?.siteId)) blockers.push('draft_site_id_drift')

  if (patch) {
    if (val(patch?._status) !== 'published') blockers.push('patch_must_publish_status')
    if (!patch?.radarAssessment || typeof patch.radarAssessment !== 'object') blockers.push('patch_radar_assessment_missing')
    if ('humanAssessment' in patch) blockers.push('human_assessment_patch_forbidden')
    for (const key of Object.keys(patch)) {
      if (!ALLOWED_PATCH_FIELDS.has(key)) blockers.push(`unexpected_patch_field:${key}`)
    }
  }

  if (plan?.wholeDraftPublicationForbidden !== true) blockers.push('whole_draft_publication_guard_missing')
  if (plan?.humanTrackPreservedByOmission !== true) blockers.push('human_track_omission_guard_missing')

  const currentHumanTrack = published ? humanTrackRecorded(published) : false
  if (published && Boolean(plan?.humanTrackRecorded) !== currentHumanTrack) blockers.push('human_track_presence_drift')
  if (currentHumanTrack && patch) {
    for (const field of COMPATIBILITY_FIELDS) {
      if (field in patch) blockers.push(`human_track_compatibility_patch_forbidden:${field}`)
    }
  }

  const currentExpectations = published && latestDraft
    ? targetedPublicationExpectations(published, latestDraft)
    : null
  const alreadyApplied = Boolean(published && patch && patchAlreadyApplied(published, patch))

  if (patch && targetedPublicationSha256(patch) !== val(plan?.patchSha256)) blockers.push('patch_sha256_mismatch')
  if (currentExpectations) {
    if (!alreadyApplied && currentExpectations.publishedStateSha256 !== val(plan?.expectedBefore?.publishedStateSha256)) {
      blockers.push('published_state_drift')
    }
    if (currentExpectations.humanStateSha256 !== val(plan?.expectedBefore?.humanStateSha256)) {
      blockers.push('human_state_drift')
    }
    if (currentExpectations.latestDraftRadarSha256 !== val(plan?.expectedBefore?.latestDraftRadarSha256)) {
      blockers.push('latest_draft_radar_drift')
    }
  }

  if (latestDraft && patch?.radarAssessment && !equal(comparable(radarOf(latestDraft)), comparable(patch.radarAssessment))) {
    blockers.push('latest_draft_radar_differs_from_patch')
  }

  const changedFields = published && patch ? fieldChanges(published, patch) : []
  if (!alreadyApplied && !equalStringLists(changedFields, plan?.changedFields)) blockers.push('changed_fields_drift')
  if (alreadyApplied && changedFields.length) blockers.push('already_applied_detection_inconsistent')

  const simulatedWork = published && patch ? { ...published, ...patch } : null
  const simulatedPublishedState = simulatedWork ? targetedPublicationPublishedState(simulatedWork) : null
  const simulatedHumanState = simulatedWork ? targetedPublicationHumanState(simulatedWork) : null
  const simulatedHumanHash = simulatedHumanState ? targetedPublicationSha256(simulatedHumanState) : ''
  const currentHumanHash = published ? targetedPublicationSha256(targetedPublicationHumanState(published)) : ''
  if (simulatedHumanHash && currentHumanHash && simulatedHumanHash !== currentHumanHash) blockers.push('simulated_human_state_changed')

  if (!alreadyApplied && changedFields.length === 0) warnings.push('ready_plan_has_no_current_changes')

  const dryRunStatus = blockers.length
    ? 'blocked'
    : alreadyApplied
      ? 'already_published'
      : 'ready_for_targeted_publication'

  return canonical({
    version: VERSION,
    dryRunStatus,
    workId: val(plan?.workId),
    target: plan?.target || null,
    source: plan?.source || null,
    patch,
    patchSha256: patch ? targetedPublicationSha256(patch) : '',
    changedFields,
    expectedBefore: plan?.expectedBefore || null,
    observedBefore: currentExpectations,
    simulatedAfter: simulatedPublishedState
      ? {
          publishedState: simulatedPublishedState,
          publishedStateSha256: targetedPublicationSha256(simulatedPublishedState),
          humanStateSha256: simulatedHumanHash,
          radarAssessmentSha256: targetedPublicationSha256(comparable(radarOf(simulatedWork))),
        }
      : null,
    humanTrackRecorded: currentHumanTrack,
    wholeDraftPublicationForbidden: true,
    payloadPatchSimulatedOnly: true,
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
    throw new Error('Targeted publication dry-run is read-only. Execute/apply/write/patch/publish/restore flags are rejected.')
  }

  const planFile = val(args['plan-file']) || newestFile(val(args['plan-root']) || DEFAULT_PLAN_ROOT, 'targeted-publication-plan.jsonl')
  if (!planFile) throw new Error('No targeted-publication-plan.jsonl was found. Run the targeted publication planner first or pass --plan-file.')
  const plans = readJsonl(planFile)

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

  const publishedById = workMap(publishedWorks)
  const draftById = workMap(latestDraftWorks)
  const rows = plans.map((plan) => {
    const targetId = val(plan?.target?.id || plan?.workId)
    return buildTargetedPublicationDryRunRow(
      plan,
      publishedById.get(targetId) || publishedById.get(val(plan?.workId)) || null,
      draftById.get(targetId) || draftById.get(val(plan?.workId)) || null,
    )
  })

  const ready = rows.filter((row) => row.dryRunStatus === 'ready_for_targeted_publication')
  const alreadyPublished = rows.filter((row) => row.dryRunStatus === 'already_published')
  const blocked = rows.filter((row) => row.dryRunStatus === 'blocked')
  const runId = `${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${process.pid}`
  const outDir = val(args['out-dir']) || path.join(DEFAULT_OUT_ROOT, runId)
  if (fs.existsSync(outDir)) throw new Error(`Output directory already exists: ${outDir}`)

  const outputs = {
    summary: path.join(outDir, 'summary.json'),
    all: path.join(outDir, 'targeted-publication-dryrun.jsonl'),
    ready: path.join(outDir, 'ready-for-targeted-publication.jsonl'),
    alreadyPublished: path.join(outDir, 'already-published.jsonl'),
    blocked: path.join(outDir, 'blocked.jsonl'),
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    sources: {
      planFile,
      planSha256: sha256File(planFile),
      publishedWorks: publishedFile || baseUrl,
      latestDraftWorks: draftFile || baseUrl,
    },
    planRowsRead: plans.length,
    publishedWorksRead: publishedWorks.length,
    latestDraftWorksRead: latestDraftWorks.length,
    dryRunRows: rows.length,
    readyForTargetedPublication: ready.length,
    alreadyPublished: alreadyPublished.length,
    blocked: blocked.length,
    byDryRunStatus: countBy(rows.map((row) => row.dryRunStatus)),
    byBlocker: countBy(blocked.flatMap((row) => row.blockers)),
    patchFieldCounts: countBy(ready.flatMap((row) => row.changedFields)),
    withHumanTrack: rows.filter((row) => row.humanTrackRecorded).length,
    outputs,
    safety: {
      payloadRead,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      publishesWholeDrafts: false,
      simulatesAllowlistedPartialPatchOnly: true,
      humanAssessmentMutation: false,
    },
    nextStep: blocked.length
      ? 'Inspect blockers and regenerate the plan. Do not arm publication.'
      : 'Review this dry-run, create a fresh database checkpoint, and validate one isolated publication before any batch release workflow is armed.',
  }

  writeJsonl(outputs.all, rows)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.alreadyPublished, alreadyPublished)
  writeJsonl(outputs.blocked, blocked)
  writeJson(outputs.summary, summary)
  console.log(JSON.stringify({ ok: blocked.length === 0, summary }, null, 2))
  if (blocked.length) process.exitCode = 2
}

const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isDirectRun) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
