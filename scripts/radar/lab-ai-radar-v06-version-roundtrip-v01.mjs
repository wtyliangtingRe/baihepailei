#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  ALLOWED_PATCH_FIELDS,
  readJson,
  unique,
  validateReadyDryRunRow,
  writeJson,
} from './lib/v06-single-targeted-publication-v01.mjs'

const VERSION = 'ai-radar-v06-version-roundtrip-lab-v0.1'
const CONFIRMATION = 'EXECUTE-V06-VERSION-ROUNDTRIP-LAB-ONLY'
const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/v06-version-roundtrip-lab-v01'
const ROOT_VOLATILE_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'publishedAt'])

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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    )
  }
  return value
}

function normalizeDateString(value) {
  if (typeof value !== 'string') return value
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(value)) return value
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : value
}

export function normalizePayloadValue(value, { root = false } = {}) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizePayloadValue(item))
  }
  if (value && typeof value === 'object') {
    const entries = []
    for (const key of Object.keys(value).sort()) {
      if (root && ROOT_VOLATILE_FIELDS.has(key)) continue
      if (!root && key === 'id') continue
      const normalized = normalizePayloadValue(value[key])
      if (normalized !== undefined) entries.push([key, normalized])
    }
    return Object.fromEntries(entries)
  }
  return normalizeDateString(value)
}

export function normalizedDocumentState(document) {
  return canonical(normalizePayloadValue(document || {}, { root: true }))
}

export function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(canonical(value)))
    .digest('hex')
}

