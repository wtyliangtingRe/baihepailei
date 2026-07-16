#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERSION = 'ai-radar-research-records-import-v0.1'
export const EXPECTED_BATCHES = 354
export const EXPECTED_ROWS = 25048
export const PROGRAM_ID = 'research-program-20260715-155148'
export const IMPORT_BATCH = 'ai-radar-research-complete-v01'
export const APPLY_CONFIRMATION = 'IMPORT-AI-RADAR-RESEARCH-25048'

const DEFAULT_REPO = 'D:/0GitHubtest/Baihepailei'
const DEFAULT_PROGRAM = 'D:/Baihepailei-analysis/research-program-20260715-155148'
const DEFAULT_MANIFEST = 'data_local/staging/ai-radar/research-complete-v01/completion-manifest.json'
const DEFAULT_OUT = 'data_local/staging/ai-radar/research-records-import-v01'

function val(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeDateTime(value) {
  const text = val(value)
  if (!text) return ''
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString()
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

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return
  for (const raw of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u)
    if (!match || process.env[match[1]] !== undefined) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value
  }
}

export function sha256File(file) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(file))
  return hash.digest('hex')
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`Invalid JSONL ${file}:${index + 1}: ${error.message}`)
      }
    })
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '',
    'utf8',
  )
}

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8')
}

function walk(root) {
  const files = []
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) files.push(full)
    }
  }
  return files
}

function batchIdFromResponseFile(file) {
  const base = path.basename(file)
  const parent = path.basename(path.dirname(file))
  if (/^W\d{2}-.+-\d{4}$/u.test(parent)) return parent
  const match = base.match(/^(W\d{2}-.+-\d{4})-response\.jsonl$/u)
  return match?.[1] || ''
}

export function discoverResponseFiles(programRoot) {
  if (!fs.existsSync(programRoot)) throw new Error(`Research program not found: ${programRoot}`)
  const candidates = walk(programRoot)
    .filter((file) => path.basename(file) === 'response.jsonl' || /-response\.jsonl$/u.test(path.basename(file)))

  const byBatch = new Map()
  for (const file of candidates) {
    const batchId = batchIdFromResponseFile(file)
    if (!batchId) continue
    const existing = byBatch.get(batchId)
    if (!existing) {
      byBatch.set(batchId, file)
      continue
    }
    const existingHash = sha256File(existing)
    const currentHash = sha256File(file)
    if (existingHash !== currentHash) {
      throw new Error(`Conflicting response files for ${batchId}: ${existing} / ${file}`)
    }
    if (path.basename(file) === 'response.jsonl') byBatch.set(batchId, file)
  }
  return byBatch
}

function normalizeStringArray(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))].sort()
}

function normalizeSources(value) {
  const map = new Map()
  for (const source of Array.isArray(value) ? value : []) {
    const url = val(source?.url)
    if (!url) continue
    const row = {
      title: val(source?.title),
      url,
      sourceType: val(source?.sourceType) || 'other',
    }
    map.set(`${row.url}\u0000${row.title}\u0000${row.sourceType}`, row)
  }
  return [...map.values()].sort((a, b) => (
    a.url.localeCompare(b.url)
    || a.title.localeCompare(b.title)
    || a.sourceType.localeCompare(b.sourceType)
  ))
}

function normalizeQuestions(value) {
  return normalizeStringArray(value).map((item) => ({ value: item }))
}

function normalizeRelationship(value) {
  if (value && typeof value === 'object') return String(value.id ?? '')
  return String(value ?? '')
}

export function normalizeResearchRecord(record) {
  return {
    researchKey: val(record?.researchKey),
    title: val(record?.title),
    programId: val(record?.programId),
    importBatch: val(record?.importBatch),
    batchId: val(record?.batchId),
    wave: val(record?.wave),
    lane: val(record?.lane),
    milestone: Number(record?.milestone || 0),
    work: normalizeRelationship(record?.work),
    workIdSnapshot: val(record?.workIdSnapshot),
    workSiteId: val(record?.workSiteId),
    recordShape: val(record?.recordShape),
    researchStatus: val(record?.researchStatus),
    yuriRelevance: val(record?.yuriRelevance),
    riskSignals: normalizeStringArray(record?.riskSignals),
    proposedLikelyGrade: val(record?.proposedLikelyGrade),
    proposedBestGrade: val(record?.proposedBestGrade),
    proposedWorstGrade: val(record?.proposedWorstGrade),
    sourceSummary: val(record?.sourceSummary),
    sources: normalizeSources(record?.sources),
    unresolvedQuestions: normalizeQuestions(
      (Array.isArray(record?.unresolvedQuestions) ? record.unresolvedQuestions : [])
        .map((item) => typeof item === 'object' ? item?.value : item),
    ),
    confidencePercent: Number(record?.confidencePercent || 0),
    recommendedNextAction: val(record?.recommendedNextAction),
    recommendedNextQueue: val(record?.recommendedNextQueue),
    researchNote: val(record?.researchNote),
    sourceResponseSha256: val(record?.sourceResponseSha256),
    importedAt: normalizeDateTime(record?.importedAt),
    recordStatus: val(record?.recordStatus) || 'current',
  }
}

