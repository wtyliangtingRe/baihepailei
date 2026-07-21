#!/usr/bin/env node
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
import {
  normalizePayloadValue,
  normalizedDocumentState,
  sha256,
  unrelatedPublishedState,
} from './lab-ai-radar-v06-version-roundtrip-v01.mjs'
import {
  matchingExactVersions,
  matchingPublishedBaselineVersions,
  normalizedDocumentStateIgnoringRootStatus,
} from './lab-ai-radar-v06-version-roundtrip-v02.mjs'

const VERSION = 'ai-radar-v06-draft-restore-roundtrip-lab-v0.5'
const CONFIRMATION = 'EXECUTE-V06-DRAFT-RESTORE-ROUNDTRIP-LAB-V05-ONLY'
const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/v06-draft-restore-roundtrip-lab-v05'

function val(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return Array.isArray(value) ? value : []
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

function equal(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
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

function parentId(versionRow) {
  if (typeof versionRow?.parent === 'string' || typeof versionRow?.parent === 'number') return val(versionRow.parent)
  return val(versionRow?.parent?.id || versionRow?.parent?.value)
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

function stateSnapshot(document, patch) {
  return {
    stateSha256: sha256(normalizedDocumentState(document)),
    stateIgnoringRootStatusSha256: sha256(normalizedDocumentStateIgnoringRootStatus(document)),
    unrelatedStateSha256: sha256(unrelatedPublishedState(document, patch)),
    humanStateSha256: sha256(humanState(document)),
    status: val(document?._status),
  }
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

export async function restoreVersionAsDraft(baseUrl, token, versionId) {
  return requestJson(
    `${baseUrl}/api/works/versions/${encodeURIComponent(versionId)}?draft=true&depth=0`,
    {
      method: 'POST',
      headers: { authorization: `JWT ${token}` },
      body: '{}',
    },
  )
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
  return unique([
    ...(!local ? ['lab_url_must_be_loopback'] : []),
    ...(port !== 3100 ? ['lab_url_must_use_port_3100'] : []),
  ])
}

function validateCandidate(candidate) {
  const blockers = [...validateReadyDryRunRow(candidate?.sourceDryRunRow)]
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

function validateProof(proof, candidate, baseUrl, labDatabase) {
  const blockers = []
  if (val(proof?.version) !== 'ai-radar-v06-lab-database-proof-v0.1') blockers.push('lab_proof_version_mismatch')
  if (val(proof?.serverUrl).replace(/\/+$/u, '') !== baseUrl) blockers.push('lab_proof_server_url_mismatch')
  if (val(proof?.databaseName) !== labDatabase) blockers.push('lab_proof_database_name_mismatch')
  if (!/^baihepailei_radar_lab_[a-z0-9_]+$/u.test(labDatabase)) blockers.push('lab_database_name_invalid')
  if (val(proof?.mainDatabase) !== 'baihepailei') blockers.push('lab_proof_main_database_mismatch')
  if (Number(proof?.mainDatabaseConnections) !== 0) blockers.push('lab_main_database_has_connections')
  if (Number(proof?.labDatabaseConnections) < 1) blockers.push('lab_database_has_no_server_connection')
  if (val(proof?.sourceDumpSha256).toLowerCase() !== val(candidate?.files?.checkpointDump?.sha256).toLowerCase()) {
    blockers.push('lab_proof_dump_hash_mismatch')
  }
  const generatedAt = Date.parse(val(proof?.generatedAt))
  if (!Number.isFinite(generatedAt) || Date.now() - generatedAt > 30 * 60 * 1000 || generatedAt > Date.now() + 60_000) {
    blockers.push('lab_proof_expired_or_invalid')
  }
  return unique(blockers)
}

function writeEvidence(file, value) {
  writeJson(file, value)
}

export async function runLabV05(options) {
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
  const initialBlockers = unique([
    ...validateLabUrl(baseUrl),
    ...validateCandidate(candidate),
    ...(execute ? validateProof(proof, candidate, baseUrl, labDatabase) : []),
  ])
  if (initialBlockers.length) throw new Error(`Draft restore roundtrip lab v0.5 blocked: ${initialBlockers.join(', ')}`)

  const token = await login(baseUrl, email, password)
  const publishedBefore = await readWork(baseUrl, token, targetId)
  const draftBefore = await readWork(baseUrl, token, targetId, { draft: true })
  const versionsBefore = await readVersions(baseUrl, token, targetId)

  const publishedMatches = matchingPublishedBaselineVersions(versionsBefore, publishedBefore)
  const draftMatches = matchingExactVersions(versionsBefore, draftBefore)
  const publishedVersion = publishedMatches[0] || null
  const originalDraftVersion = draftMatches[0] || null

  const baseline = {
    published: stateSnapshot(publishedBefore, patch),
    draft: stateSnapshot(draftBefore, patch),
    cleanPublishedContentVersionId: val(publishedVersion?.id),
    originalDraftVersionId: val(originalDraftVersion?.id),
  }

  const discoveryBlockers = unique([
    ...(val(publishedBefore?.id) !== targetId ? ['lab_published_target_mismatch'] : []),
    ...(val(draftBefore?.id) !== targetId ? ['lab_draft_target_mismatch'] : []),
    ...(publishedMatches.length < 1 ? ['lab_status_only_published_baseline_version_missing'] : []),
    ...(draftMatches.length < 1 ? ['lab_matching_original_draft_version_missing'] : []),
    ...(!publishedVersion?.id ? ['lab_clean_published_content_version_id_missing'] : []),
    ...(!originalDraftVersion?.id ? ['lab_original_draft_version_id_missing'] : []),
    ...(baseline.published.status !== 'published' ? ['lab_baseline_main_status_not_published'] : []),
    ...(baseline.draft.status !== 'draft' ? ['lab_baseline_latest_status_not_draft'] : []),
  ])

  const runId = `${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${targetId}-${process.pid}`
  const outDir = path.join(DEFAULT_OUT_ROOT, runId)
  const outputs = {
    summary: path.join(outDir, 'summary.json'),
    discovery: path.join(outDir, 'discovery.json'),
    afterCleanDraftRestore: path.join(outDir, 'after-clean-draft-restore.json'),
    afterRadarPublish: path.join(outDir, 'after-radar-publish.json'),
    final: path.join(outDir, 'final-after-original-draft-restore.json'),
  }

  writeEvidence(outputs.discovery, {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    target: candidate.target,
    baseUrl,
    labDatabase: labDatabase || null,
    candidateManifestFile,
    proofFile: proofFile || null,
    execute,
    versionsRead: versionsBefore.length,
    matchingPublishedBaselineVersions: publishedMatches.map((row) => ({
      id: val(row?.id),
      createdAt: val(row?.createdAt),
      status: val(row?.version?._status),
    })),
    matchingOriginalDraftVersions: draftMatches.map((row) => ({
      id: val(row?.id),
      createdAt: val(row?.createdAt),
      status: val(row?.version?._status),
    })),
    blockers: discoveryBlockers,
    baseline,
  })

  if (discoveryBlockers.length) {
    const summary = {
      ok: false,
      status: 'blocked_during_draft_restore_discovery',
      blockers: discoveryBlockers,
      target: candidate.target,
      outputs,
      safety: {
        payloadReads: true,
        payloadWrites: false,
        payloadWriteRequests: 0,
        mainDatabaseTargeted: false,
      },
    }
    writeEvidence(outputs.summary, summary)
    return summary
  }

  if (!execute) {
    const summary = {
      ok: true,
      status: 'inspect_ready_for_draft_restore_lab_execution',
      target: candidate.target,
      versionsRead: versionsBefore.length,
      baseline,
      outputs,
      safety: {
        payloadReads: true,
        payloadWrites: false,
        payloadWriteRequests: 0,
        mainDatabaseTargeted: false,
        restoreAsDraftRequestsPlanned: 2,
        partialPublishedPatchPlanned: 1,
        localApiRestoreUsed: false,
      },
    }
    writeEvidence(outputs.summary, summary)
    return summary
  }

  let payloadWriteRequests = 0
  const failStage = (status, blockers, extra = {}) => {
    writeEvidence(outputs.summary, {
      ok: false,
      status,
      blockers,
      target: candidate.target,
      labDatabase,
      baseUrl,
      baseline,
      payloadWriteRequests,
      outputs,
      ...extra,
      safety: {
        payloadReads: true,
        payloadWrites: payloadWriteRequests > 0,
        payloadWriteRequests,
        expectedMaximumWriteRequests: 3,
        mainDatabaseTargeted: false,
        directPostgresqlWrite: false,
        restoreAsDraftRequests: payloadWriteRequests >= 1 ? 1 : 0,
        partialPublishedPatchRequests: payloadWriteRequests >= 2 ? 1 : 0,
        localApiRestoreUsed: false,
      },
    })
  }

  payloadWriteRequests += 1
  await restoreVersionAsDraft(baseUrl, token, val(publishedVersion.id))
  const publishedAfterCleanDraftRestore = await readWork(baseUrl, token, targetId)
  const draftAfterCleanDraftRestore = await readWork(baseUrl, token, targetId, { draft: true })
  const afterCleanDraftRestore = {
    published: stateSnapshot(publishedAfterCleanDraftRestore, patch),
    draft: stateSnapshot(draftAfterCleanDraftRestore, patch),
  }
  const cleanDraftBlockers = unique([
    ...(afterCleanDraftRestore.published.stateSha256 !== baseline.published.stateSha256
      ? ['lab_clean_draft_restore_changed_published_main'] : []),
    ...(afterCleanDraftRestore.draft.stateIgnoringRootStatusSha256 !== baseline.published.stateIgnoringRootStatusSha256
      ? ['lab_clean_draft_restore_content_not_equal_published_content'] : []),
    ...(afterCleanDraftRestore.draft.status !== 'draft'
      ? ['lab_clean_draft_restore_status_not_draft'] : []),
    ...(afterCleanDraftRestore.draft.unrelatedStateSha256 !== baseline.published.unrelatedStateSha256
      ? ['lab_clean_draft_restore_changed_unrelated_state'] : []),
    ...(afterCleanDraftRestore.draft.humanStateSha256 !== baseline.published.humanStateSha256
      ? ['lab_clean_draft_restore_changed_human_state'] : []),
  ])
  writeEvidence(outputs.afterCleanDraftRestore, {
    generatedAt: new Date().toISOString(),
    afterCleanDraftRestore,
    blockers: cleanDraftBlockers,
    payloadWriteRequests,
  })
  if (cleanDraftBlockers.length) {
    failStage('draft_restore_clean_baseline_failed', cleanDraftBlockers, { afterCleanDraftRestore })
    throw new Error(`Lab clean draft restore failed: ${cleanDraftBlockers.join(', ')}`)
  }

  payloadWriteRequests += 1
  await publishPatch(baseUrl, token, targetId, patch)
  const publishedAfterRadar = await readWork(baseUrl, token, targetId)
  const draftAfterRadar = await readWork(baseUrl, token, targetId, { draft: true })
  const afterRadar = {
    published: stateSnapshot(publishedAfterRadar, patch),
    draft: stateSnapshot(draftAfterRadar, patch),
    patchMatchedPublished: patchMatches(publishedAfterRadar, patch),
    patchMatchedLatestVersion: patchMatches(draftAfterRadar, patch),
  }
  const afterRadarBlockers = unique([
    ...(!afterRadar.patchMatchedPublished ? ['lab_radar_patch_not_present_in_published'] : []),
    ...(!afterRadar.patchMatchedLatestVersion ? ['lab_radar_patch_not_present_in_latest_version'] : []),
    ...(afterRadar.published.unrelatedStateSha256 !== baseline.published.unrelatedStateSha256
      ? ['lab_radar_publish_changed_unrelated_published_state'] : []),
    ...(afterRadar.published.humanStateSha256 !== baseline.published.humanStateSha256
      ? ['lab_radar_publish_changed_human_state'] : []),
    ...(afterRadar.draft.stateSha256 !== afterRadar.published.stateSha256
      ? ['lab_radar_latest_version_not_equal_published'] : []),
  ])
  writeEvidence(outputs.afterRadarPublish, {
    generatedAt: new Date().toISOString(),
    afterRadar,
    blockers: afterRadarBlockers,
    payloadWriteRequests,
  })
  if (afterRadarBlockers.length) {
    failStage('draft_restore_radar_publication_failed', afterRadarBlockers, {
      afterCleanDraftRestore,
      afterRadar,
    })
    throw new Error(`Lab Radar publication failed: ${afterRadarBlockers.join(', ')}`)
  }

  payloadWriteRequests += 1
  await restoreVersionAsDraft(baseUrl, token, val(originalDraftVersion.id))
  const publishedFinal = await readWork(baseUrl, token, targetId)
  const draftFinal = await readWork(baseUrl, token, targetId, { draft: true })
  const final = {
    published: stateSnapshot(publishedFinal, patch),
    draft: stateSnapshot(draftFinal, patch),
    patchMatchedPublished: patchMatches(publishedFinal, patch),
  }
  const finalBlockers = unique([
    ...(!final.patchMatchedPublished ? ['lab_final_published_lost_radar_patch'] : []),
    ...(final.published.stateSha256 !== afterRadar.published.stateSha256
      ? ['lab_original_draft_restore_changed_published_main'] : []),
    ...(final.published.unrelatedStateSha256 !== baseline.published.unrelatedStateSha256
      ? ['lab_final_unrelated_published_state_changed'] : []),
    ...(final.published.humanStateSha256 !== baseline.published.humanStateSha256
      ? ['lab_final_human_state_changed'] : []),
    ...(final.draft.stateSha256 !== baseline.draft.stateSha256
      ? ['lab_original_latest_draft_not_restored'] : []),
    ...(final.draft.status !== 'draft'
      ? ['lab_final_latest_status_not_draft'] : []),
  ])
  writeEvidence(outputs.final, {
    generatedAt: new Date().toISOString(),
    final,
    blockers: finalBlockers,
    payloadWriteRequests,
  })

  const summary = {
    ok: finalBlockers.length === 0,
    status: finalBlockers.length
      ? 'draft_restore_roundtrip_lab_failed'
      : 'draft_restore_roundtrip_lab_verified',
    blockers: finalBlockers,
    target: candidate.target,
    labDatabase,
    baseUrl,
    baseline,
    afterCleanDraftRestore,
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
      restoreAsDraftRequests: 2,
      partialPublishedPatchRequests: 1,
      genericRestoreWithoutDraftRequests: 0,
      wholeDocumentDraftPatchRequests: 0,
      localApiRestoreUsed: false,
      restRestoreDraftQueryExplicit: true,
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
  if (!candidateManifestFile || !fs.existsSync(candidateManifestFile)) {
    throw new Error('--candidate-manifest is required and must exist')
  }

  const candidate = readJson(candidateManifestFile)
  const baseUrl = val(args.url || 'http://127.0.0.1:3100').replace(/\/+$/u, '')
  const labDatabase = val(args['lab-database'])
  const proofFile = val(args['database-proof'])
  const proof = proofFile && fs.existsSync(proofFile) ? readJson(proofFile) : null
  const email = val(process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.SITE_OWNER_EMAIL)
  const password = val(process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD)
  if (!email || !password) throw new Error('Payload credentials are required.')

  if (execute) {
    if (process.env.RADAR_VERSION_ROUNDTRIP_LAB !== 'YES') {
      throw new Error('RADAR_VERSION_ROUNDTRIP_LAB=YES is required for lab execution.')
    }
    if (!labDatabase) throw new Error('--lab-database is required for lab execution.')
    if (!proofFile || !proof) throw new Error('--database-proof is required for lab execution.')
    if (val(args.confirmation) !== CONFIRMATION) {
      throw new Error(`--confirmation ${CONFIRMATION} is required.`)
    }
  }

  const summary = await runLabV05({
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
