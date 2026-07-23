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

function readJsonl(file) {
  return readText(file)
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`Invalid JSONL at ${file}:${index + 1}: ${error.message}`)
      }
    })
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function verifyManifest(directory, manifestName) {
  const manifestPath = path.join(directory, manifestName)
  const manifest = readJson(manifestPath)
  for (const entry of manifest) {
    const file = path.join(directory, entry.file)
    if (!fs.existsSync(file)) throw new Error(`Manifest file missing: ${entry.file}`)
    if (fs.statSync(file).size !== Number(entry.bytes)) {
      throw new Error(`Manifest byte mismatch: ${entry.file}`)
    }
    if (sha256File(file) !== text(entry.sha256).toLowerCase()) {
      throw new Error(`Manifest SHA-256 mismatch: ${entry.file}`)
    }
  }
  return { manifestPath, manifest }
}

function addTarget(map, { tableSchema = 'public', tableName, action, columnName = null, rowId = null }) {
  if (!text(tableName)) throw new Error('Write target is missing tableName.')
  const key = `${tableSchema}\u0000${tableName}`
  if (!map.has(key)) {
    map.set(key, {
      tableSchema,
      tableName,
      plannedActions: [],
      plannedColumns: [],
      plannedRowIds: [],
    })
  }
  const target = map.get(key)
  if (text(action) && !target.plannedActions.includes(action)) target.plannedActions.push(action)
  if (text(columnName) && !target.plannedColumns.includes(columnName)) target.plannedColumns.push(columnName)
  if (rowId !== null && rowId !== undefined && !target.plannedRowIds.map(String).includes(String(rowId))) {
    target.plannedRowIds.push(rowId)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  for (const key of ['dryrun-v03-dir', 'backup-verification-dir', 'output']) {
    if (!text(args[key])) throw new Error(`Required: --${key}`)
  }

  const dryRunDir = path.resolve(args['dryrun-v03-dir'])
  const backupDir = path.resolve(args['backup-verification-dir'])
  const outputPath = path.resolve(args.output)

  verifyManifest(dryRunDir, 'manifest.json')
  verifyManifest(backupDir, 'evidence-manifest.json')

  const dryRunSummary = readJson(path.join(dryRunDir, 'merge-dryrun-summary.json'))
  if (dryRunSummary.schemaVersion !== 3
    || dryRunSummary.exactBeforeAllChecksRequireTrue !== true
    || dryRunSummary.safety?.databaseWrite !== false
    || dryRunSummary.safety?.mergePerformed !== false) {
    throw new Error('v03 dry-run does not prove the expected non-writing safety boundary.')
  }

  const backupSummary = readJson(path.join(backupDir, 'backup-verification-summary.json'))
  if (backupSummary.backupRestoreVerified !== true
    || backupSummary.productionPreMatchedChecks !== 37
    || backupSummary.productionPostMatchedChecks !== 37
    || backupSummary.restoredMatchedChecks !== 37
    || backupSummary.productionCountsStableDuringBackup !== true
    || backupSummary.restoredCountsMatchProduction !== true
    || backupSummary.safety?.productionDatabaseWrite !== false
    || backupSummary.safety?.mergePerformed !== false) {
    throw new Error('Backup evidence does not prove a stable, restorable, non-writing production backup.')
  }

  const backupPath = path.join(backupDir, 'database-backup.dump')
  if (!fs.existsSync(backupPath)) throw new Error(`Local database backup is missing: ${backupPath}`)
  if (fs.statSync(backupPath).size !== Number(backupSummary.backupBytes)) {
    throw new Error('Local database backup byte count does not match the verified evidence.')
  }
  if (sha256File(backupPath) !== text(backupSummary.backupSha256).toLowerCase()) {
    throw new Error('Local database backup SHA-256 does not match the verified evidence.')
  }

  const relationPlan = readJsonl(path.join(dryRunDir, 'relation-merge-plan.jsonl'))
  const feedbackPlan = readJsonl(path.join(dryRunDir, 'feedback-test-cleanup-plan.jsonl'))
  const fieldPlan = readJsonl(path.join(dryRunDir, 'field-merge-plan.jsonl'))
  const cleanupPlan = readJsonl(path.join(dryRunDir, 'test-assessment-cleanup-plan.jsonl'))
  const standardizationPlan = readJsonl(path.join(dryRunDir, 'work-standardization-plan.jsonl'))
  const decisions = readJson(path.join(dryRunDir, 'canonical-merge-decisions.json'))

  const targets = new Map()
  addTarget(targets, { tableName: 'works', action: 'update_canonical_and_merge_out_work_rows', columnName: 'id' })

  const relationWriteActions = new Set([
    'copy_factual_child_to_canonical_if_exact_before_still_matches',
    'discard_test_assessment_child_row',
    'manual_reference_rewrite_review_required',
  ])
  for (const row of relationPlan) {
    if (!relationWriteActions.has(row.action)) continue
    addTarget(targets, {
      tableSchema: row.tableSchema || 'public',
      tableName: row.tableName,
      action: row.action,
      columnName: row.columnName,
      rowId: row.rowId,
    })
  }
  for (const row of feedbackPlan) {
    addTarget(targets, {
      tableSchema: row.tableSchema || 'public',
      tableName: row.tableName,
      action: row.action,
      columnName: row.columnName,
      rowId: row.rowId,
    })
  }
  for (const row of standardizationPlan) {
    if (row.action === 'add_merge_out_title_as_canonical_alias') {
      addTarget(targets, {
        tableName: 'works_aliases',
        action: row.action,
        columnName: '_parent_id',
      })
    }
  }

  const plannedWorkColumns = new Set(['id'])
  for (const row of fieldPlan) {
    if (typeof row.field === 'string' && !row.field.includes(' / ')) plannedWorkColumns.add(row.field)
  }
  for (const row of cleanupPlan) {
    for (const key of Object.keys(row.after || {})) plannedWorkColumns.add(key)
  }
  for (const row of standardizationPlan) {
    if (row.action === 'merge_clean_search_text_lines') plannedWorkColumns.add('search_text')
  }
  for (const column of [
    'catalog_status',
    'is_lite_visible',
    'is_full_visible',
    '_status',
    'updated_at',
  ]) plannedWorkColumns.add(column)
  targets.get('public\u0000works').plannedColumns = [...plannedWorkColumns].sort()

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceDryRunDirectory: dryRunDir,
    sourceBackupVerificationDirectory: backupDir,
    sourceDryRunManifestSha256: sha256File(path.join(dryRunDir, 'manifest.json')),
    sourceBackupEvidenceManifestSha256: sha256File(path.join(backupDir, 'evidence-manifest.json')),
    localBackup: {
      file: backupPath,
      bytes: fs.statSync(backupPath).size,
      sha256: sha256File(backupPath),
      restoreVerified: true,
    },
    identityGroups: decisions.length,
    targetWorkIds: decisions.flatMap((row) => [row.canonicalWorkId, row.mergeOutWorkId]),
    writeTargets: [...targets.values()]
      .map((row) => ({
        ...row,
        plannedActions: row.plannedActions.sort(),
        plannedColumns: row.plannedColumns.sort(),
        plannedRowIds: row.plannedRowIds.sort((a, b) => Number(a) - Number(b)),
      }))
      .sort((a, b) => `${a.tableSchema}.${a.tableName}`.localeCompare(`${b.tableSchema}.${b.tableName}`)),
    sourcePlanCounts: {
      fieldPlanRows: fieldPlan.length,
      relationPlanRows: relationPlan.length,
      feedbackPlanRows: feedbackPlan.length,
      assessmentCleanupRows: cleanupPlan.length,
      standardizationPlanRows: standardizationPlan.length,
    },
    safety: {
      databaseWrite: false,
      payloadWrite: false,
      migrationGeneration: false,
      schemaPush: false,
      executableTransactionSqlGenerated: false,
      mergePerformed: false,
      backupFileModified: false,
    },
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log('Test Work write-schema target derivation complete')
  console.log(`WriteTargetTables: ${output.writeTargets.length}`)
  console.log(`TargetWorkIds: ${output.targetWorkIds.join(', ')}`)
  console.log('LocalBackupHashMatched: True')
  console.log('DatabaseWrite: False')
  console.log('ExecutableTransactionSqlGenerated: False')
}

main()