export function buildResearchRecord(row, batch, importedAt) {
  const recordShape = Object.hasOwn(row, 'recommendedNextAction') ? 'blocked' : 'catalog'
  return normalizeResearchRecord({
    researchKey: `${PROGRAM_ID}|${String(row.workId)}|${String(row.siteId)}`,
    title: String(row.title || ''),
    programId: PROGRAM_ID,
    importBatch: IMPORT_BATCH,
    batchId: batch.batchId,
    wave: batch.wave,
    lane: batch.lane,
    milestone: batch.milestone,
    work: String(row.workId),
    workIdSnapshot: String(row.workId),
    workSiteId: String(row.siteId),
    recordShape,
    researchStatus: String(row.researchStatus || ''),
    yuriRelevance: recordShape === 'catalog' ? String(row.yuriRelevance || '') : '',
    riskSignals: recordShape === 'catalog' ? row.riskSignals : [],
    proposedLikelyGrade: recordShape === 'blocked' ? String(row.proposedLikelyGrade || '') : '',
    proposedBestGrade: recordShape === 'blocked' ? String(row.proposedBestGrade || '') : '',
    proposedWorstGrade: recordShape === 'blocked' ? String(row.proposedWorstGrade || '') : '',
    sourceSummary: String(row.sourceSummary || ''),
    sources: row.sources,
    unresolvedQuestions: recordShape === 'blocked' ? row.unresolvedQuestions : [],
    confidencePercent: Number(row.confidencePercent || 0),
    recommendedNextAction: recordShape === 'blocked' ? String(row.recommendedNextAction || '') : '',
    recommendedNextQueue: recordShape === 'catalog' ? String(row.recommendedNextQueue || '') : '',
    researchNote: String(row.researchNote || ''),
    sourceResponseSha256: batch.responseSha256,
    importedAt,
    recordStatus: 'current',
  })
}

export function stableEqual(left, right) {
  return JSON.stringify(normalizeResearchRecord(left)) === JSON.stringify(normalizeResearchRecord(right))
}

