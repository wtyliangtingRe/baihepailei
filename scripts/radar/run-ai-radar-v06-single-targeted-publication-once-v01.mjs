#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { sha256File } from './lib/payload-apply-v01.mjs'
import {
  SINGLE_EXECUTE_VERSION,
  approvalTokenForCandidate,
  appendJsonl,
  executeConfirmationFor,
  readJson,
  unique,
  validateCurrentForSingleExecution,
  validateSingleCandidate,
  validateSingleGate,
  verifySingleExecution,
  writeJson,
} from './lib/v06-single-targeted-publication-v01.mjs'

const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/v06-single-targeted-publication-execute-v01'

function val(value) {
  return String(value ?? '').trim()
}

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

function gitValue(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
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

async function login(baseUrl, email, password) {
  const body = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  const token = val(body?.token)
  if (!token) throw new Error('Payload login response did not include a token')
  return token
}

async function readWork(baseUrl, token, id, { draft }) {
  const params = new URLSearchParams({ depth: '0' })
  if (draft) params.set('draft', 'true')
  return requestJson(`${baseUrl}/api/works/${encodeURIComponent(id)}?${params}`, {
    headers: { authorization: `JWT ${token}` },
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args['out-dir']) throw new Error('Execute evidence is automatically isolated; --out-dir is rejected.')
  if (args.apply || args.write || args.patch || args.publish || args.confirm || args.limit) {
    throw new Error('Legacy apply/write/publish/confirm flags and --limit are rejected.')
  }
  if (args.execute !== true) throw new Error('--execute is required')
  const candidateManifestFile = val(args['candidate-manifest'])
  const checkpointPath = val(args.checkpoint)
  const gateFile = val(args.gate)
  const approvalToken = val(args['approval-token'])
  const executeConfirmation = val(args['execute-confirmation'])
  if (!candidateManifestFile || !fs.existsSync(candidateManifestFile)) throw new Error('--candidate-manifest is required and must exist')
  if (!checkpointPath) throw new Error('--checkpoint is required')
  if (!gateFile || !fs.existsSync(gateFile)) throw new Error('--gate is required and must exist')
  if (!approvalToken) throw new Error('--approval-token is required')
  if (!executeConfirmation) throw new Error('--execute-confirmation is required')

  const currentBranch = gitValue(['branch', '--show-current'])
  const currentCommit = gitValue(['rev-parse', 'HEAD'])
  const candidate = readJson(candidateManifestFile)
  const gate = readJson(gateFile)
  const candidateManifestSha256 = sha256File(candidateManifestFile)
  const candidateValidation = validateSingleCandidate(candidate, {
    candidateManifestFile,
    checkpointPath,
    currentBranch,
    currentCommit,
    maxAgeHours: Number(args['max-backup-age-hours'] || 24),
  })
  const gateBlockers = validateSingleGate(gate, candidate, {
    candidateManifestSha256,
    approvalToken,
  })
  const staticBlockers = unique([
    ...candidateValidation.blockers,
    ...gateBlockers,
    ...(approvalToken !== approvalTokenForCandidate(candidate) ? ['single_execute_approval_token_mismatch'] : []),
    ...(executeConfirmation !== executeConfirmationFor(candidate) ? ['single_execute_confirmation_mismatch'] : []),
  ])
  if (staticBlockers.length) throw new Error(`Single publication execution gate blocked: ${staticBlockers.join(', ')}`)

  const baseUrl = val(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const email = val(process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.SITE_OWNER_EMAIL)
  const password = val(process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD)
  if (!email || !password) throw new Error('Payload credentials are required.')
  const token = await login(baseUrl, email, password)
  const targetId = val(candidate?.target?.id)

  const runId = `${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${candidate.candidateId.toLowerCase()}`
  const outDir = path.join(DEFAULT_OUT_ROOT, runId)
  if (fs.existsSync(outDir)) throw new Error(`Refusing to reuse execute evidence directory: ${outDir}`)
  const outputs = {
    summary: path.join(outDir, 'summary.json'),
    preflight: path.join(outDir, 'preflight.json'),
    journal: path.join(outDir, 'journal.jsonl'),
    applied: path.join(outDir, 'applied-and-verified.json'),
    verificationFailure: path.join(outDir, 'verification-failure.json'),
    rollbackPlan: path.join(outDir, 'rollback-plan.json'),
  }

  const publishedBefore = await readWork(baseUrl, token, targetId, { draft: false })
  const draftBefore = await readWork(baseUrl, token, targetId, { draft: true })
  const preflight = validateCurrentForSingleExecution(candidate, publishedBefore, draftBefore)
  writeJson(outputs.preflight, {
    generatedAt: new Date().toISOString(),
    version: SINGLE_EXECUTE_VERSION,
    candidateId: candidate.candidateId,
    target: candidate.target,
    status: preflight.status,
    blockers: preflight.blockers,
    changedFields: preflight.changedFields,
    observedBefore: preflight.observedBefore,
    safety: {
      payloadRead: true,
      payloadWrite: false,
      payloadPatchRequests: 0,
    },
  })
  if (preflight.status === 'blocked') {
    writeJson(outputs.summary, {
      ok: false,
      version: SINGLE_EXECUTE_VERSION,
      status: 'blocked_before_write',
      candidateId: candidate.candidateId,
      target: candidate.target,
      blockers: preflight.blockers,
      outputs,
      safety: { payloadWrite: false, payloadPatchRequests: 0, directPostgresqlWrite: false },
    })
    process.exitCode = 2
    return
  }
  if (preflight.status === 'already_published') {
    writeJson(outputs.summary, {
      ok: true,
      version: SINGLE_EXECUTE_VERSION,
      status: 'already_published_no_write',
      candidateId: candidate.candidateId,
      target: candidate.target,
      outputs,
      safety: { payloadWrite: false, payloadPatchRequests: 0, directPostgresqlWrite: false },
    })
    console.log(JSON.stringify({ ok: true, status: 'already_published_no_write', target: candidate.target, outputs }, null, 2))
    return
  }

  writeJson(outputs.rollbackPlan, {
    generatedAt: new Date().toISOString(),
    version: 'ai-radar-v06-single-targeted-publication-rollback-plan-v0.1',
    candidateId: candidate.candidateId,
    target: candidate.target,
    patch: preflight.rollbackPatch,
    automaticRollback: false,
    instruction: 'Use only after separate review if post-write verification fails. This file is not executed automatically.',
  })
  appendJsonl(outputs.journal, {
    at: new Date().toISOString(),
    event: 'preflight_ready',
    candidateId: candidate.candidateId,
    targetId,
    changedFields: preflight.changedFields,
    payloadPatchRequests: 0,
  })

  let payloadPatchRequests = 0
  const patchUrl = `${baseUrl}/api/works/${encodeURIComponent(targetId)}?draft=false&depth=0`
  payloadPatchRequests += 1
  const patchResponse = await requestJson(patchUrl, {
    method: 'PATCH',
    headers: { authorization: `JWT ${token}` },
    body: JSON.stringify(candidate.expected.patch),
  })
  appendJsonl(outputs.journal, {
    at: new Date().toISOString(),
    event: 'partial_publication_patch_returned',
    candidateId: candidate.candidateId,
    targetId,
    payloadPatchRequests,
    responseId: val(patchResponse?.id || patchResponse?.doc?.id),
  })

  const publishedAfter = await readWork(baseUrl, token, targetId, { draft: false })
  const draftAfter = await readWork(baseUrl, token, targetId, { draft: true })
  const verification = verifySingleExecution(candidate, publishedBefore, publishedAfter, draftAfter)
  const commonSummary = {
    generatedAt: new Date().toISOString(),
    version: SINGLE_EXECUTE_VERSION,
    candidateId: candidate.candidateId,
    target: candidate.target,
    candidateManifestFile,
    candidateManifestSha256,
    checkpointPath,
    gateFile,
    gateSha256: sha256File(gateFile),
    currentBranch,
    currentCommit,
    payloadPatchRequests,
    verification,
    outputs,
    safety: {
      payloadRead: true,
      payloadWrite: true,
      payloadPatchRequests,
      maximumPayloadPatchRequests: 1,
      directPostgresqlWrite: false,
      wholeDraftPublication: false,
      partialAllowlistedPatchOnly: true,
      automaticRollback: false,
      approvalTokenPrinted: false,
    },
  }
  if (!verification.verified) {
    writeJson(outputs.verificationFailure, {
      ...commonSummary,
      status: 'patch_returned_but_verification_failed',
      warning: 'A write occurred. Stop here and inspect the rollback plan before any further publication.',
    })
    writeJson(outputs.summary, {
      ...commonSummary,
      ok: false,
      status: 'patch_returned_but_verification_failed',
    })
    console.log(JSON.stringify({ ok: false, status: 'patch_returned_but_verification_failed', blockers: verification.blockers, outputs }, null, 2))
    process.exitCode = 2
    return
  }

  writeJson(outputs.applied, {
    ...commonSummary,
    status: 'applied_and_verified',
    changedFields: preflight.changedFields,
  })
  writeJson(outputs.summary, {
    ...commonSummary,
    ok: true,
    status: 'applied_and_verified',
  })
  appendJsonl(outputs.journal, {
    at: new Date().toISOString(),
    event: 'published_and_verified',
    candidateId: candidate.candidateId,
    targetId,
    payloadPatchRequests,
    publishedStateSha256: verification.publishedStateSha256,
    humanStateSha256: verification.humanStateSha256,
  })
  console.log(JSON.stringify({
    ok: true,
    status: 'applied_and_verified',
    target: candidate.target,
    changedFields: preflight.changedFields,
    payloadPatchRequests,
    verification,
    outputs,
  }, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
