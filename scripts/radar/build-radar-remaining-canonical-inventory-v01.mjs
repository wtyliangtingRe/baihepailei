#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const VERSION = 'radar-remaining-canonical-inventory-v0.1'
export const DEFAULT_BATCH_SIZE = 2500
export const DEFAULT_WAVE_SIZE = 250
export const ALLOWED_RESEARCH_GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F'])

export function canonical(value) {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => canonical(item))
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
    const item = canonical(value[key])
    return item === undefined ? [] : [[key, item]]
  }))
}

export function val(value) {
  return value === undefined || value === null ? '' : String(value).trim()
}

export function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file))
}

export function parseArgs(argv) {
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

export function assertReadOnlyArgs(args) {
  const forbidden = [
    'execute', 'apply', 'write', 'create', 'update', 'patch', 'delete',
    'rollback', 'migrate', 'migration', 'schema-push', 'deploy', 'confirm',
    'approval-token',
  ]
  const present = forbidden.filter((key) => args[key] !== undefined)
  if (present.length) {
    throw new Error(`Remaining canonical inventory is read-only; rejected flags: ${present.join(', ')}`)
  }
}

function numberArg(value, fallback, label) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive safe integer.`)
  return parsed
}

function relationshipId(value) {
  return val(value && typeof value === 'object' ? value.id : value)
}

function publicationKeyWorkId(value) {
  const match = val(value).match(/^work:(.+)$/u)
  return match ? val(match[1]) : ''
}

function unique(values) {
  return [...new Set((values || []).map(val).filter(Boolean))]
}

function countBy(rows, getter) {
  const result = {}
  for (const row of rows) {
    const key = val(getter(row)) || 'missing'
    result[key] = (result[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function compareIds(left, right) {
  const a = val(left)
  const b = val(right)
  if (/^\d+$/u.test(a) && /^\d+$/u.test(b)) {
    const delta = BigInt(a) - BigInt(b)
    if (delta < 0n) return -1
    if (delta > 0n) return 1
    return 0
  }
  return a.localeCompare(b)
}

function duplicateIds(rows) {
  const seen = new Set()
  const duplicates = new Set()
  for (const row of rows) {
    const id = val(row?.id)
    if (!id) continue
    if (seen.has(id)) duplicates.add(id)
    else seen.add(id)
  }
  return [...duplicates].sort(compareIds)
}

function duplicateValues(rows, getter) {
  const seen = new Set()
  const duplicates = new Set()
  for (const row of rows) {
    const value = val(getter(row))
    if (!value) continue
    if (seen.has(value)) duplicates.add(value)
    else seen.add(value)
  }
  return [...duplicates].sort()
}

function workSnapshot(work) {
  return canonical({
    workId: val(work?.id),
    publicationKey: `work:${val(work?.id)}`,
    siteId: val(work?.siteId) || undefined,
    slug: val(work?.slug) || undefined,
    title: val(work?.title),
    mediaGroup: val(work?.mediaGroup) || undefined,
    mediaType: val(work?.mediaType) || undefined,
    catalogStatus: val(work?.catalogStatus),
    payloadStatus: val(work?._status),
    isLiteVisible: work?.isLiteVisible !== false,
    isFullVisible: work?.isFullVisible !== false,
    hasEvidence: work?.hasEvidence === true,
    yuriCandidateScore: Number.isFinite(Number(work?.yuriCandidateScore))
      ? Number(work.yuriCandidateScore)
      : undefined,
  })
}

function currentConclusionSnapshot(row) {
  return canonical({
    id: val(row?.id),
    publicationKey: val(row?.publicationKey),
    work: relationshipId(row?.work),
    workIdSnapshot: val(row?.workIdSnapshot),
    workSiteId: val(row?.workSiteId) || undefined,
    title: val(row?.title),
    recordStatus: val(row?.recordStatus),
    conclusionMode: val(row?.conclusionMode),
    compatibilityGrade: val(row?.compatibilityGrade),
    conclusionSha256: val(row?.conclusionSha256).toLowerCase(),
    sourceKind: val(row?.sourceKind),
    sourcePackageId: val(row?.sourcePackageId) || undefined,
    sourcePackageSha256: val(row?.sourcePackageSha256).toLowerCase() || undefined,
    publicationVersion: val(row?.publicationVersion),
    publishedAt: val(row?.publishedAt) || undefined,
  })
}

function conclusionReferencedIds(row) {
  return unique([
    publicationKeyWorkId(row?.publicationKey),
    relationshipId(row?.work),
    val(row?.workIdSnapshot),
  ])
}

function conclusionIssues(work, row, relevantCurrentCount) {
  const expectedId = val(work?.id)
  const expectedKey = `work:${expectedId}`
  const issues = []
  if (relevantCurrentCount !== 1) issues.push(`current_conclusion_count_${relevantCurrentCount}`)
  if (val(row?.publicationKey) !== expectedKey) issues.push('publication_key_mismatch')
  if (relationshipId(row?.work) !== expectedId) issues.push('work_relationship_mismatch')
  if (val(row?.workIdSnapshot) !== expectedId) issues.push('work_id_snapshot_mismatch')
  if (val(row?.recordStatus) !== 'current') issues.push('record_status_not_current')
  if (!ALLOWED_RESEARCH_GRADES.has(val(row?.compatibilityGrade))) issues.push('grade_requires_research')
  if (!/^[0-9a-f]{64}$/u.test(val(row?.conclusionSha256).toLowerCase())) issues.push('invalid_conclusion_sha256')
  if (val(row?.title) !== val(work?.title)) issues.push('title_snapshot_mismatch')
  if (val(row?.workSiteId) !== val(work?.siteId)) issues.push('site_id_snapshot_mismatch')
  return unique(issues)
}

function publicExclusionReasons(row, canonicalIds, excludedReasonById) {
  const referenced = conclusionReferencedIds(row)
  const canonicalReferenced = referenced.filter((id) => canonicalIds.has(id))
  const reasons = []
  if (val(row?.recordStatus) !== 'current') reasons.push(`record_status_${val(row?.recordStatus) || 'missing'}`)
  if (canonicalReferenced.length && val(row?.recordStatus) === 'current') return []
  if (!referenced.length) reasons.push('no_work_identity')
  for (const id of referenced) {
    const excluded = excludedReasonById.get(id)
    if (excluded?.length) reasons.push(...excluded.map((reason) => `work_${id}_${reason}`))
    else if (!canonicalIds.has(id)) reasons.push(`work_${id}_not_found`)
  }
  return unique(reasons.length ? reasons : ['no_canonical_target'])
}

export function buildInventory({
  draftWorks,
  publishedWorks,
  publicConclusions,
  batchSize = DEFAULT_BATCH_SIZE,
  waveSize = DEFAULT_WAVE_SIZE,
  expectedPublicCurrent,
  allowPartialBatch = false,
}) {
  if (!Array.isArray(draftWorks) || !Array.isArray(publishedWorks) || !Array.isArray(publicConclusions)) {
    throw new TypeError('draftWorks, publishedWorks, and publicConclusions must be arrays.')
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive safe integer.')
  if (!Number.isSafeInteger(waveSize) || waveSize < 1) throw new Error('waveSize must be a positive safe integer.')
  if (batchSize % waveSize !== 0) throw new Error('batchSize must be exactly divisible by waveSize.')

  const globalBlockers = []
  const duplicateDraftIds = duplicateIds(draftWorks)
  const duplicatePublishedIds = duplicateIds(publishedWorks)
  if (duplicateDraftIds.length) globalBlockers.push(`duplicate_draft_work_ids_${duplicateDraftIds.length}`)
  if (duplicatePublishedIds.length) globalBlockers.push(`duplicate_published_work_ids_${duplicatePublishedIds.length}`)

  const draftById = new Map(draftWorks.map((work) => [val(work?.id), work]).filter(([id]) => id))
  const publishedById = new Map(publishedWorks.map((work) => [val(work?.id), work]).filter(([id]) => id))
  const allWorkIds = unique([...draftById.keys(), ...publishedById.keys()]).sort(compareIds)
  const canonicalWorks = []
  const excludedWorks = []
  const excludedReasonById = new Map()

  for (const id of allWorkIds) {
    const draft = draftById.get(id)
    const published = publishedById.get(id)
    const reasons = []
    if (!draft) reasons.push('missing_draft_snapshot')
    if (!published) reasons.push('missing_published_snapshot')
    if (published && val(published.catalogStatus) !== 'active') {
      reasons.push(`catalog_status_${val(published.catalogStatus) || 'missing'}`)
    }

    if (reasons.length) {
      const row = canonical({
        workId: id,
        title: val(published?.title || draft?.title),
        siteId: val(published?.siteId || draft?.siteId) || undefined,
        reasons: unique(reasons),
        draft: draft ? workSnapshot(draft) : undefined,
        published: published ? workSnapshot(published) : undefined,
      })
      excludedWorks.push(row)
      excludedReasonById.set(id, row.reasons)
    } else {
      canonicalWorks.push(published)
    }
  }

  const currentPublic = publicConclusions.filter((row) => val(row?.recordStatus) === 'current')
  const duplicatePublicationKeys = duplicateValues(currentPublic, (row) => row?.publicationKey)
  if (duplicatePublicationKeys.length) globalBlockers.push(`duplicate_current_publication_keys_${duplicatePublicationKeys.length}`)
  if (expectedPublicCurrent !== undefined && currentPublic.length !== expectedPublicCurrent) {
    globalBlockers.push(`public_current_expected_${expectedPublicCurrent}_received_${currentPublic.length}`)
  }

  const currentByReferencedId = new Map()
  for (const row of currentPublic) {
    for (const id of conclusionReferencedIds(row)) {
      const values = currentByReferencedId.get(id) || []
      values.push(row)
      currentByReferencedId.set(id, values)
    }
  }

  const alreadyCurrent = []
  const missingCurrent = []
  const supersedeCandidate = []
  const canonicalIds = new Set(canonicalWorks.map((work) => val(work?.id)))

  for (const work of canonicalWorks.sort((a, b) => compareIds(a?.id, b?.id))) {
    const id = val(work?.id)
    const relevant = currentByReferencedId.get(id) || []
    const base = workSnapshot(work)
    if (!relevant.length) {
      missingCurrent.push(canonical({
        inventoryStatus: 'missing_current',
        ...base,
        currentPublicConclusionCount: 0,
      }))
      continue
    }

    const primary = relevant.find((row) => val(row?.publicationKey) === `work:${id}`) || relevant[0]
    const issues = conclusionIssues(work, primary, relevant.length)
    const row = canonical({
      inventoryStatus: issues.length ? 'supersede_candidate' : 'already_current',
      ...base,
      currentPublicConclusionCount: relevant.length,
      currentPublicConclusion: currentConclusionSnapshot(primary),
      supersedeReasons: issues.length ? issues : undefined,
      relatedCurrentConclusionIds: relevant.map((item) => val(item?.id)).filter(Boolean).sort(),
    })
    if (issues.length) supersedeCandidate.push(row)
    else alreadyCurrent.push(row)
  }

  const excludedPublicConclusions = publicConclusions.flatMap((row) => {
    const reasons = publicExclusionReasons(row, canonicalIds, excludedReasonById)
    return reasons.length
      ? [canonical({
          publicConclusion: currentConclusionSnapshot(row),
          reasons,
        })]
      : []
  })

  const candidates = [
    ...supersedeCandidate.map((row) => ({ ...row, researchPriority: 1 })),
    ...missingCurrent.map((row) => ({ ...row, researchPriority: 2 })),
  ].sort((a, b) => a.researchPriority - b.researchPriority || compareIds(a.workId, b.workId))

  if (!allowPartialBatch && candidates.length < batchSize) {
    globalBlockers.push(`research_candidates_below_batch_size_${candidates.length}_of_${batchSize}`)
  }
  const researchBatch = candidates.slice(0, batchSize).map((row, index) => canonical({
    batchOrdinal: index + 1,
    batchId: 'batch-0001',
    waveId: `wave-${String(Math.floor(index / waveSize) + 1).padStart(2, '0')}`,
    waveOrdinal: (index % waveSize) + 1,
    ...row,
  }))

  const waves = []
  const expectedWaveCount = Math.ceil(researchBatch.length / waveSize)
  for (let index = 0; index < expectedWaveCount; index += 1) {
    const rows = researchBatch.slice(index * waveSize, (index + 1) * waveSize)
    waves.push({
      waveId: `wave-${String(index + 1).padStart(2, '0')}`,
      rows,
    })
  }

  const exactFullBatch = researchBatch.length === batchSize
  const exactWaveShape = waves.length === batchSize / waveSize && waves.every((wave) => wave.rows.length === waveSize)
  const readyForResearchPackaging = globalBlockers.length === 0
    && (allowPartialBatch ? researchBatch.length > 0 : exactFullBatch && exactWaveShape)

  return canonical({
    version: VERSION,
    inputs: {
      draftWorksRead: draftWorks.length,
      publishedWorksRead: publishedWorks.length,
      publicConclusionsRead: publicConclusions.length,
      publicCurrentConclusionsRead: currentPublic.length,
      expectedPublicCurrent: expectedPublicCurrent ?? undefined,
    },
    counts: {
      canonicalWorks: canonicalWorks.length,
      alreadyCurrent: alreadyCurrent.length,
      missingCurrent: missingCurrent.length,
      supersedeCandidate: supersedeCandidate.length,
      excludedWorks: excludedWorks.length,
      excludedPublicConclusions: excludedPublicConclusions.length,
      researchCandidates: candidates.length,
      researchBatchRows: researchBatch.length,
      researchWaveCount: waves.length,
    },
    integrity: {
      duplicateDraftIds,
      duplicatePublishedIds,
      duplicateCurrentPublicationKeys: duplicatePublicationKeys,
      canonicalCoverageComplete: alreadyCurrent.length + missingCurrent.length + supersedeCandidate.length === canonicalWorks.length,
      currentPublicByGrade: countBy(currentPublic, (row) => row?.compatibilityGrade),
      excludedWorksByReason: countBy(excludedWorks.flatMap((row) => row.reasons.map((reason) => ({ reason }))), (row) => row.reason),
      supersedeByReason: countBy(supersedeCandidate.flatMap((row) => row.supersedeReasons.map((reason) => ({ reason }))), (row) => row.reason),
    },
    configuration: {
      batchSize,
      waveSize,
      allowPartialBatch,
      expectedWaveCount: batchSize / waveSize,
    },
    globalBlockers: unique(globalBlockers),
    readyForResearchPackaging,
    safety: {
      payloadRead: true,
      payloadContentWrite: false,
      authenticationPostOnly: true,
      directPostgresqlRead: false,
      directPostgresqlWrite: false,
      migrationGenerated: false,
      migrationExecuted: false,
      schemaPush: false,
      productionApplyPackageGenerated: false,
    },
    rows: {
      alreadyCurrent,
      missingCurrent,
      supersedeCandidate,
      excludedWorks,
      excludedPublicConclusions,
      researchBatch,
      waves,
    },
  })
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function fileEntry(root, file) {
  const absolute = path.join(root, file)
  return canonical({
    file: file.replaceAll('\\', '/'),
    bytes: fs.statSync(absolute).size,
    sha256: sha256File(absolute),
  })
}

export function writeInventoryOutputs(outDir, inventory, metadata = {}) {
  fs.mkdirSync(outDir, { recursive: true })
  const files = {
    alreadyCurrent: 'already-current.jsonl',
    missingCurrent: 'missing-current.jsonl',
    supersedeCandidate: 'supersede-candidate.jsonl',
    excludedWorks: 'excluded-works.jsonl',
    excludedPublicConclusions: 'excluded-public-conclusions.jsonl',
    researchBatch: 'research-batch-0001.jsonl',
  }
  writeJsonl(path.join(outDir, files.alreadyCurrent), inventory.rows.alreadyCurrent)
  writeJsonl(path.join(outDir, files.missingCurrent), inventory.rows.missingCurrent)
  writeJsonl(path.join(outDir, files.supersedeCandidate), inventory.rows.supersedeCandidate)
  writeJsonl(path.join(outDir, files.excludedWorks), inventory.rows.excludedWorks)
  writeJsonl(path.join(outDir, files.excludedPublicConclusions), inventory.rows.excludedPublicConclusions)
  writeJsonl(path.join(outDir, files.researchBatch), inventory.rows.researchBatch)

  const waveManifest = []
  for (const wave of inventory.rows.waves) {
    const waveFile = `waves/${wave.waveId}.jsonl`
    const manifestFile = `waves/${wave.waveId}.manifest.json`
    writeJsonl(path.join(outDir, waveFile), wave.rows)
    const entry = fileEntry(outDir, waveFile)
    const waveMetadata = canonical({
      schemaVersion: 1,
      batchId: 'batch-0001',
      waveId: wave.waveId,
      rows: wave.rows.length,
      firstWorkId: wave.rows[0]?.workId,
      lastWorkId: wave.rows.at(-1)?.workId,
      payload: entry,
      independentlyRecoverable: true,
    })
    writeJson(path.join(outDir, manifestFile), waveMetadata)
    waveManifest.push(canonical({ ...waveMetadata, manifest: fileEntry(outDir, manifestFile) }))
  }
  writeJson(path.join(outDir, 'research-batch-0001-wave-manifest.json'), waveManifest)

  const generatedAt = metadata.generatedAt || new Date().toISOString()
  const summary = canonical({
    schemaVersion: 1,
    generatedAt,
    version: inventory.version,
    branchHead: metadata.branchHead || undefined,
    sourceSnapshots: metadata.sourceSnapshots || undefined,
    inputs: inventory.inputs,
    counts: inventory.counts,
    integrity: inventory.integrity,
    configuration: inventory.configuration,
    globalBlockers: inventory.globalBlockers,
    readyForResearchPackaging: inventory.readyForResearchPackaging,
    safety: inventory.safety,
    outputs: canonical({
      ...files,
      waveManifest: 'research-batch-0001-wave-manifest.json',
      summary: 'inventory-summary.json',
    }),
  })
  writeJson(path.join(outDir, 'inventory-summary.json'), summary)

  const allFiles = fs.readdirSync(outDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(outDir, path.join(entry.parentPath || entry.path, entry.name)))
    .filter((file) => file.replaceAll('\\', '/') !== 'manifest.json')
    .sort()
  writeJson(path.join(outDir, 'manifest.json'), allFiles.map((file) => fileEntry(outDir, file)))
  return summary
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

async function login(baseUrl) {
  const existingToken = val(process.env.RADAR_PAYLOAD_TOKEN || process.env.PAYLOAD_EXPORT_TOKEN)
  if (existingToken) return { token: existingToken, authenticationPost: false }
  const email = val(process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL)
  const password = val(process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD)
  if (!email || !password) throw new Error('Missing Payload token or compatible audit credentials.')
  const body = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!body?.token) throw new Error('Payload login did not return a token.')
  return { token: body.token, authenticationPost: true }
}

async function fetchCollection(baseUrl, token, slug, extra = {}) {
  const docs = []
  let page = 1
  let totalPages = 1
  do {
    const params = new URLSearchParams({ limit: '200', page: String(page), depth: '0', ...extra })
    const body = await requestJson(`${baseUrl}/api/${slug}?${params}`, {
      headers: { Authorization: `JWT ${token}` },
    })
    docs.push(...(Array.isArray(body?.docs) ? body.docs : []))
    totalPages = Number(body?.totalPages || 1)
    page += 1
  } while (page <= totalPages)
  return docs
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  assertReadOnlyArgs(args)
  if (!val(args['out-dir'])) throw new Error('Required: --out-dir')

  const batchSize = numberArg(args['batch-size'], DEFAULT_BATCH_SIZE, 'batch-size')
  const waveSize = numberArg(args['wave-size'], DEFAULT_WAVE_SIZE, 'wave-size')
  const expectedPublicCurrent = args['expected-public-current'] === undefined
    ? undefined
    : numberArg(args['expected-public-current'], undefined, 'expected-public-current')
  const allowPartialBatch = args['allow-partial-batch'] === true || val(args['allow-partial-batch']).toLowerCase() === 'true'
  const outDir = path.resolve(args['out-dir'])
  const snapshotDir = path.join(outDir, 'snapshots')

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
  } else {
    if (!val(args.url)) throw new Error('Required in live mode: --url')
    const baseUrl = val(args.url).replace(/\/+$/u, '')
    const auth = await login(baseUrl)
    authenticationPost = auth.authenticationPost
    ;[draftWorks, publishedWorks, publicConclusions] = await Promise.all([
      fetchCollection(baseUrl, auth.token, 'works', { draft: 'true' }),
      fetchCollection(baseUrl, auth.token, 'works', { draft: 'false' }),
      fetchCollection(baseUrl, auth.token, 'radar-public-conclusions'),
    ])
  }

  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(snapshotDir, { recursive: true })
  const draftSnapshot = path.join(snapshotDir, 'works-draft.json')
  const publishedSnapshot = path.join(snapshotDir, 'works-published.json')
  const publicSnapshot = path.join(snapshotDir, 'radar-public-conclusions.json')
  writeJson(draftSnapshot, draftWorks)
  writeJson(publishedSnapshot, publishedWorks)
  writeJson(publicSnapshot, publicConclusions)

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
  const sourceSnapshots = canonical({
    draftWorks: fileEntry(outDir, path.relative(outDir, draftSnapshot)),
    publishedWorks: fileEntry(outDir, path.relative(outDir, publishedSnapshot)),
    publicConclusions: fileEntry(outDir, path.relative(outDir, publicSnapshot)),
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
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
