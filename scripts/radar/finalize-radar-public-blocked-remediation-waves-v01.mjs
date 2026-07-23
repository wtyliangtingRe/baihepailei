#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'radar-public-blocked-remediation-waves-v0.1'
const EXPECTED_ROWS = 1805
const EXPECTED_PUBLIC_CURRENT = 9000
const DEFAULT_WAVE_SIZE = 250
const REPAIR_ORDER = new Map([
  ['A_automatic_format_repair', 0],
  ['B_research_regeneration', 1],
  ['C_human_adjudication', 2],
  ['D_retained_blocked', 3],
])

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
  return path.resolve(value)
}
function readText(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`)
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
}
function readJson(file) { return JSON.parse(readText(file)) }
function readJsonl(file) {
  return readText(file).split(/\r?\n/u).filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line) } catch (error) { throw new Error(`Invalid JSONL ${file}:${index + 1}: ${error.message}`) }
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
function canonical(value) {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonical)
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
    const item = canonical(value[key])
    return item === undefined ? [] : [[key, item]]
  }))
}
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function val(value) { return String(value ?? '').trim() }
function naturalParts(value) {
  return val(value).toLowerCase().split(/(\d+)/u).filter(Boolean).map((part) => /^\d+$/u.test(part) ? Number(part) : part)
}
function compareNatural(a, b) {
  const left = naturalParts(a)
  const right = naturalParts(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1
    if (right[index] === undefined) return 1
    if (left[index] === right[index]) continue
    if (typeof left[index] === typeof right[index]) return left[index] < right[index] ? -1 : 1
    return String(left[index]).localeCompare(String(right[index]))
  }
  return 0
}
function completeValid(candidate) {
  return candidate?.structurallyValid === true &&
    candidate?.assessedAtValid === true &&
    Boolean(val(candidate?.policyVersion)) &&
    Boolean(val(candidate?.assessmentBatch)) &&
    Boolean(val(candidate?.grade)) &&
    Boolean(val(candidate?.snapshot?.decisiveRuleCode)) &&
    Boolean(val(candidate?.snapshot?.sourceSummary))
}
function compareCandidates(a, b) {
  const timeA = Number.isFinite(Number(a?.assessedAtMillis)) ? Number(a.assessedAtMillis) : Number.NEGATIVE_INFINITY
  const timeB = Number.isFinite(Number(b?.assessedAtMillis)) ? Number(b.assessedAtMillis) : Number.NEGATIVE_INFINITY
  if (timeA !== timeB) return timeA - timeB
  const policy = compareNatural(a?.policyVersion, b?.policyVersion)
  if (policy !== 0) return policy
  const batch = compareNatural(a?.assessmentBatch, b?.assessmentBatch)
  if (batch !== 0) return batch
  return val(a?.candidateSha256).localeCompare(val(b?.candidateSha256))
}
function selectCandidate(history) {
  const complete = history.filter(completeValid).sort(compareCandidates)
  if (complete.length) return { candidate: complete.at(-1), status: 'latest_valid_complete', pool: 'complete_valid' }
  const structural = history.filter((item) => item?.structurallyValid === true).sort(compareCandidates)
  if (structural.length) return { candidate: structural.at(-1), status: 'latest_structurally_valid_incomplete', pool: 'structurally_valid' }
  const available = [...history].sort(compareCandidates)
  return { candidate: available.at(-1) || null, status: available.length ? 'latest_available_invalid' : 'missing_candidate', pool: 'all_available' }
}
function repairPriority(value) { return REPAIR_ORDER.get(val(value)) ?? 9 }

function main() {
  const args = parseArgs(process.argv.slice(2))
  const inventoryDir = required(args, 'inventory-dir')
  const outDir = required(args, 'out-dir')
  const waveSize = Number(args['wave-size'] || DEFAULT_WAVE_SIZE)
  if (!Number.isInteger(waveSize) || waveSize < 1 || waveSize > 1000) throw new Error(`Invalid wave size: ${waveSize}`)

  const inventoryPath = path.join(inventoryDir, 'radar-public-blocked-inventory.jsonl')
  const summaryPath = path.join(inventoryDir, 'radar-public-blocked-inventory-summary.json')
  const inventory = readJsonl(inventoryPath)
  const sourceSummary = readJson(summaryPath)
  if (inventory.length !== EXPECTED_ROWS || Number(sourceSummary?.inventory?.rows) !== EXPECTED_ROWS) throw new Error('Inventory row count mismatch.')
  if (Number(sourceSummary?.currentProduction?.currentPublicConclusionsRead) !== EXPECTED_PUBLIC_CURRENT) throw new Error('Current public baseline mismatch.')
  if (sourceSummary?.readyForRemediationPlanning !== true || (sourceSummary?.globalBlockers || []).length) throw new Error('Inventory is not ready for remediation planning.')

  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  const workIds = new Set()
  const keys = new Set()
  const rows = inventory.map((row, index) => {
    const workId = val(row.workId)
    const publicationKey = val(row.publicationKey)
    if (!workId || !publicationKey) throw new Error(`Missing identity at inventory row ${index + 1}.`)
    if (workIds.has(workId)) throw new Error(`Duplicate Work ID: ${workId}`)
    if (keys.has(publicationKey)) throw new Error(`Duplicate publication key: ${publicationKey}`)
    workIds.add(workId)
    keys.add(publicationKey)

    const history = Array.isArray(row.history) ? row.history : []
    const selection = selectCandidate(history)
    const decisiveConflicts = (row.conflicts || []).filter((item) => item?.decisive === true)
    const finalStatus = decisiveConflicts.length
      ? 'blocked_decisive_conflict'
      : selection.status === 'latest_valid_complete'
        ? 'blocked_latest_valid_complete_candidate_preserved'
        : `blocked_${selection.status}`
    return canonical({
      ...row,
      selectedCandidateFromInventory: row.selectedCandidate || null,
      selectedCandidate: selection.candidate,
      selectedCandidateStatus: selection.status,
      selectedCandidatePool: selection.pool,
      selectedCandidateSelectionOrder: ['assessedAt', 'policyVersion', 'assessmentBatch', 'candidateSha256'],
      latestAloneNeverWins: true,
      wholeSnapshotReplacementRequired: true,
      explicitNullClearsOldValue: true,
      fieldResidualMergeForbidden: true,
      historicalCandidatesPreserved: true,
      decisiveConflictsRemainBlocked: true,
      finalRemediationStatus: finalStatus,
      remediationWavePriority: repairPriority(row.repairClass),
    })
  }).sort((a, b) =>
    a.remediationWavePriority - b.remediationWavePriority ||
    val(a.resolutionLane).localeCompare(val(b.resolutionLane)) ||
    Number(a.workId) - Number(b.workId) ||
    a.workId.localeCompare(b.workId))

  const ledgerPath = path.join(outDir, 'radar-public-blocked-final-ledger.jsonl')
  const conflictPath = path.join(outDir, 'radar-public-blocked-final-conflicts.jsonl')
  writeJsonl(ledgerPath, rows)
  writeJsonl(conflictPath, rows.filter((row) => (row.conflicts || []).length))

  const wavesDir = path.join(outDir, 'waves')
  const waves = []
  for (let offset = 0; offset < rows.length; offset += waveSize) {
    const waveRows = rows.slice(offset, offset + waveSize)
    const number = Math.floor(offset / waveSize) + 1
    const waveId = `RADAR-BLOCKED-REMEDIATION-${String(number).padStart(4, '0')}`
    const relative = `waves/${waveId}.jsonl`
    const file = path.join(outDir, relative)
    writeJsonl(file, waveRows)
    waves.push(canonical({
      waveId,
      file: relative,
      rows: waveRows.length,
      firstWorkId: waveRows[0]?.workId || null,
      lastWorkId: waveRows.at(-1)?.workId || null,
      repairClasses: Object.fromEntries([...new Set(waveRows.map((row) => row.repairClass))].sort().map((key) => [key, waveRows.filter((row) => row.repairClass === key).length])),
      resolutionLanes: Object.fromEntries([...new Set(waveRows.map((row) => row.resolutionLane))].sort().map((key) => [key, waveRows.filter((row) => row.resolutionLane === key).length])),
      sha256: sha256File(file),
    }))
  }
  writeJson(path.join(outDir, 'radar-public-blocked-wave-manifest.json'), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version: VERSION,
    rows: rows.length,
    waveSize,
    waves,
  })

  const countBy = (getter) => {
    const result = {}
    for (const row of rows) {
      const key = val(getter(row)) || 'missing'
      result[key] = (result[key] || 0) + 1
    }
    return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
  }
  const summary = canonical({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version: VERSION,
    sourceInventory: {
      directory: inventoryDir,
      inventorySha256: sha256File(inventoryPath),
      summarySha256: sha256File(summaryPath),
      rows: inventory.length,
    },
    currentProductionPublicBaseline: EXPECTED_PUBLIC_CURRENT,
    ledger: {
      rows: rows.length,
      uniqueWorkIds: workIds.size,
      uniquePublicationKeys: keys.size,
      withHistory: rows.filter((row) => (row.history || []).length).length,
      withConflicts: rows.filter((row) => (row.conflicts || []).length).length,
      withDecisiveConflicts: rows.filter((row) => (row.conflicts || []).some((item) => item?.decisive)).length,
      latestValidComplete: rows.filter((row) => row.selectedCandidateStatus === 'latest_valid_complete').length,
      latestStructurallyValidIncomplete: rows.filter((row) => row.selectedCandidateStatus === 'latest_structurally_valid_incomplete').length,
      latestAvailableInvalid: rows.filter((row) => row.selectedCandidateStatus === 'latest_available_invalid').length,
      missingCandidate: rows.filter((row) => row.selectedCandidateStatus === 'missing_candidate').length,
      byRepairClass: countBy((row) => row.repairClass),
      byResolutionLane: countBy((row) => row.resolutionLane),
      byFinalStatus: countBy((row) => row.finalRemediationStatus),
      waves: waves.length,
      waveSize,
    },
    conflictPolicy: {
      currentSelection: 'latest_valid_complete_identity_resolved',
      tieBreakOrder: ['assessedAt', 'policyVersion', 'assessmentBatch', 'candidateSha256'],
      latestAloneNeverWins: true,
      wholeSnapshotReplacement: true,
      explicitNullClearsOldValue: true,
      fieldResidualMergeForbidden: true,
      decisiveConflictsRemainBlocked: true,
      historicalCandidatesPreserved: true,
      humanTrackNeverOverwritten: true,
    },
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlRead: false,
      directPostgresqlWrite: false,
      productionDatabaseWrite: false,
      productionApplyAuthorized: false,
      existingPublicRowsModified: false,
    },
  })
  writeJson(path.join(outDir, 'radar-public-blocked-remediation-summary.json'), summary)

  const files = fs.readdirSync(outDir, { recursive: true })
    .map((name) => String(name).replaceAll('\\', '/'))
    .filter((name) => name !== 'manifest.json')
    .filter((name) => fs.statSync(path.join(outDir, name)).isFile())
    .sort()
  writeJson(path.join(outDir, 'manifest.json'), files.map((name) => {
    const file = path.join(outDir, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('Radar public blocked remediation waves complete')
  console.log(`Rows: ${rows.length}`)
  console.log(`LatestValidComplete: ${summary.ledger.latestValidComplete}`)
  console.log(`WithConflicts: ${summary.ledger.withConflicts}`)
  console.log(`WithDecisiveConflicts: ${summary.ledger.withDecisiveConflicts}`)
  console.log(`Waves: ${waves.length}`)
  console.log('ProductionDatabaseWrite: False')
  console.log('ProductionApplyAuthorized: False')
}

main()
