#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const APPLY_PHRASE_SHA256 = 'cccb781b5b8ec48a14e5e15c0c2c94506f6ae13e9e4fe16f3c1d49ce3135ac0a'
const EXPECTED_STORAGE_ZIP_SHA256 = '642e43b9cbac02c75d2d473293c7b57b8b0197594262dfa96b065015e89c135e'
const EXPECTED_LAB_ZIP_SHA256 = 'eb3b1bcbe7b553471157bded6b027f6850e3927aa9c1226affdc63b85ee69825'
const EXPECTED_GATE_ZIP_SHA256 = 'c0fbec5b62c3fc45072b9f235c5df5fea7462f564226ea7fdd3ce9c723e0e2b5'
const EXPECTED_APPLY_SQL_SHA256 = '61f5673a2727d2fde63590a1a74c2a26c5cfb2eacfa7ae27078f9cd999048dda'
const EXPECTED_ACCEPTANCE_SQL_SHA256 = 'b518ca4ca58f73c5cddc9916c774b7be5e8946f622e00388010f32066a1f4f6e'
const EXPECTED_PREFLIGHT_SQL_SHA256 = 'ba1ca326484611dd090fba3cdc7566f13d1218ca2f75aed7b3ff308796c92170'
const EXPECTED_ROLLBACK_SQL_SHA256 = '24738e9c9510e2d6014d7211e16f0cf7e9d2c852d8b55ff3b839457e268b00be'
const EXPECTED_ROWS = 9000
const EXPECTED_EXISTING_TABLES = 83
const EXPECTED_RADAR_TABLES = new Map([
  ['public.radar_public', 9000],
  ['public.radar_public_review_reasons', 9000],
  ['public.radar_public_radar_assessment_matched_rules', 9077],
  ['public.radar_public_radar_assessment_contradictions', 0],
])
const EXPECTED_ACCEPTANCE_NAMES = [
  'main_rows',
  'publication_keys_unique',
  'work_ids_unique',
  'conclusion_hashes_unique',
  'current_rows',
  'package_rows',
  'review_reason_rows',
  'matched_rule_rows',
  'contradiction_rows',
  'publication_key_set_md5',
  'work_id_set_md5',
  'conclusion_hash_set_md5',
  'orphan_review_reasons',
  'orphan_matched_rules',
  'orphan_contradictions',
  'grade_S',
  'grade_A',
  'grade_B',
  'grade_C',
  'grade_D',
  'grade_E',
  'grade_F',
]

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
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }
function sha256Bytes(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function sha256File(file) { return sha256Bytes(fs.readFileSync(file)) }

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function parseCounts(file) {
  const rows = new Map()
  for (const [index, line] of readText(file).split(/\r?\n/u).entries()) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length !== 2 || !/^-?\d+$/u.test(parts[1])) {
      throw new Error(`Invalid table-count row ${file}:${index + 1}`)
    }
    if (rows.has(parts[0])) throw new Error(`Duplicate table-count row: ${parts[0]}`)
    rows.set(parts[0], Number(parts[1]))
  }
  return rows
}