function equal(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

function parentId(versionRow) {
  if (typeof versionRow?.parent === 'string' || typeof versionRow?.parent === 'number') return val(versionRow.parent)
  return val(versionRow?.parent?.id || versionRow?.parent?.value)
}

export function matchingVersions(versionRows, document) {
  const expected = normalizedDocumentState(document)
  return list(versionRows)
    .filter((row) => equal(normalizedDocumentState(row?.version), expected))
    .sort((a, b) => Date.parse(val(b?.createdAt)) - Date.parse(val(a?.createdAt)))
}

export function unrelatedPublishedState(document, patch) {
  const excluded = new Set([...Object.keys(patch || {}), ...ROOT_VOLATILE_FIELDS])
  return canonical(normalizePayloadValue(Object.fromEntries(
    Object.entries(document || {}).filter(([key]) => !excluded.has(key)),
  )))
}

function humanState(document) {
  return canonical(normalizePayloadValue({
    humanAssessment: document?.humanAssessment || null,
    humanReviewNote: document?.humanReviewNote || null,
    humanReviewedAt: document?.humanReviewedAt || null,
    humanReviewedBy: document?.humanReviewedBy || null,
  }))
}

function patchMatches(document, patch) {
  return Object.entries(patch || {}).every(([key, value]) => (
    equal(normalizePayloadValue(document?.[key]), normalizePayloadValue(value))
  ))
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 1200)}`)
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

async function readWork(baseUrl, token, id, { draft = false } = {}) {
  const params = new URLSearchParams({ depth: '0' })
  if (draft) params.set('draft', 'true')
  return requestJson(`${baseUrl}/api/works/${encodeURIComponent(id)}?${params}`, {
    headers: { authorization: `JWT ${token}` },
  })
}

async function readVersions(baseUrl, token, id) {
  const rows = []
  let page = 1
  while (true) {
    const params = new URLSearchParams({
      depth: '0',
      limit: '100',
      page: String(page),
      sort: '-createdAt',
      'where[parent][equals]': id,
    })
    const body = await requestJson(`${baseUrl}/api/works/versions?${params}`, {
      headers: { authorization: `JWT ${token}` },
    })
    const docs = list(body?.docs).filter((row) => parentId(row) === id)
    rows.push(...docs)
    if (!body?.hasNextPage || docs.length === 0) break
    page += 1
  }
  return rows
}

async function restoreVersion(baseUrl, token, versionId) {
  return requestJson(`${baseUrl}/api/works/versions/${encodeURIComponent(versionId)}?depth=0`, {
    method: 'POST',
    headers: { authorization: `JWT ${token}` },
    body: '{}',
  })
}

async function publishPatch(baseUrl, token, targetId, patch) {
  return requestJson(`${baseUrl}/api/works/${encodeURIComponent(targetId)}?draft=false&depth=0`, {
    method: 'PATCH',
    headers: { authorization: `JWT ${token}` },
    body: JSON.stringify(patch),
  })
}

function validateLabUrl(baseUrl) {
  const url = new URL(baseUrl)
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  const blockers = []
  if (!local) blockers.push('lab_url_must_be_loopback')
  if (port !== 3100) blockers.push('lab_url_must_use_port_3100')
  return blockers
}

function validateProof(proof, candidate, baseUrl, labDatabase) {
  const blockers = []
  if (val(proof?.version) !== 'ai-radar-v06-lab-database-proof-v0.1') blockers.push('lab_proof_version_mismatch')
  if (val(proof?.serverUrl).replace(/\/+$/u, '') !== baseUrl) blockers.push('lab_proof_server_url_mismatch')
  if (val(proof?.databaseName) !== labDatabase) blockers.push('lab_proof_database_name_mismatch')
  if (!/^baihepailei_radar_lab_[a-z0-9_]+$/u.test(labDatabase)) blockers.push('lab_database_name_invalid')
  if (val(proof?.mainDatabase) !== 'baihepailei') blockers.push('lab_proof_main_database_mismatch')
  if (Number(proof?.mainDatabaseConnections) !== 0) blockers.push('lab_main_database_has_connections')
  if (Number(proof?.labDatabaseConnections) < 1) blockers.push('lab_database_has_no_server_connection')
  if (val(proof?.sourceDumpSha256).toLowerCase() !== val(candidate?.files?.checkpointDump?.sha256).toLowerCase()) blockers.push('lab_proof_dump_hash_mismatch')
  const generatedAt = Date.parse(val(proof?.generatedAt))
  if (!Number.isFinite(generatedAt) || Date.now() - generatedAt > 30 * 60 * 1000 || generatedAt > Date.now() + 60_000) {
    blockers.push('lab_proof_expired_or_invalid')
  }
  return blockers
}

function validateCandidate(candidate) {
  const blockers = []
  blockers.push(...validateReadyDryRunRow(candidate?.sourceDryRunRow))
  const patch = candidate?.expected?.patch
  if (!patch || typeof patch !== 'object') blockers.push('lab_candidate_patch_missing')
  if (patch) {
    for (const key of Object.keys(patch)) {
      if (!ALLOWED_PATCH_FIELDS.has(key)) blockers.push(`lab_candidate_unexpected_patch_field:${key}`)
    }
    if (val(patch?._status) !== 'published') blockers.push('lab_candidate_status_must_be_published')
    if ('humanAssessment' in patch) blockers.push('lab_candidate_human_assessment_forbidden')
  }
  return unique(blockers)
}

function writeEvidence(file, value) {
  writeJson(file, value)
}

export async function runLab(options) {
  const {
    baseUrl,
    candidate,
    candidateManifestFile,
    email,
    execute,
    labDatabase,
    password,
    proof,
    proofFile,
  } = options
  const targetId = val(candidate?.target?.id)
  const patch = candidate?.expected?.patch || {}
  const blockers = unique([
    ...validateLabUrl(baseUrl),
    ...validateCandidate(candidate),
    ...(execute ? validateProof(proof, candidate, baseUrl, labDatabase) : []),
  ])
  if (blockers.length) throw new Error(`Version roundtrip lab blocked: ${blockers.join(', ')}`)

  const token = await login(baseUrl, email, password)
  const publishedBefore = await readWork(baseUrl, token, targetId)
  const draftBefore = await readWork(baseUrl, token, targetId, { draft: true })
  const versionsBefore = await readVersions(baseUrl, token, targetId)
  const publishedMatches = matchingVersions(versionsBefore, publishedBefore)
  const draftMatches = matchingVersions(versionsBefore, draftBefore)
  const publishedVersion = publishedMatches[0] || null
  const draftVersion = draftMatches[0] || null
  const discoveryBlockers = unique([
    ...(val(publishedBefore?.id) !== targetId ? ['lab_published_target_mismatch'] : []),
    ...(val(draftBefore?.id) !== targetId ? ['lab_draft_target_mismatch'] : []),
    ...(publishedMatches.length < 1 ? ['lab_matching_published_version_missing'] : []),
    ...(draftMatches.length < 1 ? ['lab_matching_draft_version_missing'] : []),
    ...(!publishedVersion?.id ? ['lab_published_version_id_missing'] : []),
    ...(!draftVersion?.id ? ['lab_draft_version_id_missing'] : []),
  ])

  const baseline = {
    publishedStateSha256: sha256(normalizedDocumentState(publishedBefore)),
    draftStateSha256: sha256(normalizedDocumentState(draftBefore)),
    unrelatedPublishedStateSha256: sha256(unrelatedPublishedState(publishedBefore, patch)),
    humanStateSha256: sha256(humanState(publishedBefore)),
    publishedVersionId: val(publishedVersion?.id),
    originalDraftVersionId: val(draftVersion?.id),
  }

  const runId = `${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${targetId}-${process.pid}`
  const outDir = path.join(DEFAULT_OUT_ROOT, runId)
  const outputs = {
    summary: path.join(outDir, 'summary.json'),
    discovery: path.join(outDir, 'discovery.json'),
    afterPublishedRestore: path.join(outDir, 'after-published-version-restore.json'),
    afterRadarPublish: path.join(outDir, 'after-radar-publish.json'),
    final: path.join(outDir, 'final-after-draft-restore.json'),
  }
  writeEvidence(outputs.discovery, {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    candidateManifestFile,
    proofFile: proofFile || null,
    target: candidate.target,
    baseUrl,
    labDatabase: labDatabase || null,
    execute,
    versionsRead: versionsBefore.length,
    matchingPublishedVersions: publishedMatches.map((row) => ({ id: val(row?.id), createdAt: val(row?.createdAt) })),
    matchingDraftVersions: draftMatches.map((row) => ({ id: val(row?.id), createdAt: val(row?.createdAt) })),
    blockers: discoveryBlockers,
    baseline,
  })

  if (discoveryBlockers.length) {
    const summary = {
      ok: false,
      status: 'blocked_during_version_discovery',
      blockers: discoveryBlockers,
      target: candidate.target,
      outputs,
      safety: { payloadReads: true, payloadWrites: false, payloadWriteRequests: 0, mainDatabaseTargeted: false },
    }
    writeEvidence(outputs.summary, summary)
    return summary
  }

  if (!execute) {
    const summary = {
      ok: true,
      status: 'inspect_ready_for_lab_execution',
      target: candidate.target,
      versionsRead: versionsBefore.length,
      baseline,
      outputs,
      safety: { payloadReads: true, payloadWrites: false, payloadWriteRequests: 0, mainDatabaseTargeted: false },
    }
    writeEvidence(outputs.summary, summary)
    return summary
  }

  let payloadWriteRequests = 0

  payloadWriteRequests += 1
  await restoreVersion(baseUrl, token, val(publishedVersion.id))
  const publishedAfterRestore = await readWork(baseUrl, token, targetId)
  const draftAfterRestore = await readWork(baseUrl, token, targetId, { draft: true })
  const afterRestore = {
    publishedStateSha256: sha256(normalizedDocumentState(publishedAfterRestore)),
    draftStateSha256: sha256(normalizedDocumentState(draftAfterRestore)),
    unrelatedPublishedStateSha256: sha256(unrelatedPublishedState(publishedAfterRestore, patch)),
    humanStateSha256: sha256(humanState(publishedAfterRestore)),
  }
  const afterRestoreBlockers = unique([
    ...(afterRestore.publishedStateSha256 !== baseline.publishedStateSha256 ? ['lab_restore_published_version_changed_main'] : []),
    ...(afterRestore.draftStateSha256 !== baseline.publishedStateSha256 ? ['lab_restore_published_version_did_not_become_clean_latest'] : []),
    ...(afterRestore.humanStateSha256 !== baseline.humanStateSha256 ? ['lab_restore_published_version_changed_human_state'] : []),
  ])
  writeEvidence(outputs.afterPublishedRestore, { generatedAt: new Date().toISOString(), afterRestore, blockers: afterRestoreBlockers })
  if (afterRestoreBlockers.length) throw new Error(`Lab published-version restore failed: ${afterRestoreBlockers.join(', ')}`)

  payloadWriteRequests += 1
  await publishPatch(baseUrl, token, targetId, patch)
  const publishedAfterRadar = await readWork(baseUrl, token, targetId)
  const draftAfterRadar = await readWork(baseUrl, token, targetId, { draft: true })
  const afterRadar = {
    publishedStateSha256: sha256(normalizedDocumentState(publishedAfterRadar)),
    draftStateSha256: sha256(normalizedDocumentState(draftAfterRadar)),
    unrelatedPublishedStateSha256: sha256(unrelatedPublishedState(publishedAfterRadar, patch)),
    humanStateSha256: sha256(humanState(publishedAfterRadar)),
    patchMatched: patchMatches(publishedAfterRadar, patch),
  }
  const afterRadarBlockers = unique([
    ...(!afterRadar.patchMatched ? ['lab_radar_patch_not_present_in_published'] : []),
    ...(afterRadar.unrelatedPublishedStateSha256 !== baseline.unrelatedPublishedStateSha256 ? ['lab_radar_publish_changed_unrelated_published_state'] : []),
    ...(afterRadar.humanStateSha256 !== baseline.humanStateSha256 ? ['lab_radar_publish_changed_human_state'] : []),
  ])
  writeEvidence(outputs.afterRadarPublish, { generatedAt: new Date().toISOString(), afterRadar, blockers: afterRadarBlockers })
  if (afterRadarBlockers.length) throw new Error(`Lab Radar publication failed: ${afterRadarBlockers.join(', ')}`)

  payloadWriteRequests += 1
  await restoreVersion(baseUrl, token, val(draftVersion.id))
  const publishedFinal = await readWork(baseUrl, token, targetId)
  const draftFinal = await readWork(baseUrl, token, targetId, { draft: true })
  const final = {
    publishedStateSha256: sha256(normalizedDocumentState(publishedFinal)),
    draftStateSha256: sha256(normalizedDocumentState(draftFinal)),
    unrelatedPublishedStateSha256: sha256(unrelatedPublishedState(publishedFinal, patch)),
    humanStateSha256: sha256(humanState(publishedFinal)),
    patchMatched: patchMatches(publishedFinal, patch),
  }
  const finalBlockers = unique([
    ...(!final.patchMatched ? ['lab_final_published_lost_radar_patch'] : []),
    ...(final.unrelatedPublishedStateSha256 !== baseline.unrelatedPublishedStateSha256 ? ['lab_final_unrelated_published_state_changed'] : []),
    ...(final.humanStateSha256 !== baseline.humanStateSha256 ? ['lab_final_human_state_changed'] : []),
    ...(final.draftStateSha256 !== baseline.draftStateSha256 ? ['lab_original_latest_draft_not_restored'] : []),
    ...(final.publishedStateSha256 !== afterRadar.publishedStateSha256 ? ['lab_restoring_original_draft_changed_published_main'] : []),
  ])
  writeEvidence(outputs.final, { generatedAt: new Date().toISOString(), final, blockers: finalBlockers })

  const summary = {
    ok: finalBlockers.length === 0,
    status: finalBlockers.length ? 'version_roundtrip_lab_failed' : 'version_roundtrip_lab_verified',
    blockers: finalBlockers,
    target: candidate.target,
    labDatabase,
    baseUrl,
    baseline,
    afterRestore,
    afterRadar,
    final,
    payloadWriteRequests,
    outputs,
    safety: {
      payloadReads: true,
      payloadWrites: true,
      payloadWriteRequests,
      expectedMaximumWriteRequests: 3,
      mainDatabaseTargeted: false,
      requiresLoopbackPort3100: true,
      requiresFreshDatabaseProof: true,
      directPostgresqlWrite: false,
      wholeDraftBodySentByThisScript: false,
    },
  }
  writeEvidence(outputs.summary, summary)
  return summary
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const execute = args['execute-lab'] === true
  if (args.execute || args.apply || args.write || args.patch || args.publish || args.confirm || args.limit) {
    throw new Error('Legacy execute/apply/write/publish flags and --limit are rejected.')
  }
  const candidateManifestFile = val(args['candidate-manifest'])
  if (!candidateManifestFile || !fs.existsSync(candidateManifestFile)) throw new Error('--candidate-manifest is required and must exist')
  const candidate = readJson(candidateManifestFile)
  const baseUrl = val(args.url || 'http://127.0.0.1:3100').replace(/\/+$/u, '')
  const labDatabase = val(args['lab-database'])
  const proofFile = val(args['database-proof'])
  const proof = proofFile && fs.existsSync(proofFile) ? readJson(proofFile) : null
  const email = val(process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.SITE_OWNER_EMAIL)
  const password = val(process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD)
  if (!email || !password) throw new Error('Payload credentials are required.')

  if (execute) {
    if (process.env.RADAR_VERSION_ROUNDTRIP_LAB !== 'YES') throw new Error('RADAR_VERSION_ROUNDTRIP_LAB=YES is required for lab execution.')
    if (!labDatabase) throw new Error('--lab-database is required for lab execution.')
    if (!proofFile || !proof) throw new Error('--database-proof is required for lab execution.')
    if (val(args.confirmation) !== CONFIRMATION) throw new Error(`--confirmation ${CONFIRMATION} is required.`)
  }

  const summary = await runLab({
    baseUrl,
    candidate,
    candidateManifestFile,
    email,
    execute,
    labDatabase,
    password,
    proof,
    proofFile,
  })
  console.log(JSON.stringify(summary, null, 2))
  if (!summary.ok) process.exitCode = 2
}

const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isDirectRun) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