export function toPayloadData(record) {
  const normalized = normalizeResearchRecord(record)
  const data = {
    ...normalized,
    work: /^\d+$/u.test(normalized.work) ? Number(normalized.work) : normalized.work,
  }

  for (const field of [
    'yuriRelevance',
    'proposedLikelyGrade',
    'proposedBestGrade',
    'proposedWorstGrade',
    'recommendedNextAction',
    'recommendedNextQueue',
  ]) {
    if (!data[field]) delete data[field]
  }

  return data
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { raw: text }
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 1000)}`)
  }
  return payload
}

async function login(repoRoot, baseUrl) {
  for (const name of ['.env', '.env.local', '.env.development.local']) {
    loadEnvFile(path.join(repoRoot, name))
  }
  const email = process.env.RADAR_PAYLOAD_EMAIL
    || process.env.PAYLOAD_EXPORT_EMAIL
    || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.RADAR_PAYLOAD_PASSWORD
    || process.env.PAYLOAD_EXPORT_PASSWORD
    || process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) throw new Error('Missing Payload login environment variables.')
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!result?.token) throw new Error('Payload login did not return a token')
  return result.token
}

async function fetchAll(baseUrl, token, slug) {
  const docs = []
  let page = 1
  let totalPages = 1
  do {
    const params = new URLSearchParams({
      limit: '200',
      page: String(page),
      depth: '0',
      draft: 'true',
    })
    const result = await requestJson(`${baseUrl}/api/${slug}?${params}`, {
      headers: { Authorization: `JWT ${token}` },
    })
    docs.push(...(Array.isArray(result?.docs) ? result.docs : []))
    totalPages = Number(result?.totalPages || 1)
    page += 1
  } while (page <= totalPages)
  return docs
}

function loadResearchRows(programRoot, manifestFile) {
  const manifest = readJson(manifestFile)
  if (!Array.isArray(manifest?.batches) || manifest.batches.length !== EXPECTED_BATCHES) {
    throw new Error(`Expected ${EXPECTED_BATCHES} manifest batches`)
  }
  if (Number(manifest?.output?.totalRows) !== EXPECTED_ROWS) {
    throw new Error(`Expected manifest totalRows=${EXPECTED_ROWS}`)
  }

  const discovered = discoverResponseFiles(programRoot)
  const rows = []
  const byBatch = []
  for (const batch of manifest.batches) {
    const file = discovered.get(batch.batchId)
    if (!file) throw new Error(`Missing installed response for ${batch.batchId}`)
    const actualSha = sha256File(file)
    if (actualSha !== batch.responseSha256) {
      throw new Error(`Response SHA mismatch for ${batch.batchId}: expected=${batch.responseSha256} actual=${actualSha}`)
    }
    const batchRows = readJsonl(file)
    if (batchRows.length !== Number(batch.rows)) {
      throw new Error(`Response row mismatch for ${batch.batchId}: expected=${batch.rows} actual=${batchRows.length}`)
    }
    for (const row of batchRows) rows.push(buildResearchRecord(row, batch, manifest.generatedAt))
    byBatch.push({ batchId: batch.batchId, file, rows: batchRows.length, sha256: actualSha })
  }

  if (rows.length !== EXPECTED_ROWS) {
    throw new Error(`Expected ${EXPECTED_ROWS} research rows, received ${rows.length}`)
  }
  const keys = rows.map((row) => row.researchKey)
  if (new Set(keys).size !== rows.length) throw new Error('Duplicate researchKey in source rows')
  return { manifest, rows, byBatch }
}

function classifyRows(sourceRows, works, existingRecords) {
  const worksById = new Map(works.map((work) => [String(work.id), work]))
  const existingByKey = new Map(existingRecords.map((record) => [String(record.researchKey), record]))
  const results = []
  for (const target of sourceRows) {
    const work = worksById.get(target.workIdSnapshot)
    if (!work) {
      results.push({ status: 'blocked', blockers: ['work_not_found'], target })
      continue
    }
    if (String(work.siteId || '') !== target.workSiteId) {
      results.push({
        status: 'blocked',
        blockers: [`site_id_mismatch:${String(work.siteId || '')}`],
        target,
      })
      continue
    }
    const current = existingByKey.get(target.researchKey)
    if (!current) {
      results.push({ status: 'would_create', blockers: [], target })
      continue
    }
    if (stableEqual(current, target)) {
      results.push({ status: 'already_current', blockers: [], target, currentId: current.id })
      continue
    }
    results.push({ status: 'would_update', blockers: [], target, currentId: current.id })
  }
  return results
}

function countByStatus(results) {
  const counts = {}
  for (const result of results) counts[result.status] = (counts[result.status] || 0) + 1
  return counts
}

async function verifyRecord(baseUrl, token, id, target) {
  const result = await requestJson(`${baseUrl}/api/radar-research-records/${encodeURIComponent(id)}?depth=0&draft=true`, {
    headers: { Authorization: `JWT ${token}` },
  })
  const doc = result?.doc || result
  if (!stableEqual(doc, target)) throw new Error(`Post-write verification mismatch for ${target.researchKey}`)
  return doc
}

async function applyRows(baseUrl, token, results, outDir) {
  const journal = path.join(outDir, 'write-intent.jsonl')
  const applied = path.join(outDir, 'applied.jsonl')
  const failed = path.join(outDir, 'failed.jsonl')
  let appliedCount = 0
  let requestCount = 0

  for (const result of results) {
    if (!['would_create', 'would_update'].includes(result.status)) continue
    appendJsonl(journal, {
      savedAt: new Date().toISOString(),
      status: result.status,
      currentId: result.currentId || null,
      researchKey: result.target.researchKey,
      target: result.target,
      automaticRollback: false,
    })
    try {
      let response
      if (result.status === 'would_create') {
        response = await requestJson(`${baseUrl}/api/radar-research-records?depth=0`, {
          method: 'POST',
          headers: { Authorization: `JWT ${token}` },
          body: JSON.stringify(toPayloadData(result.target)),
        })
      } else {
        response = await requestJson(
          `${baseUrl}/api/radar-research-records/${encodeURIComponent(result.currentId)}?depth=0&draft=true`,
          {
            method: 'PATCH',
            headers: { Authorization: `JWT ${token}` },
            body: JSON.stringify(toPayloadData(result.target)),
          },
        )
      }
      requestCount += 1
      const id = response?.doc?.id || response?.id
      if (!id) throw new Error('Write did not return a record ID')
      await verifyRecord(baseUrl, token, id, result.target)
      appendJsonl(applied, {
        appliedAt: new Date().toISOString(),
        status: result.status,
        id,
        researchKey: result.target.researchKey,
        verified: true,
      })
      appliedCount += 1
      if (appliedCount % 100 === 0) {
        console.log(`Applied and verified ${appliedCount}`)
      }
    } catch (error) {
      appendJsonl(failed, {
        failedAt: new Date().toISOString(),
        status: result.status,
        currentId: result.currentId || null,
        researchKey: result.target.researchKey,
        error: error.message,
      })
      throw error
    }
  }
  return { appliedCount, requestCount, journal, applied, failed }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const repoRoot = path.resolve(val(args.repo) || DEFAULT_REPO)
  const programRoot = path.resolve(val(args.program) || DEFAULT_PROGRAM)
  const manifestFile = path.resolve(repoRoot, val(args.manifest) || DEFAULT_MANIFEST)
  const outDir = path.resolve(repoRoot, val(args['out-dir']) || DEFAULT_OUT)
  const baseUrl = val(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const apply = Boolean(args.apply)

  if (apply && val(args.confirm) !== APPLY_CONFIRMATION) {
    throw new Error(`Exact apply confirmation required: ${APPLY_CONFIRMATION}`)
  }

  const source = loadResearchRows(programRoot, manifestFile)
  const token = await login(repoRoot, baseUrl)
  const works = await fetchAll(baseUrl, token, 'works')
  const existing = await fetchAll(baseUrl, token, 'radar-research-records')
  const results = classifyRows(source.rows, works, existing)
  const counts = countByStatus(results)
  const blockers = results.filter((result) => result.status === 'blocked')

  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  writeJsonl(path.join(outDir, 'plan.jsonl'), results)
  writeJsonl(path.join(outDir, 'would-create.jsonl'), results.filter((row) => row.status === 'would_create'))
  writeJsonl(path.join(outDir, 'would-update.jsonl'), results.filter((row) => row.status === 'would_update'))
  writeJsonl(path.join(outDir, 'already-current.jsonl'), results.filter((row) => row.status === 'already_current'))
  writeJsonl(path.join(outDir, 'blocked.jsonl'), blockers)
  writeJson(path.join(outDir, 'source-batches.json'), source.byBatch)

  const completePlan = results.length === EXPECTED_ROWS
    && blockers.length === 0
    && (
      Number(counts.would_create || 0)
      + Number(counts.would_update || 0)
      + Number(counts.already_current || 0)
    ) === EXPECTED_ROWS

  let applyResult = null
  if (apply) {
    if (!completePlan) throw new Error('Import plan is not complete; apply is blocked.')
    applyResult = await applyRows(baseUrl, token, results, outDir)
  }

  let finalCounts = counts
  let finalComplete = completePlan
  if (apply) {
    const refreshed = await fetchAll(baseUrl, token, 'radar-research-records')
    const finalResults = classifyRows(source.rows, works, refreshed)
    finalCounts = countByStatus(finalResults)
    writeJsonl(path.join(outDir, 'final-verification.jsonl'), finalResults)
    finalComplete = finalResults.length === EXPECTED_ROWS
      && Number(finalCounts.already_current || 0) === EXPECTED_ROWS
      && Number(finalCounts.blocked || 0) === 0
      && Number(finalCounts.would_create || 0) === 0
      && Number(finalCounts.would_update || 0) === 0
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    complete: apply ? finalComplete : completePlan,
    mode: apply ? 'apply' : 'dry_run',
    programId: PROGRAM_ID,
    importBatch: IMPORT_BATCH,
    sourceManifest: manifestFile,
    sourceManifestSha256: sha256File(manifestFile),
    sourceBatches: source.byBatch.length,
    sourceRows: source.rows.length,
    payloadWorksRead: works.length,
    existingResearchRecordsRead: existing.length,
    planCounts: counts,
    finalCounts,
    blockers: blockers.length,
    applyResult,
    outputs: {
      root: outDir,
      plan: path.join(outDir, 'plan.jsonl'),
      blocked: path.join(outDir, 'blocked.jsonl'),
      summary: path.join(outDir, 'summary.json'),
    },
    safety: {
      worksRead: true,
      worksWrite: false,
      researchCollectionWrite: apply,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      titleOnlyMatchingAllowed: false,
      exactWorkIdAndSiteIdRequired: true,
      sourceResponseHashesVerified: true,
      postWriteReadbackVerification: apply,
      automaticRollback: false,
    },
    nextStep: apply
      ? (finalComplete
        ? 'Full internal research archive import is complete.'
        : 'Keep the database checkpoint and review the failed/write-intent journals before resuming.')
      : (completePlan
        ? `Create and verify a fresh database checkpoint, then rerun with --apply --confirm ${APPLY_CONFIRMATION}.`
        : 'Fix blockers before any write.'),
  }
  writeJson(path.join(outDir, 'summary.json'), summary)
  console.log(JSON.stringify({ ok: summary.complete, summary }, null, 2))
  if (!summary.complete) process.exitCode = 2
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
