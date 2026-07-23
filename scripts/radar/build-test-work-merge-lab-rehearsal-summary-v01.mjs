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
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function text(value) {
  return String(value ?? '').trim()
}

function readText(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`)
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
}

function readJson(file) {
  return JSON.parse(readText(file))
}

function writeText(file, value) {
  fs.writeFileSync(file, `${String(value).replace(/\s+$/u, '')}\n`, 'utf8')
}

function writeJson(file, value) {
  writeText(file, JSON.stringify(value, null, 2))
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function meaningfulLines(file) {
  return readText(file).split(/\r?\n/u).filter((line) => line.trim())
}

function parseCounts(file) {
  const rows = new Map()
  for (const [index, line] of readText(file).split(/\r?\n/u).entries()) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length !== 2 || !/^-?\d+$/u.test(parts[1])) {
      throw new Error(`Invalid table-count row at ${file}:${index + 1}`)
    }
    if (rows.has(parts[0])) throw new Error(`Duplicate table-count row: ${parts[0]}`)
    rows.set(parts[0], Number(parts[1]))
  }
  return rows
}

function compareCounts(before, after) {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort()
  return keys.map((table) => ({
    table,
    before: before.get(table) ?? null,
    after: after.get(table) ?? null,
    delta: before.has(table) && after.has(table) ? after.get(table) - before.get(table) : null,
    matches: before.get(table) === after.get(table),
  }))
}

function verifyManifest(directory) {
  const manifestPath = path.join(directory, 'manifest.json')
  const manifest = readJson(manifestPath)
  for (const entry of manifest) {
    const file = path.join(directory, entry.file)
    if (!fs.existsSync(file)) throw new Error(`Transaction manifest file missing: ${entry.file}`)
    if (fs.statSync(file).size !== Number(entry.bytes)) throw new Error(`Transaction manifest byte mismatch: ${entry.file}`)
    if (sha256File(file) !== text(entry.sha256).toLowerCase()) throw new Error(`Transaction manifest SHA mismatch: ${entry.file}`)
  }
  return { manifestPath, manifest }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!text(args.directory)) throw new Error('Required: --directory')
  if (!text(args['transaction-review-dir'])) throw new Error('Required: --transaction-review-dir')
  const directory = path.resolve(args.directory)
  const reviewDirectory = path.resolve(args['transaction-review-dir'])

  const { manifestPath } = verifyManifest(reviewDirectory)
  const review = readJson(path.join(reviewDirectory, 'transaction-review.json'))
  const validation = readJson(path.join(directory, 'lab-rehearsal-validation.json'))
  const stageStatus = readJson(path.join(directory, 'lab-stage-status.json'))

  if (review.execution?.repositoryExecutionWrapperExists !== false
    || review.execution?.executed !== false
    || review.execution?.explicitApprovalReceived !== false
    || review.safety?.databaseWrite !== false
    || review.safety?.mergePerformed !== false
    || review.safety?.executableSqlExtensionDisabled !== true) {
    throw new Error('Transaction review input does not retain its review-only safety boundary.')
  }
  if (validation.confirmationMatched !== true
    || validation.sourceContainerInspectOnly !== true
    || validation.labNetworkDisabled !== true
    || validation.labContainerRemoved !== true
    || validation.productionDatabaseWrite !== false
    || validation.labDatabaseWrite !== true
    || validation.mergePerformedInProduction !== false
    || validation.backupFileModified !== false) {
    throw new Error('Lab rehearsal validation does not prove isolated execution and cleanup.')
  }

  const requiredStages = [
    'restoreCompleted',
    'baselineAcceptancePassed',
    'applyTransactionPassed',
    'postMergeAcceptancePassed',
    'rollbackTransactionPassed',
    'postRollbackAcceptancePassed',
  ]
  for (const key of requiredStages) {
    if (stageStatus[key] !== true) throw new Error(`Lab stage did not pass: ${key}`)
  }

  const stderrFiles = [
    'pg-restore-stderr.txt',
    'baseline-acceptance-stderr.txt',
    'apply-transaction-stderr.txt',
    'post-merge-acceptance-stderr.txt',
    'rollback-transaction-stderr.txt',
    'post-rollback-acceptance-stderr.txt',
    'baseline-table-counts-stderr.txt',
    'post-merge-table-counts-stderr.txt',
    'post-rollback-table-counts-stderr.txt',
  ]
  const stderrMeaningful = Object.fromEntries(stderrFiles.map((name) => [name, meaningfulLines(path.join(directory, name)).length]))
  if (Object.values(stderrMeaningful).some((count) => count !== 0)) {
    throw new Error(`Lab rehearsal stderr is not clean: ${JSON.stringify(stderrMeaningful)}`)
  }

  const baseline = parseCounts(path.join(directory, 'baseline-table-counts.tsv'))
  const postMerge = parseCounts(path.join(directory, 'post-merge-table-counts.tsv'))
  const postRollback = parseCounts(path.join(directory, 'post-rollback-table-counts.tsv'))
  if (baseline.size === 0 || baseline.size !== postMerge.size || baseline.size !== postRollback.size) {
    throw new Error('Business-table count sets are incomplete or inconsistent.')
  }

  const mergeDeltas = compareCounts(baseline, postMerge)
  const rollbackComparison = compareCounts(baseline, postRollback)
  const expectedMergeDeltas = new Map([
    ['public.works_review_reasons', -12],
    ['public.works_radar_assessment_matched_rules', -5],
  ])
  const unexpectedMergeDeltas = mergeDeltas.filter((row) => {
    const expected = expectedMergeDeltas.get(row.table) ?? 0
    return row.delta !== expected
  })
  const missingExpectedDeltaTables = [...expectedMergeDeltas.keys()].filter((table) => !baseline.has(table))
  const rollbackMismatches = rollbackComparison.filter((row) => !row.matches)
  if (unexpectedMergeDeltas.length || missingExpectedDeltaTables.length) {
    throw new Error(`Post-merge table deltas differ from the operation plan: ${JSON.stringify({ unexpectedMergeDeltas, missingExpectedDeltaTables })}`)
  }
  if (rollbackMismatches.length) {
    throw new Error(`Post-rollback table counts do not match baseline: ${JSON.stringify(rollbackMismatches)}`)
  }

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceTransactionReviewDirectory: reviewDirectory,
    sourceTransactionManifestSha256: sha256File(manifestPath),
    sourceTransactionReviewSha256: sha256File(path.join(reviewDirectory, 'transaction-review.json')),
    sourceApplySqlSha256: sha256File(path.join(reviewDirectory, 'merge-transaction.sql.disabled')),
    sourceRollbackSqlSha256: sha256File(path.join(reviewDirectory, 'merge-rollback.sql.disabled')),
    sourceAcceptanceSqlSha256: sha256File(path.join(reviewDirectory, 'merge-acceptance-readonly.sql')),
    sourceRollbackAcceptanceSqlSha256: sha256File(path.join(reviewDirectory, 'merge-rollback-acceptance-readonly.sql')),
    backup: review.backup,
    operationCounts: review.operationCounts,
    businessTableCountChecks: baseline.size,
    expectedPostMergeTableDeltas: Object.fromEntries(expectedMergeDeltas),
    observedPostMergeChangedTables: mergeDeltas.filter((row) => row.delta !== 0),
    postRollbackMismatches: rollbackMismatches,
    stages: Object.fromEntries(requiredStages.map((key) => [key, true])),
    stderrMeaningfulLines: stderrMeaningful,
    labRoundTripVerified: true,
    readyForProductionExecutionPlanning: true,
    safety: {
      sourceProductionContainerInspectOnly: true,
      productionDatabaseWrite: false,
      payloadWrite: false,
      migrationGeneration: false,
      schemaPush: false,
      labDatabaseWrite: true,
      labNetworkDisabled: true,
      labContainerRemoved: true,
      mergePerformedInProduction: false,
      rollbackPerformedInProduction: false,
      backupFileModified: false,
      productionExecutionWrapperGenerated: false,
      productionExecutionApproved: false,
    },
  }

  writeJson(path.join(directory, 'lab-rehearsal-summary.json'), summary)
  writeJson(path.join(directory, 'post-merge-table-count-diff.json'), mergeDeltas)
  writeJson(path.join(directory, 'post-rollback-table-count-diff.json'), rollbackComparison)

  const markdown = [
    '# Test Work merge isolated lab rehearsal',
    '',
    `- Target Works: ${review.targetWorkIds.join(', ')}`,
    `- Business tables checked: ${summary.businessTableCountChecks}`,
    `- Restore completed: ${summary.stages.restoreCompleted}`,
    `- Baseline acceptance: ${summary.stages.baselineAcceptancePassed}`,
    `- Apply transaction: ${summary.stages.applyTransactionPassed}`,
    `- Post-merge acceptance: ${summary.stages.postMergeAcceptancePassed}`,
    `- Rollback transaction: ${summary.stages.rollbackTransactionPassed}`,
    `- Post-rollback acceptance: ${summary.stages.postRollbackAcceptancePassed}`,
    `- Lab round trip verified: ${summary.labRoundTripVerified}`,
    `- Ready for production execution planning: ${summary.readyForProductionExecutionPlanning}`,
    '',
    '## Expected and observed post-merge row-count changes',
    '',
    ...summary.observedPostMergeChangedTables.map((row) => `- ${row.table}: ${row.before} -> ${row.after} (${row.delta})`),
    '',
    '## Safety',
    '',
    '- Production container access: inspect only',
    '- Production database write: false',
    '- Lab database write: true, isolated disposable container only',
    '- Lab network: disabled',
    '- Lab container removed: true',
    '- Production merge performed: false',
    '- Production rollback performed: false',
    '- Production execution wrapper generated: false',
    '- Production execution approved: false',
    '- Backup modified: false',
  ].join('\n')
  writeText(path.join(directory, 'lab-rehearsal-summary.md'), markdown)

  const files = fs.readdirSync(directory)
    .filter((name) => name !== 'manifest.json')
    .sort()
  writeJson(path.join(directory, 'manifest.json'), files.map((name) => {
    const file = path.join(directory, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('Test Work merge isolated lab rehearsal summary complete')
  console.log(`BusinessTableCountChecks: ${summary.businessTableCountChecks}`)
  console.log('RestoreCompleted: True')
  console.log('BaselineAcceptance: Passed')
  console.log('ApplyTransaction: Passed')
  console.log('PostMergeAcceptance: Passed')
  console.log('RollbackTransaction: Passed')
  console.log('PostRollbackAcceptance: Passed')
  console.log('LabRoundTripVerified: True')
  console.log('ProductionDatabaseWrite: False')
  console.log('MergePerformedInProduction: False')
}

main()
