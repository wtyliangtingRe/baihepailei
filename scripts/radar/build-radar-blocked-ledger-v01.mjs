#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'radar-blocked-ledger-v0.1'
const EXPECTED_AUDIT_ZIP_SHA256 = '7877020d0314352531290be0d4e334d2b17e18e6f552591dd14e30431f7837ba'
const EXPECTED_PUBLIC_BLOCKED_SHA256 = '4017846c1fe5f72fc7389f3f07b7402af3d0a4ad5889d7bb314907a0b920bd8c'
const EXPECTED_PRIVATE_BLOCKED_SHA256 = '74ee4db765a6e613efe4cf824594a57b43a484a201d0a56e66dc7ae20fb9b7c5'
const EXPECTED_PUBLIC_BLOCKED = 1805
const EXPECTED_PRIVATE_BLOCKED = 1444
const DEFAULT_WAVE_SIZE = 250

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

function required(args, key) {
  const value = String(args[key] || '').trim()
  if (!value) throw new Error(`Required: --${key}`)
  return value
}

function readText(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`)
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
}
function readJson(file) { return JSON.parse(readText(file)) }
function readJsonl(file) {
  const rows = []
  for (const [index, line] of readText(file).split(/\r?\n/u).entries()) {
    if (!line.trim()) continue
    try { rows.push(JSON.parse(line)) }
    catch (error) { throw new Error(`Invalid JSONL ${file}:${index + 1}: ${error.message}`) }
  }
  return rows
}
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }
function writeJsonl(file, rows) { fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8') }
function sha256Bytes(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function sha256File(file) { return sha256Bytes(fs.readFileSync(file)) }
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}
function canonicalHash(value) { return sha256Bytes(Buffer.from(`${JSON.stringify(canonicalize(value))}\n`, 'utf8')) }
function asArray(value) { return Array.isArray(value) ? value : [] }
function uniqueStrings(values) {
  return [...new Set(values.flatMap((value) => asArray(value)).map((value) => String(value || '').trim()).filter(Boolean))].sort()
}
function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}
function toTimestamp(value) {
  const text = firstNonEmpty(value)
  if (!text) return null
  const date = new Date(text)
  if (Number.isNaN(date.valueOf())) return null
  return date.toISOString()
}

function assertManifest(directory) {
  const manifestPath = path.join(directory, 'manifest.json')
  const manifest = readJson(manifestPath)
  if (!Array.isArray(manifest) || !manifest.length) throw new Error('Audit manifest is empty or invalid.')
  for (const entry of manifest) {
    const file = path.join(directory, String(entry.file || ''))
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Manifest file missing: ${entry.file}`)
    const bytes = fs.statSync(file).size
    const hash = sha256File(file)
    if (bytes !== Number(entry.bytes) || hash !== String(entry.sha256 || '').toLowerCase()) {
      throw new Error(`Manifest mismatch: ${entry.file}`)
    }
  }
}

function extractWorkId(row) {
  return firstNonEmpty(
    row?.publicRecord?.work,
    row?.publicRecord?.workIdSnapshot,
    row?.workId,
    row?.work?.id,
    row?.source?.workId,
    row?.assessment?.workId,
  )
}
function extractTitle(row) {
  return firstNonEmpty(
    row?.title,
    row?.work?.title,
    row?.source?.title,
    row?.assessment?.title,
    row?.publicRecord?.titleSnapshot,
  )
}
function extractPublicationKey(row, workId) {
  return firstNonEmpty(row?.publicRecord?.publicationKey, row?.publicationKey, workId ? `work:${workId}` : '')
}
function extractAssessment(row) {
  return row?.publicRecord?.radarAssessment || row?.radarAssessment || row?.assessment || row?.sourceAssessment || null
}
function extractAssessedAt(row) {
  const assessment = extractAssessment(row)
  return toTimestamp(
    assessment?.assessedAt ||
    row?.assessedAt ||
    row?.source?.assessedAt ||
    row?.generatedAt,
  )
}
function extractConclusionHash(row) {
  return firstNonEmpty(
    row?.publicRecord?.conclusionSha256,
    row?.conclusionSha256,
    row?.source?.conclusionSha256,
    row?.privateConclusionSha256,
  ).toLowerCase()
}
function extractBlockers(row, kind) {
  const common = [row?.blockers]
  if (kind === 'public') common.push(row?.publicBlockers, row?.publicationBlockers)
  if (kind === 'private') common.push(row?.privateBlockers)
  return uniqueStrings(common)
}
function extractSourcePackage(row) {
  return firstNonEmpty(
    row?.sourcePackage,
    row?.source?.packageId,
    row?.source?.batchId,
    row?.batchId,
    row?.assessmentBatch,
  )
}
function extractPolicyVersion(row) {
  const assessment = extractAssessment(row)
  return firstNonEmpty(assessment?.policyVersion, row?.policyVersion, row?.source?.policyVersion)
}
function extractBatch(row) {
  const assessment = extractAssessment(row)
  return firstNonEmpty(assessment?.assessmentBatch, row?.assessmentBatch, row?.batchId, row?.source?.batchId)
}
function extractStatus(row, kind) {
  return firstNonEmpty(
    kind === 'public' ? row?.publicStatus : row?.privateStatus,
    row?.status,
  )
}

