#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { readJson, writeJson } from './lib/v06-single-targeted-publication-v01.mjs'
import { normalizedDocumentState, sha256 } from './lab-ai-radar-v06-version-roundtrip-v01.mjs'

const VERSION = 'ai-radar-v06-clean-draft-write-diagnostic-v0.4'
const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/v06-clean-draft-write-diagnostic-v04'

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
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function preview(value) {
  const text = JSON.stringify(value)
  if (text === undefined) return String(value)
  return text.length > 1000 ? `${text.slice(0, 1000)}…` : text
}

export function collectDifferences(left, right, currentPath = '$', output = []) {
  if (Object.is(left, right)) return output

  const leftType = typeOf(left)
  const rightType = typeOf(right)
  if (leftType !== rightType) {
    output.push({
      path: currentPath,
      kind: 'type_changed',
      publishedType: leftType,
      draftType: rightType,
      published: preview(left),
      draft: preview(right),
    })
    return output
  }

  if (leftType === 'array') {
    if (left.length !== right.length) {
      output.push({
        path: `${currentPath}.length`,
        kind: 'array_length_changed',
        published: String(left.length),
        draft: String(right.length),
      })
    }
    const length = Math.max(left.length, right.length)
    for (let index = 0; index < length; index += 1) {
      collectDifferences(left[index], right[index], `${currentPath}[${index}]`, output)
    }
    return output
  }

  if (leftType === 'object') {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    for (const key of keys) {
      const leftHas = Object.prototype.hasOwnProperty.call(left, key)
      const rightHas = Object.prototype.hasOwnProperty.call(right, key)
      const childPath = `${currentPath}.${key}`
      if (!leftHas || !rightHas) {
        output.push({
          path: childPath,
          kind: leftHas ? 'missing_from_draft' : 'extra_in_draft',
          published: leftHas ? preview(left[key]) : '<missing>',
          draft: rightHas ? preview(right[key]) : '<missing>',
        })
        continue
      }
      collectDifferences(left[key], right[key], childPath, output)
    }
    return output
  }

  output.push({
    path: currentPath,
    kind: 'value_changed',
    published: preview(left),
    draft: preview(right),
  })
  return output
}

function withoutRootStatus(document) {
  const state = structuredClone(normalizedDocumentState(document || {}))
  if (state && typeof state === 'object' && !Array.isArray(state)) delete state._status
  return state
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
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 1200)}`)
  return text ? JSON.parse(text) : null
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

export async function runDiagnostic({ baseUrl, candidate, candidateManifestFile, email, password, outFile }) {
  const parsedUrl = new URL(baseUrl)
  const port = Number(parsedUrl.port || 80)
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname) || port !== 3100) {
    throw new Error('Diagnostic only accepts loopback port 3100.')
  }

  const targetId = val(candidate?.target?.id)
  if (!targetId) throw new Error('Candidate target id is missing.')

  const token = await login(baseUrl, email, password)
  const published = await readWork(baseUrl, token, targetId)
  const draft = await readWork(baseUrl, token, targetId, { draft: true })

  const publishedState = withoutRootStatus(published)
  const draftState = withoutRootStatus(draft)
  const differences = collectDifferences(publishedState, draftState)
  const rootFields = [...new Set(differences.map((row) => {
    const match = /^\$\.([^.[\]]+)/u.exec(row.path)
    return match?.[1] || row.path
  }))].sort()

  const result = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    candidateManifestFile,
    target: candidate.target,
    baseUrl,
    publishedStatus: val(published?._status),
    draftStatus: val(draft?._status),
    publishedStateIgnoringStatusSha256: sha256(publishedState),
    draftStateIgnoringStatusSha256: sha256(draftState),
    differenceCount: differences.length,
    differingRootFields: rootFields,
    differences,
    safety: {
      payloadReads: true,
      payloadWrites: false,
      payloadWriteRequests: 0,
      restoreRequests: 0,
      mainDatabaseTargeted: false,
    },
  }

  writeJson(outFile, result)
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.write || args.patch || args.publish || args.confirm) {
    throw new Error('Write-like flags are rejected by the read-only diagnostic.')
  }

  const candidateManifestFile = val(args['candidate-manifest'])
  if (!candidateManifestFile || !fs.existsSync(candidateManifestFile)) {
    throw new Error('--candidate-manifest is required and must exist')
  }
  const candidate = readJson(candidateManifestFile)
  const baseUrl = val(args.url || 'http://127.0.0.1:3100').replace(/\/+$/u, '')
  const email = val(process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.SITE_OWNER_EMAIL)
  const password = val(process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD)
  if (!email || !password) throw new Error('Payload credentials are required.')

  const runId = `${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${val(candidate?.target?.id)}-${process.pid}`
  const outFile = val(args.out) || path.join(DEFAULT_OUT_ROOT, runId, 'clean-draft-diff.json')
  const result = await runDiagnostic({
    baseUrl,
    candidate,
    candidateManifestFile,
    email,
    password,
    outFile,
  })

  console.log(JSON.stringify({
    ok: true,
    status: 'read_only_clean_draft_diff_complete',
    target: result.target,
    publishedStatus: result.publishedStatus,
    draftStatus: result.draftStatus,
    differenceCount: result.differenceCount,
    differingRootFields: result.differingRootFields,
    output: outFile,
    safety: result.safety,
  }, null, 2))
}

const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isDirectRun) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