function parseChecks(file) {
  const rows = []
  const names = new Set()
  for (const [index, line] of readText(file).split(/\r?\n/u).entries()) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length !== 4) throw new Error(`Invalid acceptance row ${file}:${index + 1}`)
    const [name, actual, expected, matchedText] = parts
    if (names.has(name)) throw new Error(`Duplicate acceptance check: ${name}`)
    names.add(name)
    rows.push({ name, actual, expected, matched: matchedText.toLowerCase() === 'true' })
  }
  return rows
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const directory = required(args, 'directory')
  const metadata = readJson(required(args, 'metadata'))
  const stages = readJson(required(args, 'stage-status'))
  const baseline = parseCounts(required(args, 'baseline-counts'))
  const post = parseCounts(required(args, 'post-counts'))
  const checks = parseChecks(required(args, 'acceptance-output'))

  if (metadata.authorizationPhraseSha256 !== APPLY_PHRASE_SHA256) throw new Error('Apply authorization hash mismatch.')
  if (metadata.productionImage !== 'postgres:17-alpine') throw new Error('Production image differs from rehearsed image.')
  if (metadata.storageBundleSha256 !== EXPECTED_STORAGE_ZIP_SHA256) throw new Error('Storage bundle hash mismatch.')
  if (metadata.labBundleSha256 !== EXPECTED_LAB_ZIP_SHA256) throw new Error('Lab bundle hash mismatch.')
  if (metadata.gateBundleSha256 !== EXPECTED_GATE_ZIP_SHA256) throw new Error('Gate bundle hash mismatch.')
  if (metadata.applySqlSha256 !== EXPECTED_APPLY_SQL_SHA256) throw new Error('Apply SQL hash mismatch.')
  if (metadata.acceptanceSqlSha256 !== EXPECTED_ACCEPTANCE_SQL_SHA256) throw new Error('Acceptance SQL hash mismatch.')
  if (metadata.preflightSqlSha256 !== EXPECTED_PREFLIGHT_SQL_SHA256) throw new Error('Preflight SQL hash mismatch.')
  if (metadata.rollbackSqlSha256 !== EXPECTED_ROLLBACK_SQL_SHA256) throw new Error('Rollback SQL hash mismatch.')

  const requiredStages = [
    'freshBackupCreated',
    'freshBackupArchiveListed',
    'freshBackupRestoreVerified',
    'freshWindowLabPreflightPassed',
    'freshWindowLabApplyPassed',
    'freshWindowLabAcceptancePassed',
    'freshWindowLabRollbackPassed',
    'freshWindowLabBaselineRestored',
    'productionPreflightPassed',
    'productionApplyCommitted',
    'productionAcceptancePassed',
    'productionTableDeltasMatched',
    'writerContainersRestarted',
  ]
  for (const key of requiredStages) {
    if (stages[key] !== true) throw new Error(`Required production stage did not pass: ${key}`)
  }
  if (stages.rollbackAutomaticallyExecuted !== false || stages.productionRollbackAuthorized !== false) {
    throw new Error('Rollback safety state is invalid.')
  }

  if (checks.length !== EXPECTED_ACCEPTANCE_NAMES.length) {
    throw new Error(`Expected ${EXPECTED_ACCEPTANCE_NAMES.length} acceptance checks, received ${checks.length}.`)
  }
  const actualNames = checks.map((row) => row.name)
  if (JSON.stringify(actualNames) !== JSON.stringify(EXPECTED_ACCEPTANCE_NAMES)) {
    throw new Error(`Acceptance check names/order changed: ${JSON.stringify(actualNames)}`)
  }
  const failedChecks = checks.filter((row) => !row.matched || row.actual !== row.expected)
  if (failedChecks.length) throw new Error(`Production acceptance failed: ${JSON.stringify(failedChecks)}`)

  if (baseline.size !== EXPECTED_EXISTING_TABLES) {
    throw new Error(`Expected ${EXPECTED_EXISTING_TABLES} baseline tables, received ${baseline.size}.`)
  }
  if (post.size !== EXPECTED_EXISTING_TABLES + EXPECTED_RADAR_TABLES.size) {
    throw new Error(`Expected ${EXPECTED_EXISTING_TABLES + EXPECTED_RADAR_TABLES.size} post-apply tables, received ${post.size}.`)
  }

  const diffs = []
  for (const [table, before] of [...baseline.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!post.has(table)) throw new Error(`Existing production table disappeared: ${table}`)
    const after = post.get(table)
    diffs.push({ table, before, after, delta: after - before, expectedDelta: 0 })
  }
  for (const [table, expectedCount] of EXPECTED_RADAR_TABLES) {
    if (baseline.has(table)) throw new Error(`Radar table unexpectedly existed in baseline: ${table}`)
    if (!post.has(table)) throw new Error(`Radar table missing after apply: ${table}`)
    diffs.push({ table, before: null, after: post.get(table), delta: null, expectedCount })
  }
  const failures = diffs.filter((row) => {
    if (row.before === null) return row.after !== row.expectedCount
    return row.delta !== row.expectedDelta
  })
  if (failures.length) throw new Error(`Post-apply table state mismatch: ${JSON.stringify(failures)}`)

  const completedAt = new Date().toISOString()
  const core = {
    schemaVersion: 1,
    executionId: metadata.executionId,
    branchHead: metadata.branchHead,
    gateHead: metadata.gateHead,
    migrationCommit: metadata.migrationCommit,
    startedAt: metadata.startedAt,
    completedAt,
    productionContainer: metadata.productionContainer,
    productionImage: metadata.productionImage,
    authorizationPhraseSha256: metadata.authorizationPhraseSha256,
    storageBundleSha256: metadata.storageBundleSha256,
    labBundleSha256: metadata.labBundleSha256,
    gateBundleSha256: metadata.gateBundleSha256,
    gateManifestSha256: metadata.gateManifestSha256,
    applySqlSha256: metadata.applySqlSha256,
    acceptanceSqlSha256: metadata.acceptanceSqlSha256,
    preflightSqlSha256: metadata.preflightSqlSha256,
    rollbackSqlSha256: metadata.rollbackSqlSha256,
    normalizedReadySha256: metadata.normalizedReadySha256,
    freshBackupBytes: metadata.freshBackupBytes,
    freshBackupSha256: metadata.freshBackupSha256,
    freshBackupPath: metadata.freshBackupPath,
    freshBackupRestoreVerified: true,
    freshWindowFullRehearsalPassed: true,
    productionPreflightPassed: true,
    productionSchemaApplied: true,
    productionPublicRowsWritten: EXPECTED_ROWS,
    productionAcceptanceChecks: checks.length,
    productionAcceptancePassed: true,
    existingProductionTablesUnchanged: EXPECTED_EXISTING_TABLES,
    newRadarTableCounts: Object.fromEntries(EXPECTED_RADAR_TABLES),
    productionTableDeltasMatched: true,
    writerContainersStopped: metadata.writerContainersStopped,
    writerContainersRestarted: metadata.writerContainersRestarted,
    payloadMigrationCommandExecuted: false,
    payloadWrite: false,
    prMergeAuthorized: false,
    rollbackAutomaticallyExecuted: false,
    productionRollbackAuthorized: false,
  }
  const canonicalBytes = Buffer.from(`${JSON.stringify(canonicalize(core))}\n`, 'utf8')
  const receiptHash = sha256Bytes(canonicalBytes)
  const receipt = { ...core, productionApplyReceiptSha256: receiptHash }

  writeJson(path.join(directory, 'production-apply-receipt.json'), receipt)
  fs.writeFileSync(path.join(directory, 'production-apply-receipt.sha256.txt'), `${receiptHash}  production-apply-receipt-core\n`, 'utf8')
  writeJson(path.join(directory, 'post-apply-table-count-diff.json'), diffs)
  writeJson(path.join(directory, 'production-apply-summary.json'), {
    schemaVersion: 1,
    generatedAt: completedAt,
    productionSchemaApplied: true,
    productionPublicRowsWritten: EXPECTED_ROWS,
    productionAcceptanceChecks: checks.length,
    productionAcceptancePassed: true,
    existingProductionTablesUnchanged: EXPECTED_EXISTING_TABLES,
    productionTableDeltasMatched: true,
    writerContainersRestarted: metadata.writerContainersRestarted === true,
    rollbackAutomaticallyExecuted: false,
    productionRollbackAuthorized: false,
    productionApplyReceiptSha256: receiptHash,
  })

  const files = fs.readdirSync(directory)
    .filter((name) => name !== 'manifest.json' && name !== 'database-backup.dump')
    .sort()
  writeJson(path.join(directory, 'manifest.json'), files.map((name) => {
    const file = path.join(directory, name)
    if (!fs.statSync(file).isFile()) throw new Error(`Receipt directory contains an unexpected subdirectory: ${name}`)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('Radar public conclusions production apply receipt complete')
  console.log(`ProductionPublicRowsWritten: ${EXPECTED_ROWS}`)
  console.log(`ProductionAcceptanceChecks: ${checks.length}`)
  console.log(`ExistingProductionTablesUnchanged: ${EXPECTED_EXISTING_TABLES}`)
  console.log('ProductionTableDeltasMatched: True')
  console.log('WriterContainersRestarted: True')
  console.log('RollbackAutomaticallyExecuted: False')
  console.log('ProductionRollbackAuthorized: False')
  console.log(`ProductionApplyReceiptSHA256: ${receiptHash}`)
}

main()
