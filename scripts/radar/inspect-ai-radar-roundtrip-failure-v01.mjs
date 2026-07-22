#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  normalizePayloadValue,
  normalizedDocumentState,
  sha256,
  unrelatedPublishedState,
} from './lab-ai-radar-v06-version-roundtrip-v01.mjs'

const VERSION = 'ai-radar-roundtrip-failure-forensics-v0.1'
const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/full-coverage-publication-v01'
const DEFAULT_REPORT_ROOT = 'data_local/outputs/ai-radar/forensics/roundtrip-failure-v01'
const DEFAULT_BACKUP_ROOT = 'data_local/backups/radar-full-coverage-publication'
const VALID_GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F'])

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}
function equal(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)) }
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
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')) }
function readJsonl(file) {
  if (!file || !fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  return raw ? raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)) : []
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
function findFiles(root, filename) {
  if (!fs.existsSync(root)) return []
  const found = []
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile() && entry.name === filename) found.push(full)
    }
  }
  visit(root)
  return found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
}
function newestMatching(root, pattern) {
  if (!fs.existsSync(root)) return null
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null
}
function classifyConclusion(value) {
  const radar = value?.radarAssessment && typeof value.radarAssessment === 'object' ? value.radarAssessment : value || {}
  const suggested = val(radar?.suggestedGrade).toUpperCase()
  if (VALID_GRADES.has(suggested)) return { mode: 'fixed_grade', suggestedGrade: suggested }
  const best = val(radar?.bestGrade || radar?.proposedBestGrade).toUpperCase()
  const likely = val(radar?.likelyGrade || radar?.proposedLikelyGrade).toUpperCase()
  const worst = val(radar?.worstGrade || radar?.proposedWorstGrade).toUpperCase()
  if (val(radar?.conclusionMode) === 'bounded_range' && [best, likely, worst].every((grade) => VALID_GRADES.has(grade))) {
    return { mode: 'bounded_range', bestGrade: best, likelyGrade: likely, worstGrade: worst }
  }
  return { mode: 'none' }
}
function patchMatches(document, patch) {
  if (!patch || !document) return false
  return Object.entries(patch).every(([key, value]) => equal(normalizePayloadValue(document?.[key]), normalizePayloadValue(value)))
}
function parentId(versionRow) {
  if (typeof versionRow?.parent === 'string' || typeof versionRow?.parent === 'number') return val(versionRow.parent)
  return val(versionRow?.parent?.id || versionRow?.parent?.value)
}
async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 1200)}`)
  return body
}
async function login(baseUrl, email, password) {
  const body = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
  const token = val(body?.token)
  if (!token) throw new Error('Payload login response did not include a token')
  return token
}
async function readWork(baseUrl, token, id, draft = false) {
  const params = new URLSearchParams({ depth: '0' })
  if (draft) params.set('draft', 'true')
  return requestJson(`${baseUrl}/api/works/${encodeURIComponent(id)}?${params}`, { headers: { authorization: `JWT ${token}` } })
}
async function readVersions(baseUrl, token, id) {
  const params = new URLSearchParams({
    depth: '0',
    limit: '100',
    page: '1',
    sort: '-createdAt',
    'where[parent][equals]': id,
  })
  const body = await requestJson(`${baseUrl}/api/works/versions?${params}`, { headers: { authorization: `JWT ${token}` } })
  return list(body?.docs).filter((row) => parentId(row) === id)
}
async function readResearch(baseUrl, token, id) {
  const params = new URLSearchParams({
    depth: '0',
    limit: '100',
    page: '1',
    sort: '-updatedAt',
    'where[work][equals]': id,
  })
  const body = await requestJson(`${baseUrl}/api/radar-research-records?${params}`, { headers: { authorization: `JWT ${token}` } })
  return list(body?.docs)
}
function workSummary(document, patch) {
  if (!document) return null
  return canonical({
    id: val(document?.id),
    siteId: val(document?.siteId),
    title: val(document?.title),
    status: val(document?._status),
    catalogStatus: val(document?.catalogStatus),
    reviewStatus: val(document?.reviewStatus),
    createdAt: val(document?.createdAt),
    updatedAt: val(document?.updatedAt),
    conclusion: classifyConclusion(document),
    patchPresent: patchMatches(document, patch),
    stateSha256: sha256(normalizedDocumentState(document)),
    unrelatedStateSha256: patch ? sha256(unrelatedPublishedState(document, patch)) : null,
    humanAssessmentPresent: Boolean(document?.humanAssessment && typeof document.humanAssessment === 'object'),
  })
}
function researchSummary(record) {
  return canonical({
    id: val(record?.id),
    researchKey: val(record?.researchKey),
    programId: val(record?.programId),
    importBatch: val(record?.importBatch),
    batchId: val(record?.batchId),
    workIdSnapshot: val(record?.workIdSnapshot),
    workSiteId: val(record?.workSiteId),
    researchStatus: val(record?.researchStatus),
    likelyGrade: val(record?.proposedLikelyGrade),
    bestGrade: val(record?.proposedBestGrade),
    worstGrade: val(record?.proposedWorstGrade),
    updatedAt: val(record?.updatedAt),
    sourceResponseSha256: val(record?.sourceResponseSha256),
  })
}
function versionSummary(versionRow, patch) {
  return canonical({
    id: val(versionRow?.id),
    parent: parentId(versionRow),
    createdAt: val(versionRow?.createdAt),
    updatedAt: val(versionRow?.updatedAt),
    autosave: Boolean(versionRow?.autosave),
    latest: Boolean(versionRow?.latest),
    versionStatus: val(versionRow?.version?._status),
    conclusion: classifyConclusion(versionRow?.version),
    patchPresent: patchMatches(versionRow?.version, patch),
    stateSha256: versionRow?.version ? sha256(normalizedDocumentState(versionRow.version)) : null,
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const targetId = val(args['target-id'] || '3739')
  const baseUrl = val(args.url || 'http://127.0.0.1:3000').replace(/\/+$/u, '')
  const outRoot = path.resolve(val(args['out-root']) || DEFAULT_OUT_ROOT)
  const reportRoot = path.resolve(val(args['report-root']) || DEFAULT_REPORT_ROOT)
  const backupRoot = path.resolve(val(args['backup-root']) || DEFAULT_BACKUP_ROOT)
  const email = val(process.env.RADAR_PAYLOAD_EMAIL)
  const password = val(process.env.RADAR_PAYLOAD_PASSWORD)
  if (!email || !password) throw new Error('Read-only inspector requires RADAR_PAYLOAD_EMAIL and RADAR_PAYLOAD_PASSWORD')

  const ledgerFile = findFiles(outRoot, 'execution-ledger.jsonl')[0] || null
  const runDir = ledgerFile ? path.dirname(ledgerFile) : null
  const planFile = runDir ? path.join(runDir, 'publication-plan.jsonl') : null
  const planSummaryFile = runDir ? path.join(runDir, 'publication-plan-summary.json') : null
  const ledgerRows = readJsonl(ledgerFile)
  const planRows = readJsonl(planFile)
  const targetLedgerEvents = ledgerRows.filter((row) => val(row?.targetId) === targetId)
  const planRow = planRows.find((row) => val(row?.targetId) === targetId) || null
  const patch = planRow?.patch || null

  const backupProofFile = newestMatching(backupRoot, /^backup-proof-.*\.json$/u)
  const backupProof = backupProofFile ? readJson(backupProofFile) : null
  const dumpFile = val(backupProof?.dumpFile)

  const token = await login(baseUrl, email, password)
  const [published, draft, versions, research] = await Promise.all([
    readWork(baseUrl, token, targetId, false),
    readWork(baseUrl, token, targetId, true),
    readVersions(baseUrl, token, targetId),
    readResearch(baseUrl, token, targetId),
  ])

  const publishedSummary = workSummary(published, patch)
  const draftSummary = workSummary(draft, patch)
  const report = canonical({
    version: VERSION,
    generatedAt: new Date().toISOString(),
    gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    targetId,
    safety: {
      payloadLoginPostOnly: true,
      payloadDataMutation: false,
      payloadPatch: false,
      payloadRestoreVersion: false,
      directPostgresqlWrite: false,
    },
    sourceFiles: {
      ledgerFile,
      ledgerSha256: ledgerFile ? fileSha256(ledgerFile) : null,
      planFile: planFile && fs.existsSync(planFile) ? planFile : null,
      planSha256: planFile && fs.existsSync(planFile) ? fileSha256(planFile) : null,
      planSummaryFile: planSummaryFile && fs.existsSync(planSummaryFile) ? planSummaryFile : null,
      planSummarySha256: planSummaryFile && fs.existsSync(planSummaryFile) ? fileSha256(planSummaryFile) : null,
    },
    backup: backupProof ? {
      proofFile: backupProofFile,
      proofSha256: fileSha256(backupProofFile),
      generatedAt: val(backupProof?.generatedAt),
      gitCommit: val(backupProof?.gitCommit),
      dumpFile,
      dumpExists: Boolean(dumpFile && fs.existsSync(dumpFile)),
      dumpBytesDeclared: Number(backupProof?.dumpBytes || 0),
      dumpBytesActual: dumpFile && fs.existsSync(dumpFile) ? fs.statSync(dumpFile).size : 0,
      dumpSha256Declared: val(backupProof?.dumpSha256),
      dumpSha256Actual: dumpFile && fs.existsSync(dumpFile) ? fileSha256(dumpFile) : null,
    } : null,
    planRow,
    targetLedgerEvents,
    current: {
      published: publishedSummary,
      draft: draftSummary,
      expectedBefore: planRow?.expectedBefore || null,
      publishedMatchesExpectedBefore: Boolean(planRow?.expectedBefore?.publishedStateSha256 && publishedSummary?.stateSha256 === planRow.expectedBefore.publishedStateSha256),
      draftMatchesExpectedBefore: Boolean(planRow?.expectedBefore?.draftStateSha256 && draftSummary?.stateSha256 === planRow.expectedBefore.draftStateSha256),
      publishedUnrelatedMatchesExpectedBefore: Boolean(planRow?.expectedBefore?.publishedUnrelatedStateSha256 && publishedSummary?.unrelatedStateSha256 === planRow.expectedBefore.publishedUnrelatedStateSha256),
      draftUnrelatedMatchesExpectedBefore: Boolean(planRow?.expectedBefore?.draftUnrelatedStateSha256 && draftSummary?.unrelatedStateSha256 === planRow.expectedBefore.draftUnrelatedStateSha256),
    },
    recentVersions: versions.slice(0, 20).map((row) => versionSummary(row, patch)),
    researchRecords: research.map(researchSummary),
  })

  const stamp = new Date().toISOString().replace(/[-:.TZ]/gu, '')
  const reportFile = path.join(reportRoot, `${stamp}-work-${targetId}-roundtrip-forensics.json`)
  writeJson(reportFile, report)
  process.stdout.write(`${JSON.stringify({ ok: true, reportFile, targetId, payloadDataMutation: false, publishedPatchPresent: publishedSummary?.patchPresent, draftMatchesExpectedBefore: report.current.draftMatchesExpectedBefore, researchRecords: report.researchRecords.length }, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
