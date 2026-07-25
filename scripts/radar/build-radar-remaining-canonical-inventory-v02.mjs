#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_WAVE_SIZE,
  assertReadOnlyArgs,
  buildInventory,
  canonical,
  parseArgs,
  sha256File,
  val,
  writeInventoryOutputs,
} from './build-radar-remaining-canonical-inventory-v01.mjs'

export const VERSION = 'radar-remaining-canonical-inventory-live-fetch-v0.2'
export const DEFAULT_REQUEST_ATTEMPTS = 5
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

function numberArg(value, fallback, label) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive safe integer.`)
  return parsed
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function fileEntry(root, file) {
  const absolute = path.join(root, file)
  return canonical({
    file: file.replaceAll('\\', '/'),
    bytes: fs.statSync(absolute).size,
    sha256: sha256File(absolute),
  })
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function errorText(error) {
  const cause = error?.cause
  const pieces = [error?.message || String(error)]
  if (cause?.code) pieces.push(`causeCode=${cause.code}`)
  if (cause?.errno) pieces.push(`causeErrno=${cause.errno}`)
  if (cause?.syscall) pieces.push(`causeSyscall=${cause.syscall}`)
  if (cause?.address) pieces.push(`causeAddress=${cause.address}`)
  if (cause?.port) pieces.push(`causePort=${cause.port}`)
  return pieces.join(' ')
}

export async function requestJsonWithRetry(url, options = {}, settings = {}) {
  const attempts = numberArg(settings.attempts, DEFAULT_REQUEST_ATTEMPTS, 'request attempts')
  const timeoutMs = numberArg(settings.timeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 'request timeout')
  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      })
      const text = await response.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = { raw: text } }
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 1200)}`)
        error.retryable = response.status === 408 || response.status === 429 || response.status >= 500
        throw error
      }
      return body
    } catch (error) {
      lastError = error
      const retryable = error?.retryable !== false
      if (!retryable || attempt >= attempts) {
        throw new Error(`Request failed after ${attempt} attempt(s): ${url}\n${errorText(error)}`, { cause: error })
      }
      const delayMs = Math.min(8_000, 500 * (2 ** (attempt - 1)))
      console.warn(`Transient request failure ${attempt}/${attempts}: ${url}`)
      console.warn(`${errorText(error)}; retrying in ${delayMs} ms`)
      await sleep(delayMs)
    }
  }

  throw lastError || new Error(`Request failed without an error: ${url}`)
}

async function login(baseUrl) {
  const existingToken = val(process.env.RADAR_PAYLOAD_TOKEN || process.env.PAYLOAD_EXPORT_TOKEN)
  if (existingToken) return { token: existingToken, authenticationPost: false }
  const email = val(process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL)
  const password = val(process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD)
  if (!email || !password) throw new Error('Missing Payload token or compatible audit credentials.')
  const body = await requestJsonWithRetry(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }, { attempts: 3 })
  if (!body?.token) throw new Error('Payload login did not return a token.')
  return { token: body.token, authenticationPost: true }
}

export async function fetchCollectionSerial(baseUrl, token, slug, extra = {}, settings = {}) {
  const docs = []
  let page = 1
  let totalPages = 1
  do {
    const params = new URLSearchParams({ limit: '200', page: String(page), depth: '0', ...extra })
    const url = `${baseUrl}/api/${slug}?${params}`
    const body = await requestJsonWithRetry(url, {
      headers: { Authorization: `JWT ${token}` },
    }, settings)
    const pageDocs = Array.isArray(body?.docs) ? body.docs : []
    docs.push(...pageDocs)
    totalPages = Number(body?.totalPages || 1)
    if (page === 1 || page === totalPages || page % 25 === 0) {
      console.log(`Fetch ${slug} ${extra.draft ? `draft=${extra.draft} ` : ''}page ${page}/${totalPages}; rows=${docs.length}`)
    }
    page += 1
  } while (page <= totalPages)
  return docs
}

