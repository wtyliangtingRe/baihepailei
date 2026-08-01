#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs, rejectWriteFlags, validatePublicReleaseDirectory, val } from './lib/public-release-v01.mjs'
import {
  buildCurrentRecordIndexes,
  buildPlanRow,
  buildWorkIndexes,
} from './lib/public-release-plan-v01.mjs'

const DEFAULT_OUT_DIR = 'data_local/outputs/radar-public-release-v01/plan'

function readRows(file) {
  if (!file) return []
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  const text = fs.readFileSync(file, 'utf8').trim()
  if (!text) return []
  if (file.toLowerCase().endsWith('.jsonl')) return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
  const parsed = JSON.parse(text)
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed?.docs)) return parsed.docs
  if (Array.isArray(parsed?.items)) return parsed.items
  throw new Error(`Expected JSON array/docs/items: ${file}`)
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`)
  return payload
}

async function login(baseUrl) {
  const email = process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL
  const password = process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD
  if (!email || !password) throw new Error('Missing RADAR_PAYLOAD_EMAIL and RADAR_PAYLOAD_PASSWORD, or pass --works-file and --public-records-file.')
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!result?.token) throw new Error('Payload login did not return a token')
  return result.token
}

async function fetchAll(baseUrl, slug, token) {
  const docs = []
  let page = 1
  let totalPages = 1
  do {
    const params = new URLSearchParams({ limit: '200', page: String(page), depth: '0' })
    const result = await requestJson(`${baseUrl}/api/${slug}?${params}`, {
      headers: { Authorization: `JWT ${token}` },
    })
    docs.push(...(Array.isArray(result?.docs) ? result.docs : []))
    totalPages = Number(result?.totalPages || 1)
    page += 1
  } while (page <= totalPages)
  return docs
}

function countBy(rows, field) {
  const counts = {}
  for (const row of rows) {
    const key = val(row[field]) || 'missing'
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  rejectWriteFlags(args)
  const input = val(args.input)
  if (!input) throw new Error('--input is required')
  const outDir = path.resolve(val(args['out-dir']) || DEFAULT_OUT_DIR)
  const dataLocal = path.resolve('data_local')
  if (!(outDir === dataLocal || outDir.startsWith(`${dataLocal}${path.sep}`))) {
    throw new Error(`Plan output must remain under data_local: ${outDir}`)
  }

  const validation = validatePublicReleaseDirectory(path.resolve(input))
  const manifest = JSON.parse(fs.readFileSync(path.join(input, 'manifest.json'), 'utf8'))
  const records = fs.readFileSync(path.join(input, 'records.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const baseUrl = val(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')

  let works
  let currentRecords
  let payloadRead = false
  let worksSource
  let publicRecordsSource
  if (args['works-file']) {
    works = readRows(val(args['works-file']))
    currentRecords = readRows(val(args['public-records-file']))
    worksSource = val(args['works-file'])
    publicRecordsSource = val(args['public-records-file']) || 'empty_fixture'
  } else {
    const token = await login(baseUrl)
    works = await fetchAll(baseUrl, 'works', token)
    try {
      currentRecords = await fetchAll(baseUrl, 'radar-public-records', token)
    } catch (error) {
      if (!args['allow-missing-public-collection']) throw error
      currentRecords = []
    }
    payloadRead = true
    worksSource = `${baseUrl}/api/works`
    publicRecordsSource = `${baseUrl}/api/radar-public-records`
  }

  const workIndexes = buildWorkIndexes(works)
  const currentIndexes = buildCurrentRecordIndexes(currentRecords)
  const importedAt = val(args['imported-at']) || new Date().toISOString()
  const release = {
    releaseId: manifest.releaseId,
    sourceCommitSha: manifest.source.commitSha,
    policyVersion: manifest.source.policyVersion,
    researchSnapshotId: manifest.source.researchSnapshotId,
    recordsSha256: manifest.files.records.sha256,
  }
  const plans = records.map((record) => buildPlanRow(record, workIndexes, currentIndexes, release, importedAt))
  const ready = plans.filter((row) => row.planStatus === 'ready_create' || row.planStatus === 'ready_update')
  const blocked = plans.filter((row) => row.planStatus.startsWith('blocked_'))
  const alreadyCurrent = plans.filter((row) => row.planStatus === 'already_current')

  const outputs = {
    all: path.join(outDir, 'radar-public-release-v01-plan.jsonl'),
    ready: path.join(outDir, 'radar-public-release-v01-ready.jsonl'),
    blocked: path.join(outDir, 'radar-public-release-v01-blocked.jsonl'),
    alreadyCurrent: path.join(outDir, 'radar-public-release-v01-already-current.jsonl'),
    summary: path.join(outDir, 'radar-public-release-v01-plan-summary.json'),
  }
  const summary = {
    schemaVersion: 'radar-public-release-plan-summary-v01',
    generatedAt: new Date().toISOString(),
    releaseId: manifest.releaseId,
    releaseRecordsSha256: manifest.files.records.sha256,
    publicReleaseValidationDecision: validation.decision,
    publicReleaseRows: records.length,
    payloadWorksRead: works.length,
    existingPublicRecordsRead: currentRecords.length,
    worksSource,
    publicRecordsSource,
    byPlanStatus: countBy(plans, 'planStatus'),
    readyCreate: plans.filter((row) => row.planStatus === 'ready_create').length,
    readyUpdate: plans.filter((row) => row.planStatus === 'ready_update').length,
    alreadyCurrent: alreadyCurrent.length,
    blocked: blocked.length,
    outputs,
    blockers: blocked.length ? ['identity_or_schema_blockers_present'] : [],
    safety: {
      payloadRead,
      payloadWrite: false,
      postgresqlRead: false,
      postgresqlWrite: false,
      worksMutation: false,
      humanAssessmentMutation: false,
      radarAssessmentMutation: false,
      titleOnlyMatching: false,
      workCreation: false,
      publicRecordMutation: false,
      planOnly: true,
    },
    canApply: false,
    decision: blocked.length ? 'review_blocked_public_release_plan' : 'accept_public_release_plan_dry_run',
  }

  writeJsonl(outputs.all, plans)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.blocked, blocked)
  writeJsonl(outputs.alreadyCurrent, alreadyCurrent)
  writeJson(outputs.summary, summary)
  return summary
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirect) {
  run().then((summary) => console.log(JSON.stringify({ ok: true, summary }, null, 2))).catch((error) => {
    console.error(error.stack || error.message)
    process.exitCode = 1
  })
}
