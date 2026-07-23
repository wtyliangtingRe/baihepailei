#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

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

function readText(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`)
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
}
function readJson(file) { return JSON.parse(readText(file)) }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }
function sha256Bytes(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function sha256File(file) { return sha256Bytes(fs.readFileSync(file)) }

function parseCounts(file) {
  const map = new Map()
  for (const [index, line] of readText(file).split(/\r?\n/u).entries()) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length !== 2 || !/^-?\d+$/u.test(parts[1])) throw new Error(`Invalid count row ${file}:${index + 1}`)
    if (map.has(parts[0])) throw new Error(`Duplicate count row: ${parts[0]}`)
    map.set(parts[0], Number(parts[1]))
  }
  return map
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  for (const key of ['directory', 'metadata', 'stage-status', 'baseline-counts', 'post-counts']) {
    if (!args[key]) throw new Error(`Required: --${key}`)
  }
  const directory = path.resolve(args.directory)
  const metadata = readJson(path.resolve(args.metadata))
  const stages = readJson(path.resolve(args['stage-status']))
  const baseline = parseCounts(path.resolve(args['baseline-counts']))
  const post = parseCounts(path.resolve(args['post-counts']))

  if (metadata.authorizationPhrase !== 'AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-APPLY-V01') throw new Error('Apply authorization phrase mismatch.')
  if (metadata.productionImage !== 'postgres:17-alpine') throw new Error('Production image differs from rehearsal image.')
  if (metadata.targetWorkIds?.join(',') !== '32186,10097,32094,25561') throw new Error('Target Work set mismatch.')
  for (const key of ['freshBackupRestoreVerified','freshSchemaFingerprintMatched','productionPreflightPassed','applyCommitted','postMergeAcceptancePassed']) {
    if (stages[key] !== true) throw new Error(`Required stage did not pass: ${key}`)
  }
  if (baseline.size !== 83 || post.size !== 83) throw new Error(`Expected 83 business tables, got ${baseline.size}/${post.size}.`)

  const expected = new Map([
    ['public.works_review_reasons', -12],
    ['public.works_radar_assessment_matched_rules', -5],
  ])
  const diffs = [...new Set([...baseline.keys(), ...post.keys()])].sort().map((table) => ({
    table,
    before: baseline.get(table) ?? null,
    after: post.get(table) ?? null,
    delta: baseline.has(table) && post.has(table) ? post.get(table) - baseline.get(table) : null,
    expectedDelta: expected.get(table) ?? 0,
  }))
  const failures = diffs.filter((row) => row.delta !== row.expectedDelta)
  if (failures.length) throw new Error(`Post-merge table delta mismatch: ${JSON.stringify(failures)}`)

  const completedAt = new Date().toISOString()
  const core = {
    schemaVersion: 1,
    executionId: metadata.executionId,
    branchHead: metadata.branchHead,
    startedAt: metadata.startedAt,
    completedAt,
    productionContainer: metadata.productionContainer,
    productionImage: metadata.productionImage,
    targetWorkIds: metadata.targetWorkIds,
    authorizationPhraseSha256: sha256Bytes(metadata.authorizationPhrase),
    transactionManifestSha256: metadata.transactionManifestSha256,
    applySqlSha256: metadata.applySqlSha256,
    acceptanceSqlSha256: metadata.acceptanceSqlSha256,
    gateManifestSha256: metadata.gateManifestSha256,
    freshBackupBytes: metadata.freshBackupBytes,
    freshBackupSha256: metadata.freshBackupSha256,
    freshBackupPath: metadata.freshBackupPath,
    freshBackupRestoreVerified: true,
    freshSchemaFingerprintMatched: true,
    baselineAcceptancePassed: true,
    applyCommitted: true,
    postMergeAcceptancePassed: true,
    postMergeTableDeltasMatched: true,
    postMergeChangedTables: diffs.filter((row) => row.delta !== 0),
    writerContainersStopped: metadata.writerContainersStopped,
    writerContainersRestarted: metadata.writerContainersRestarted,
    rollbackNotImplicit: true,
    productionRollbackAuthorized: false,
  }
  const canonical = Buffer.from(`${JSON.stringify(core, Object.keys(core).sort())}\n`, 'utf8')
  const receiptHash = sha256Bytes(canonical)
  const receipt = { ...core, productionMergeReceiptSha256: receiptHash }
  writeJson(path.join(directory, 'production-apply-receipt.json'), receipt)
  fs.writeFileSync(path.join(directory, 'production-apply-receipt.sha256.txt'), `${receiptHash}  production-apply-receipt-core\n`, 'utf8')
  writeJson(path.join(directory, 'post-merge-table-count-diff.json'), diffs)
  writeJson(path.join(directory, 'production-apply-summary.json'), {
    schemaVersion: 1,
    generatedAt: completedAt,
    applyCommitted: true,
    postMergeAcceptancePassed: true,
    postMergeTableDeltasMatched: true,
    businessTableCountChecks: 83,
    productionMergeReceiptSha256: receiptHash,
    rollbackAuthorized: false,
  })

  const files = fs.readdirSync(directory).filter((name) => name !== 'manifest.json').sort()
  writeJson(path.join(directory, 'manifest.json'), files.map((name) => {
    const file = path.join(directory, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('Production apply receipt complete')
  console.log('BusinessTableCountChecks: 83')
  console.log('ApplyCommitted: True')
  console.log('PostMergeAcceptancePassed: True')
  console.log('PostMergeTableDeltasMatched: True')
  console.log(`ProductionMergeReceiptSHA256: ${receiptHash}`)
  console.log('ProductionRollbackAuthorized: False')
}

main()