function snapshotPaths(outDir) {
  const snapshotDir = path.join(outDir, 'snapshots')
  return {
    snapshotDir,
    draft: path.join(snapshotDir, 'works-draft.json'),
    published: path.join(snapshotDir, 'works-published.json'),
    publicConclusions: path.join(snapshotDir, 'radar-public-conclusions.json'),
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  assertReadOnlyArgs(args)
  if (!val(args['out-dir'])) throw new Error('Required: --out-dir')

  const batchSize = numberArg(args['batch-size'], DEFAULT_BATCH_SIZE, 'batch-size')
  const waveSize = numberArg(args['wave-size'], DEFAULT_WAVE_SIZE, 'wave-size')
  const expectedPublicCurrent = args['expected-public-current'] === undefined
    ? undefined
    : numberArg(args['expected-public-current'], undefined, 'expected-public-current')
  const allowPartialBatch = args['allow-partial-batch'] === true || val(args['allow-partial-batch']).toLowerCase() === 'true'
  const outDir = path.resolve(args['out-dir'])
  const snapshots = snapshotPaths(outDir)

  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(snapshots.snapshotDir, { recursive: true })

  let draftWorks
  let publishedWorks
  let publicConclusions
  let authenticationPost = false

  if (args['draft-works'] || args['published-works'] || args['public-conclusions']) {
    for (const key of ['draft-works', 'published-works', 'public-conclusions']) {
      if (!val(args[key])) throw new Error(`Snapshot mode requires --${key}`)
    }
    draftWorks = readJson(path.resolve(args['draft-works']))
    publishedWorks = readJson(path.resolve(args['published-works']))
    publicConclusions = readJson(path.resolve(args['public-conclusions']))
    writeJson(snapshots.draft, draftWorks)
    writeJson(snapshots.published, publishedWorks)
    writeJson(snapshots.publicConclusions, publicConclusions)
  } else {
    if (!val(args.url)) throw new Error('Required in live mode: --url')
    const baseUrl = val(args.url).replace(/\/+$/u, '')
    const auth = await login(baseUrl)
    authenticationPost = auth.authenticationPost

    console.log('Live inventory fetch strategy: serial collections with retry; no concurrent collection scans.')
    draftWorks = await fetchCollectionSerial(baseUrl, auth.token, 'works', { draft: 'true' })
    writeJson(snapshots.draft, draftWorks)
    console.log(`Snapshot saved: ${snapshots.draft}`)

    publishedWorks = await fetchCollectionSerial(baseUrl, auth.token, 'works', { draft: 'false' })
    writeJson(snapshots.published, publishedWorks)
    console.log(`Snapshot saved: ${snapshots.published}`)

    publicConclusions = await fetchCollectionSerial(baseUrl, auth.token, 'radar-public-conclusions')
    writeJson(snapshots.publicConclusions, publicConclusions)
    console.log(`Snapshot saved: ${snapshots.publicConclusions}`)
  }

  const inventory = buildInventory({
    draftWorks,
    publishedWorks,
    publicConclusions,
    batchSize,
    waveSize,
    expectedPublicCurrent,
    allowPartialBatch,
  })
  inventory.safety.authenticationPostPerformed = authenticationPost
  inventory.safety.liveFetchSerial = true
  inventory.safety.liveFetchRetryAttempts = DEFAULT_REQUEST_ATTEMPTS

  const sourceSnapshots = canonical({
    draftWorks: fileEntry(outDir, path.relative(outDir, snapshots.draft)),
    publishedWorks: fileEntry(outDir, path.relative(outDir, snapshots.published)),
    publicConclusions: fileEntry(outDir, path.relative(outDir, snapshots.publicConclusions)),
  })
  const summary = writeInventoryOutputs(outDir, inventory, {
    branchHead: val(args['branch-head']) || undefined,
    sourceSnapshots,
  })

  console.log('Remaining canonical Works inventory complete')
  console.log(`CanonicalWorks: ${summary.counts.canonicalWorks}`)
  console.log(`AlreadyCurrent: ${summary.counts.alreadyCurrent}`)
  console.log(`MissingCurrent: ${summary.counts.missingCurrent}`)
  console.log(`SupersedeCandidate: ${summary.counts.supersedeCandidate}`)
  console.log(`ExcludedWorks: ${summary.counts.excludedWorks}`)
  console.log(`PublicCurrentRows: ${summary.inputs.publicCurrentConclusionsRead}`)
  console.log(`ResearchBatchRows: ${summary.counts.researchBatchRows}`)
  console.log(`ResearchWaveCount: ${summary.counts.researchWaveCount}`)
  console.log(`GlobalBlockers: ${summary.globalBlockers.length}`)
  console.log(`ReadyForResearchPackaging: ${summary.readyForResearchPackaging}`)
  console.log('PayloadContentWrite: False')
  console.log('PostgreSQLWrite: False')
  console.log('ProductionApplyPackageGenerated: False')
  return summary
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