function laneFor(blockers) {
  const set = new Set(blockers)
  if (set.has('discarded_test_assessment_requires_fresh_research')) return 'fresh_research_required'
  if (set.has('publication_guard')) return 'publication_guard_review'
  if (set.has('missing_source_summary')) return 'missing_source_summary'
  if (set.has('multiple_secondary_requires_two_traceable_sources')) return 'two_traceable_sources'
  return 'other_blocker_review'
}
function priorityFor(lane) {
  return ({
    fresh_research_required: 0,
    publication_guard_review: 1,
    missing_source_summary: 2,
    two_traceable_sources: 3,
    other_blocker_review: 4,
  })[lane] ?? 9
}
function nextActionFor(lane) {
  return ({
    fresh_research_required: 'discard old test assessment and perform fresh research from new sources',
    publication_guard_review: 'review identity, live visibility, lifecycle, evidence and guard-removal conditions',
    missing_source_summary: 'write a traceable human-readable source summary aligned to grade and rules',
    two_traceable_sources: 'collect two independent traceable sources or one primary plus independent corroboration',
    other_blocker_review: 'inspect blocker and assign a specific remediation action',
  })[lane]
}

function historyEntry(row, kind, blockers, sourceRowSha256) {
  return canonicalize({
    track: kind,
    sourcePackage: extractSourcePackage(row) || null,
    policyVersion: extractPolicyVersion(row) || null,
    assessmentBatch: extractBatch(row) || null,
    assessedAt: extractAssessedAt(row),
    conclusionSha256: extractConclusionHash(row) || null,
    sourceRowSha256,
    status: extractStatus(row, kind) || null,
    blockers,
  })
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const auditDir = path.resolve(required(args, 'audit-dir'))
  const outDir = path.resolve(required(args, 'out-dir'))
  const auditZipSha256 = required(args, 'audit-zip-sha256').toLowerCase()
  const waveSize = Number(args['wave-size'] || DEFAULT_WAVE_SIZE)
  if (!Number.isInteger(waveSize) || waveSize < 1 || waveSize > 1000) throw new Error(`Invalid wave size: ${waveSize}`)
  if (auditZipSha256 !== EXPECTED_AUDIT_ZIP_SHA256) throw new Error('Audit ZIP SHA-256 mismatch.')
  assertManifest(auditDir)

  const summaryPath = path.join(auditDir, 'all-remaining-radar-global-audit-summary.json')
  const publicPath = path.join(auditDir, 'public-ai-blocked.jsonl')
  const privatePath = path.join(auditDir, 'private-ai-blocked.jsonl')
  if (sha256File(publicPath) !== EXPECTED_PUBLIC_BLOCKED_SHA256) throw new Error('Public blocked file SHA-256 mismatch.')
  if (sha256File(privatePath) !== EXPECTED_PRIVATE_BLOCKED_SHA256) throw new Error('Private blocked file SHA-256 mismatch.')

  const summary = readJson(summaryPath)
  const publicRows = readJsonl(publicPath)
  const privateRows = readJsonl(privatePath)
  if (publicRows.length !== EXPECTED_PUBLIC_BLOCKED || Number(summary?.publicTrack?.blocked) !== EXPECTED_PUBLIC_BLOCKED) {
    throw new Error(`Public blocked count mismatch: ${publicRows.length}/${summary?.publicTrack?.blocked}`)
  }
  if (privateRows.length !== EXPECTED_PRIVATE_BLOCKED || Number(summary?.privateTrack?.blocked) !== EXPECTED_PRIVATE_BLOCKED) {
    throw new Error(`Private blocked count mismatch: ${privateRows.length}/${summary?.privateTrack?.blocked}`)
  }

  fs.mkdirSync(outDir, { recursive: true })
  const privateByWork = new Map()
  const privateIdentityFailures = []
  for (const [index, row] of privateRows.entries()) {
    const workId = extractWorkId(row)
    if (!workId) {
      privateIdentityFailures.push({ row: index + 1, sourceRowSha256: canonicalHash(row) })
      continue
    }
    if (privateByWork.has(workId)) throw new Error(`Duplicate private blocked Work ID: ${workId}`)
    privateByWork.set(workId, row)
  }

  const ledger = []
  const workIds = new Set()
  const publicationKeys = new Set()
  const conflictQueue = []
  for (const [index, publicRow] of publicRows.entries()) {
    const sourceRowSha256 = canonicalHash(publicRow)
    const workId = extractWorkId(publicRow)
    const title = extractTitle(publicRow)
    const publicationKey = extractPublicationKey(publicRow, workId)
    if (!workId) throw new Error(`Public blocked row ${index + 1} has no Work ID.`)
    if (!publicationKey) throw new Error(`Public blocked row ${index + 1} has no publication key.`)
    if (workIds.has(workId)) throw new Error(`Duplicate public blocked Work ID: ${workId}`)
    if (publicationKeys.has(publicationKey)) throw new Error(`Duplicate public blocked publication key: ${publicationKey}`)
    workIds.add(workId)
    publicationKeys.add(publicationKey)

    const privateRow = privateByWork.get(workId) || null
    const publicBlockers = extractBlockers(publicRow, 'public')
    const privateBlockers = privateRow ? extractBlockers(privateRow, 'private') : []
    if (!publicBlockers.length) throw new Error(`Public blocked row ${index + 1} contains no blocker: ${workId}`)
    const allBlockers = uniqueStrings([publicBlockers, privateBlockers])
    const lane = laneFor(allBlockers)
    const assessedAt = extractAssessedAt(publicRow) || (privateRow ? extractAssessedAt(privateRow) : null)
    const conclusionSha256 = extractConclusionHash(publicRow) || (privateRow ? extractConclusionHash(privateRow) : '')
    const history = [historyEntry(publicRow, 'public', publicBlockers, sourceRowSha256)]
    if (privateRow) history.push(historyEntry(privateRow, 'private', privateBlockers, canonicalHash(privateRow)))

    const conflictFlags = []
    if (publicBlockers.includes('publication_guard')) conflictFlags.push('public_release_conflict_or_guard')
    if (allBlockers.includes('discarded_test_assessment_requires_fresh_research')) conflictFlags.push('discarded_test_assessment')
    if (!privateRow) conflictFlags.push('public_blocked_without_private_blocked_pair')
    const privateHash = privateRow ? extractConclusionHash(privateRow) : ''
    const publicHash = extractConclusionHash(publicRow)
    if (privateHash && publicHash && privateHash !== publicHash) conflictFlags.push('private_public_conclusion_hash_disagreement')

    const currentCandidateStatus = conflictFlags.some((flag) => flag !== 'public_blocked_without_private_blocked_pair')
      ? 'latest_candidate_preserved_but_conflict_unresolved'
      : 'latest_blocked_candidate_preserved'
    const row = canonicalize({
      schemaVersion: 1,
      ledgerVersion: VERSION,
      workId,
      publicationKey,
      title: title || null,
      currentCandidateSha256: conclusionSha256 || null,
      currentCandidateAssessedAt: assessedAt,
      currentCandidateStatus,
      replacementPolicy: 'latest_valid_complete_snapshot_whole_record_replace',
      explicitNullClearsOldValue: true,
      oldFieldsNeverMergedBackIntoCurrent: true,
      historyPreserved: true,
      unresolvedConflictBlocksPublicReady: true,
      privateStatus: privateRow ? extractStatus(privateRow, 'private') || null : null,
      publicStatus: extractStatus(publicRow, 'public') || null,
      privateBlockers,
      publicBlockers,
      allBlockers,
      resolutionLane: lane,
      priority: priorityFor(lane),
      nextAction: nextActionFor(lane),
      conflictFlags,
      history,
      sourceRows: {
        public: publicRow,
        private: privateRow,
      },
      sourceRowSha256,
    })
    ledger.push(row)
    if (conflictFlags.length) conflictQueue.push(row)
  }

  ledger.sort((a, b) => a.priority - b.priority || Number(a.workId) - Number(b.workId) || a.workId.localeCompare(b.workId))
  const byLane = new Map()
  for (const row of ledger) {
    const rows = byLane.get(row.resolutionLane) || []
    rows.push(row)
    byLane.set(row.resolutionLane, rows)
  }

  const allPath = path.join(outDir, 'radar-blocked-ledger-all.jsonl')
  const conflictPath = path.join(outDir, 'radar-blocked-conflict-queue.jsonl')
  writeJsonl(allPath, ledger)
  writeJsonl(conflictPath, conflictQueue)
  const laneFiles = {}
  for (const [lane, rows] of [...byLane.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const file = `radar-blocked-ledger-${lane}.jsonl`
    writeJsonl(path.join(outDir, file), rows)
    laneFiles[lane] = { file, rows: rows.length, sha256: sha256File(path.join(outDir, file)) }
  }

  const wavesDir = path.join(outDir, 'waves')
  fs.mkdirSync(wavesDir, { recursive: true })
  const waves = []
  for (let offset = 0; offset < ledger.length; offset += waveSize) {
    const rows = ledger.slice(offset, offset + waveSize)
    const waveNumber = Math.floor(offset / waveSize) + 1
    const waveId = `RADAR-BLOCKED-REMEDIATION-${String(waveNumber).padStart(4, '0')}`
    const file = `waves/${waveId}.jsonl`
    const fullPath = path.join(outDir, file)
    writeJsonl(fullPath, rows)
    waves.push({
      waveId,
      file,
      rows: rows.length,
      firstWorkId: rows[0]?.workId || null,
      lastWorkId: rows.at(-1)?.workId || null,
      lanes: Object.fromEntries([...new Set(rows.map((row) => row.resolutionLane))].sort().map((lane) => [lane, rows.filter((row) => row.resolutionLane === lane).length])),
      sha256: sha256File(fullPath),
    })
  }

  writeJson(path.join(outDir, 'radar-blocked-wave-manifest.json'), {
    schemaVersion: 1,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    waveSize,
    totalRows: ledger.length,
    waves,
  })

  const blockerCounts = {}
  for (const row of ledger) for (const blocker of row.allBlockers) blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1
  const laneCounts = Object.fromEntries([...byLane.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([lane, rows]) => [lane, rows.length]))
  const summaryOut = {
    schemaVersion: 1,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      auditZipSha256,
      publicBlockedFileSha256: EXPECTED_PUBLIC_BLOCKED_SHA256,
      privateBlockedFileSha256: EXPECTED_PRIVATE_BLOCKED_SHA256,
      publicBlockedRows: publicRows.length,
      privateBlockedRows: privateRows.length,
    },
    ledger: {
      rows: ledger.length,
      uniqueWorkIds: workIds.size,
      uniquePublicationKeys: publicationKeys.size,
      privatePairs: ledger.filter((row) => row.sourceRows.private !== null).length,
      publicOnlyRows: ledger.filter((row) => row.sourceRows.private === null).length,
      conflictQueueRows: conflictQueue.length,
      privateIdentityFailures: privateIdentityFailures.length,
      byLane: laneCounts,
      byBlocker: Object.fromEntries(Object.entries(blockerCounts).sort(([a], [b]) => a.localeCompare(b))),
      waves: waves.length,
      waveSize,
    },
    policy: {
      currentSelection: 'latest_valid_complete_snapshot',
      wholeSnapshotReplacement: true,
      explicitNullClearsOldValue: true,
      fieldLevelOldValueBackfill: false,
      historyPreserved: true,
      decisiveConflictBlocksPublicReady: true,
      validHumanStillWinsPresentation: true,
      discardedTestAssessmentRequiresFreshResearch: true,
    },
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlRead: false,
      directPostgresqlWrite: false,
      productionDatabaseWrite: false,
      modifiesCurrentPublicRows: false,
      productionApplyAuthorized: false,
    },
    outputs: {
      all: path.basename(allPath),
      conflicts: path.basename(conflictPath),
      lanes: laneFiles,
      waveManifest: 'radar-blocked-wave-manifest.json',
    },
  }
  writeJson(path.join(outDir, 'radar-blocked-ledger-summary.json'), summaryOut)

  const manifestFiles = fs.readdirSync(outDir, { recursive: true })
    .map((item) => String(item).replaceAll('\\', '/'))
    .filter((item) => item !== 'manifest.json')
    .filter((item) => fs.statSync(path.join(outDir, item)).isFile())
    .sort()
  writeJson(path.join(outDir, 'manifest.json'), manifestFiles.map((file) => {
    const fullPath = path.join(outDir, file)
    return { file, bytes: fs.statSync(fullPath).size, sha256: sha256File(fullPath) }
  }))

  console.log('Radar blocked ledger complete')
  console.log(`PublicBlockedRows: ${publicRows.length}`)
  console.log(`PrivateBlockedRows: ${privateRows.length}`)
  console.log(`LedgerRows: ${ledger.length}`)
  console.log(`UniqueWorkIds: ${workIds.size}`)
  console.log(`ConflictQueueRows: ${conflictQueue.length}`)
  console.log(`Waves: ${waves.length}`)
  console.log('ProductionDatabaseWrite: False')
  console.log('ProductionApplyAuthorized: False')
}

main()
