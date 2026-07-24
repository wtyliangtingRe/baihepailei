#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import {
  normalizePayloadValue,
  normalizedDocumentState,
  sha256,
  unrelatedPublishedState,
} from './lab-ai-radar-v06-version-roundtrip-v01.mjs'

const VERSION = 'ai-radar-direct-overwrite-failure-forensics-v0.3'
const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/full-coverage-direct-overwrite-v02'
const DEFAULT_REPORT_ROOT = 'data_local/outputs/ai-radar/forensics/direct-overwrite-failure-v03'
const DEFAULT_BACKUP_ROOT = 'data_local/outputs/ai-radar/backups/direct-overwrite-v02'
const HUMAN_ROOTS = new Set([
  'humanAssessment',
  'humanReviewNote',
  'humanReviewedAt',
  'humanReviewedBy',
])
const VOLATILE_ROOTS = new Set(['id', 'createdAt', 'updatedAt', 'publishedAt'])

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

function readJsonl(file) {
  if (!file || !fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  if (!raw) return []
  return raw
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function sourceFileInfo(file) {
  return file && fs.existsSync(file)
    ? {
        path: file,
        sha256: fileSha256(file),
        bytes: fs.statSync(file).size,
        modifiedAt: fs.statSync(file).mtime.toISOString(),
      }
    : null
}

function findFiles(root, filename) {
  if (!fs.existsSync(root)) return []
  const found = []
  const visited = new Set()

  const visit = (current) => {
    let real
    try {
      real = fs.realpathSync(current)
    } catch {
      return
    }
    if (visited.has(real)) return
    visited.add(real)

    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name)
      let directory = entry.isDirectory()
      if (!directory && entry.isSymbolicLink()) {
        try {
          directory = fs.statSync(full).isDirectory()
        } catch {
          directory = false
        }
      }
      if (directory) visit(full)
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

function safeRows(file) {
  try {
    return readJsonl(file)
  } catch {
    return []
  }
}

export function findEvidenceRun(outRoot, targetId) {
  const candidates = []

  for (const planFile of findFiles(outRoot, 'publication-plan.jsonl')) {
    const planRows = safeRows(planFile)
    const planRow = planRows.find((row) => val(row?.targetId) === targetId) || null
    if (!planRow) continue

    const runDir = path.dirname(planFile)
    const ledgerFile = path.join(runDir, 'execution-ledger.jsonl')
    const events = safeRows(ledgerFile)
    const targetEvents = events.filter((event) => val(event?.targetId) === targetId)
    const failureEvent = [...targetEvents]
      .reverse()
      .find((event) => val(event?.status) === 'execution_failed') || null
    const latestTargetEvent = targetEvents[targetEvents.length - 1] || null

    candidates.push({
      runDir,
      planFile,
      planSummaryFile: fs.existsSync(path.join(runDir, 'publication-plan-summary.json'))
        ? path.join(runDir, 'publication-plan-summary.json')
        : null,
      ledgerFile: fs.existsSync(ledgerFile) ? ledgerFile : null,
      planRow,
      failureEvent,
      latestTargetEvent,
      targetEvents,
      planModifiedMs: fs.statSync(planFile).mtimeMs,
    })
  }

  candidates.sort((a, b) => {
    const aRank = a.failureEvent ? 3 : a.latestTargetEvent ? 2 : 1
    const bRank = b.failureEvent ? 3 : b.latestTargetEvent ? 2 : 1
    return bRank - aRank || b.planModifiedMs - a.planModifiedMs
  })

  const selected = candidates[0] || null
  return {
    selected,
    candidatesScanned: candidates.length,
    selectionKind: selected?.failureEvent
      ? 'failed_ledger_event'
      : selected?.latestTargetEvent
        ? 'target_ledger_event_fallback'
        : selected
          ? 'latest_matching_plan_fallback'
          : 'none',
  }
}

function normalizeDateString(value) {
  if (typeof value !== 'string') return value
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(value)) return value
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : value
}

function normalizeForPathDiff(value, { root = false } = {}) {
  if (Array.isArray(value)) return value.map((item) => normalizeForPathDiff(item))
  if (value && typeof value === 'object') {
    const entries = []
    for (const key of Object.keys(value).sort()) {
      if (!root && key === 'id') continue
      const normalized = normalizeForPathDiff(value[key])
      if (normalized !== undefined) entries.push([key, normalized])
    }
    return Object.fromEntries(entries)
  }
  return normalizeDateString(value)
}

function displayPath(parts) {
  let result = ''
  for (const part of parts) {
    if (typeof part === 'number') result += `[${part}]`
    else result += result ? `.${part}` : part
  }
  return result || '$'
}

function walkDiff(before, after, parts, output) {
  if (equal(before, after)) return

  const beforeArray = Array.isArray(before)
  const afterArray = Array.isArray(after)
  if (beforeArray && afterArray) {
    const length = Math.max(before.length, after.length)
    for (let index = 0; index < length; index += 1) {
      const beforePresent = index < before.length
      const afterPresent = index < after.length
      if (!beforePresent || !afterPresent) {
        output.push({
          path: displayPath([...parts, index]),
          beforePresent,
          afterPresent,
          before: beforePresent ? before[index] : null,
          after: afterPresent ? after[index] : null,
        })
      } else {
        walkDiff(before[index], after[index], [...parts, index], output)
      }
    }
    return
  }

  const beforeObject = before && typeof before === 'object' && !beforeArray
  const afterObject = after && typeof after === 'object' && !afterArray
  if (beforeObject && afterObject) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    for (const key of keys) {
      const beforePresent = Object.prototype.hasOwnProperty.call(before, key)
      const afterPresent = Object.prototype.hasOwnProperty.call(after, key)
      if (!beforePresent || !afterPresent) {
        output.push({
          path: displayPath([...parts, key]),
          beforePresent,
          afterPresent,
          before: beforePresent ? before[key] : null,
          after: afterPresent ? after[key] : null,
        })
      } else {
        walkDiff(before[key], after[key], [...parts, key], output)
      }
    }
    return
  }

  output.push({
    path: displayPath(parts),
    beforePresent: true,
    afterPresent: true,
    before,
    after,
  })
}

export function diffDocuments(beforeDocument, afterDocument) {
  const before = normalizeForPathDiff(beforeDocument || {}, { root: true })
  const after = normalizeForPathDiff(afterDocument || {}, { root: true })
  const output = []
  walkDiff(before, after, [], output)
  return output
}

function rootOfPath(diffPath) {
  return val(diffPath).split(/[.[]/u, 1)[0]
}

export function categorizeDiffs(diffs, patch) {
  const patchRoots = new Set(Object.keys(patch || {}))
  const categories = {
    patch: [],
    human: [],
    volatile: [],
    unrelated: [],
  }
  for (const diff of list(diffs)) {
    const root = rootOfPath(diff?.path)
    if (patchRoots.has(root)) categories.patch.push(diff)
    else if (HUMAN_ROOTS.has(root)) categories.human.push(diff)
    else if (VOLATILE_ROOTS.has(root)) categories.volatile.push(diff)
    else categories.unrelated.push(diff)
  }
  return categories
}

function selectedHumanState(document) {
  return canonical(normalizePayloadValue({
    humanAssessment: document?.humanAssessment || null,
    humanReviewNote: document?.humanReviewNote || null,
    humanReviewedAt: document?.humanReviewedAt || null,
    humanReviewedBy: document?.humanReviewedBy || null,
  }))
}

function patchMatches(document, patch) {
  if (!document || !patch) return false
  return Object.entries(patch).every(([key, value]) => (
    equal(normalizePayloadValue(document?.[key]), normalizePayloadValue(value))
  ))
}

function parentId(versionRow) {
  if (typeof versionRow?.parent === 'string' || typeof versionRow?.parent === 'number') {
    return val(versionRow.parent)
  }
  return val(versionRow?.parent?.id || versionRow?.parent?.value)
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
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 1200)}`)
  }
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

function versionInfo(versionRow, patch) {
  const document = versionRow?.version || null
  return canonical({
    id: val(versionRow?.id),
    parent: parentId(versionRow),
    createdAt: val(versionRow?.createdAt),
    updatedAt: val(versionRow?.updatedAt),
    autosave: Boolean(versionRow?.autosave),
    latest: Boolean(versionRow?.latest),
    status: val(document?._status),
    stateSha256: document ? sha256(normalizedDocumentState(document)) : null,
    unrelatedStateSha256: document && patch ? sha256(unrelatedPublishedState(document, patch)) : null,
    humanStateSha256: document ? sha256(selectedHumanState(document)) : null,
    patchPresent: patchMatches(document, patch),
  })
}

function selectBaselineVersion(versions, planRow, patch) {
  const expected = planRow?.expectedBefore || {}
  const infos = versions.map((row) => ({ row, info: versionInfo(row, patch) }))

  const exact = infos.find(({ info }) => (
    val(expected?.publishedStateSha256)
    && info.stateSha256 === val(expected.publishedStateSha256)
  ))
  if (exact) return { ...exact, matchKind: 'exact_published_state_sha256' }

  const unrelatedAndHuman = infos.find(({ info }) => (
    val(expected?.publishedUnrelatedStateSha256)
    && val(expected?.publishedHumanStateSha256)
    && info.unrelatedStateSha256 === val(expected.publishedUnrelatedStateSha256)
    && info.humanStateSha256 === val(expected.publishedHumanStateSha256)
    && !info.patchPresent
  ))
  if (unrelatedAndHuman) {
    return { ...unrelatedAndHuman, matchKind: 'unrelated_and_human_sha256' }
  }

  const unrelated = infos.find(({ info }) => (
    val(expected?.publishedUnrelatedStateSha256)
    && info.unrelatedStateSha256 === val(expected.publishedUnrelatedStateSha256)
    && !info.patchPresent
  ))
  if (unrelated) return { ...unrelated, matchKind: 'unrelated_sha256_only' }

  return null
}

async function runForensics(options) {
  const evidence = findEvidenceRun(options.outRoot, options.targetId)
  if (!evidence.selected) {
    throw new Error(`No publication plan row found for Work ${options.targetId}`)
  }

  const selected = evidence.selected
  const planRow = selected.planRow
  if (!planRow?.patch) throw new Error(`Selected plan has no patch for Work ${options.targetId}`)

  const token = await login(options.baseUrl, options.email, options.password)
  const [published, draft, versions] = await Promise.all([
    readWork(options.baseUrl, token, options.targetId),
    readWork(options.baseUrl, token, options.targetId, { draft: true }),
    readVersions(options.baseUrl, token, options.targetId),
  ])

  const patch = planRow.patch
  const baseline = selectBaselineVersion(versions, planRow, patch)
  const allDiffs = baseline ? diffDocuments(baseline.row.version, published) : []
  const categories = categorizeDiffs(allDiffs, patch)
  const publishedStateSha256 = sha256(normalizedDocumentState(published))
  const draftStateSha256 = sha256(normalizedDocumentState(draft))
  const publishedUnrelatedStateSha256 = sha256(unrelatedPublishedState(published, patch))
  const publishedHumanStateSha256 = sha256(selectedHumanState(published))

  const backupProofFile = newestMatching(
    options.backupRoot,
    /^RADAR-DIRECT-OVERWRITE-FIRST5-.*-proof\.json$/u,
  )
  const backupProof = backupProofFile ? readJson(backupProofFile) : null
  const dumpFile = val(backupProof?.dumpFile)
  const dumpExists = Boolean(dumpFile && fs.existsSync(dumpFile))

  const report = canonical({
    version: VERSION,
    generatedAt: new Date().toISOString(),
    gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    targetId: options.targetId,
    safety: {
      payloadLoginPostOnly: true,
      payloadRead: true,
      payloadDataMutation: false,
      payloadPatch: false,
      payloadRestoreVersion: false,
      directPostgresqlWrite: false,
    },
    evidenceSelection: {
      selectionKind: evidence.selectionKind,
      candidatesScanned: evidence.candidatesScanned,
      failureLedgerFound: Boolean(selected.failureEvent),
      targetLedgerEventFound: Boolean(selected.latestTargetEvent),
      runDir: selected.runDir,
      plan: sourceFileInfo(selected.planFile),
      planSummary: sourceFileInfo(selected.planSummaryFile),
      ledger: sourceFileInfo(selected.ledgerFile),
      failureEvent: selected.failureEvent,
      latestTargetEvent: selected.latestTargetEvent,
      targetEventCount: selected.targetEvents.length,
      planRow,
    },
    backup: backupProof ? {
      proof: sourceFileInfo(backupProofFile),
      generatedAt: val(backupProof?.generatedAt),
      gitCommit: val(backupProof?.gitCommit),
      dumpFile,
      dumpExists,
      dumpBytesDeclared: Number(backupProof?.dumpBytes || 0),
      dumpBytesActual: dumpExists ? fs.statSync(dumpFile).size : 0,
      dumpSha256Declared: val(backupProof?.dumpSha256),
      dumpSha256Actual: dumpExists ? fileSha256(dumpFile) : null,
    } : null,
    baseline: baseline ? {
      found: true,
      matchKind: baseline.matchKind,
      version: baseline.info,
    } : {
      found: false,
      matchKind: null,
      version: null,
    },
    current: {
      patchPresentInPublished: patchMatches(published, patch),
      publishedStateSha256,
      draftStateSha256,
      publishedAndDraftStateEqual: publishedStateSha256 === draftStateSha256,
      publishedUnrelatedStateSha256,
      publishedHumanStateSha256,
      expectedBefore: planRow.expectedBefore || null,
      publishedUnrelatedMatchesExpectedBefore: (
        publishedUnrelatedStateSha256
        === val(planRow?.expectedBefore?.publishedUnrelatedStateSha256)
      ),
      publishedHumanMatchesExpectedBefore: (
        publishedHumanStateSha256
        === val(planRow?.expectedBefore?.publishedHumanStateSha256)
      ),
    },
    diff: {
      baselineFound: Boolean(baseline),
      totalChangedPaths: allDiffs.length,
      patchChangedPaths: categories.patch,
      humanChangedPaths: categories.human,
      volatileChangedPaths: categories.volatile,
      unrelatedChangedPaths: categories.unrelated,
      counts: {
        patch: categories.patch.length,
        human: categories.human.length,
        volatile: categories.volatile.length,
        unrelated: categories.unrelated.length,
      },
    },
    recentVersions: versions.slice(0, 30).map((row) => versionInfo(row, patch)),
  })

  const stamp = new Date().toISOString().replace(/[-:.TZ]/gu, '')
  const reportFile = path.join(
    options.reportRoot,
    `${stamp}-work-${options.targetId}-direct-overwrite-diff-v03.json`,
  )
  writeJson(reportFile, report)
  return { report, reportFile }
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
  if (!email || !password) {
    throw new Error('Read-only inspector requires RADAR_PAYLOAD_EMAIL and RADAR_PAYLOAD_PASSWORD')
  }

  const result = await runForensics({
    targetId,
    baseUrl,
    outRoot,
    reportRoot,
    backupRoot,
    email,
    password,
  })

  process.stdout.write(`${JSON.stringify({
    ok: true,
    reportFile: result.reportFile,
    targetId,
    payloadDataMutation: false,
    evidenceSelectionKind: result.report.evidenceSelection.selectionKind,
    failureLedgerFound: result.report.evidenceSelection.failureLedgerFound,
    patchPresentInPublished: result.report.current.patchPresentInPublished,
    baselineFound: result.report.baseline.found,
    baselineMatchKind: result.report.baseline.matchKind,
    changedPathCounts: result.report.diff.counts,
    unrelatedChangedPaths: result.report.diff.unrelatedChangedPaths.map((item) => item.path),
  }, null, 2)}\n`)
}

const isDirectRun = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isDirectRun) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
