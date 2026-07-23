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

function writeText(file, value) {
  fs.writeFileSync(file, `${String(value).replace(/\s+$/u, '')}\n`, 'utf8')
}

function writeJson(file, value) {
  writeText(file, JSON.stringify(value, null, 2))
}

function writeJsonl(file, rows) {
  writeText(file, rows.map((row) => JSON.stringify(row)).join('\n'))
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function verifyManifest(directory, manifestName = 'manifest.json') {
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

function identifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function sqlScalar(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return sqlString(value)
}

function jsonbLiteral(value) {
  return `${sqlString(JSON.stringify(value))}::jsonb`
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function rowKey(tableName, id) {
  return `${tableName}\u0000${String(id)}`
}

function parentId(entry) {
  return entry?.row?.[entry.columnName]
}

function cleanedSearchLines(value) {
  const blockedPrefixes = [
    'mergedintoworkid:',
    'mergedintoworktitle:',
    'mergedduplicateworkids:',
    'duplicatemergesourcekey:',
    'duplicatemergemediumkey:',
  ]
  return String(value || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !blockedPrefixes.some((prefix) => line.toLowerCase().startsWith(prefix)))
}

function uniqueLines(...groups) {
  const seen = new Set()
  const output = []
  for (const line of groups.flat()) {
    const key = String(line).normalize('NFKC').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(String(line))
  }
  return output
}

function tableKey(row) {
  return `${row.tableSchema || row.table_schema}.${row.tableName || row.table_name}`
}

function columnKey(tableSchema, tableName, columnName) {
  return `${tableSchema}.${tableName}.${columnName}`
}

function sqlValue(value, column) {
  if (value === null || value === undefined) return 'NULL'
  if (column.typeKind === 'e') {
    return `${sqlString(value)}::${identifier(column.typeSchema)}.${identifier(column.typeName)}`
  }
  const typeSql = String(column.typeSql || '')
  if (typeSql === 'jsonb') return `${sqlString(JSON.stringify(value))}::jsonb`
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') return String(value)
  if (typeSql.includes('timestamp')) return `${sqlString(value)}::${typeSql}`
  return sqlString(value)
}

function ignoredJsonExpression(expression, ignoredKeys) {
  if (!ignoredKeys.length) return expression
  return `(${expression} - ARRAY[${ignoredKeys.map(sqlString).join(', ')}]::text[])`
}

function plpgsqlExactRowCheck({
  tableSchema = 'public',
  tableName,
  row,
  label,
  lock = false,
  ignoredKeys = [],
}) {
  const table = `${identifier(tableSchema)}.${identifier(tableName)}`
  const id = sqlScalar(row.id)
  const actual = ignoredJsonExpression('actual_row', ignoredKeys)
  const expected = ignoredJsonExpression(jsonbLiteral(row), ignoredKeys)
  return [
    `  SELECT to_jsonb(t) INTO actual_row FROM ${table} t WHERE t.${identifier('id')} = ${id}${lock ? ' FOR UPDATE' : ''};`,
    `  IF actual_row IS NULL THEN RAISE EXCEPTION ${sqlString(`${label}:missing`)}; END IF;`,
    `  IF ${actual} IS DISTINCT FROM ${expected} THEN`,
    `    RAISE EXCEPTION ${sqlString(`${label}:row_mismatch`)};`,
    '  END IF;',
  ].join('\n')
}

function plpgsqlMissingRowCheck({ tableSchema = 'public', tableName, id, label }) {
  return [
    `  SELECT count(*) INTO actual_count FROM ${identifier(tableSchema)}.${identifier(tableName)} WHERE ${identifier('id')} = ${sqlScalar(id)};`,
    `  IF actual_count <> 0 THEN RAISE EXCEPTION ${sqlString(`${label}:expected_absent`)}; END IF;`,
  ].join('\n')
}

function plpgsqlRelationCountCheck({ locator, ids, expectedCount, label }) {
  return [
    `  SELECT count(*) INTO actual_count FROM ${identifier(locator.tableSchema)}.${identifier(locator.tableName)}`,
    `  WHERE ${identifier(locator.columnName)} IN (${ids.map(sqlScalar).join(', ')});`,
    `  IF actual_count <> ${expectedCount} THEN RAISE EXCEPTION ${sqlString(`${label}:count_mismatch`)}, actual_count; END IF;`,
  ].join('\n')
}

function plpgsqlUpdate({ tableSchema = 'public', tableName, id, assignments, label }) {
  return [
    `  UPDATE ${identifier(tableSchema)}.${identifier(tableName)}`,
    '  SET ' + assignments.map((row) => `${identifier(row.column)} = ${row.sql}`).join(',\n      '),
    `  WHERE ${identifier('id')} = ${sqlScalar(id)};`,
    '  GET DIAGNOSTICS affected = ROW_COUNT;',
    `  IF affected <> 1 THEN RAISE EXCEPTION ${sqlString(`${label}:update_count`)}, affected; END IF;`,
  ].join('\n')
}

function plpgsqlDelete({ tableSchema = 'public', tableName, id, label }) {
  return [
    `  DELETE FROM ${identifier(tableSchema)}.${identifier(tableName)} WHERE ${identifier('id')} = ${sqlScalar(id)};`,
    '  GET DIAGNOSTICS affected = ROW_COUNT;',
    `  IF affected <> 1 THEN RAISE EXCEPTION ${sqlString(`${label}:delete_count`)}, affected; END IF;`,
  ].join('\n')
}

function plpgsqlInsertJsonRow({ tableSchema = 'public', tableName, row, label }) {
  return [
    `  INSERT INTO ${identifier(tableSchema)}.${identifier(tableName)}`,
    `  SELECT restored.* FROM jsonb_populate_record(NULL::${identifier(tableSchema)}.${identifier(tableName)}, ${jsonbLiteral(row)}) AS restored;`,
    '  GET DIAGNOSTICS affected = ROW_COUNT;',
    `  IF affected <> 1 THEN RAISE EXCEPTION ${sqlString(`${label}:insert_count`)}, affected; END IF;`,
  ].join('\n')
}

function sqlHeader(kind, backup, sources) {
  return [
    '\\set ON_ERROR_STOP on',
    `-- ${kind}`,
    '-- REVIEW ARTIFACT. No repository wrapper executes this file.',
    '-- The .disabled extension is intentional.',
    `-- Verified backup SHA-256: ${backup.sha256}`,
    `-- Verified backup bytes: ${backup.bytes}`,
    `-- v03 manifest SHA-256: ${sources.dryRunManifestSha256}`,
    `-- schema manifest SHA-256: ${sources.schemaManifestSha256}`,
    '',
  ].join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  for (const key of [
    'identity-audit-dir',
    'dryrun-v03-dir',
    'backup-verification-dir',
    'schema-audit-dir',
    'output-dir',
  ]) {
    if (!text(args[key])) throw new Error(`Required: --${key}`)
  }

  const identityDir = path.resolve(args['identity-audit-dir'])
  const dryRunDir = path.resolve(args['dryrun-v03-dir'])
  const backupDir = path.resolve(args['backup-verification-dir'])
  const schemaDir = path.resolve(args['schema-audit-dir'])
  const outputDir = path.resolve(args['output-dir'])
  fs.mkdirSync(outputDir, { recursive: true })

  verifyManifest(identityDir)
  verifyManifest(dryRunDir)
  verifyManifest(backupDir, 'evidence-manifest.json')
  verifyManifest(schemaDir)

  const identityValidation = readJson(path.join(identityDir, 'validation.json'))
  const dryRunSummary = readJson(path.join(dryRunDir, 'merge-dryrun-summary.json'))
  const backupSummary = readJson(path.join(backupDir, 'backup-verification-summary.json'))
  const schemaSummary = readJson(path.join(schemaDir, 'write-schema-audit-summary.json'))
  const schemaTargets = readJson(path.join(schemaDir, 'write-schema-targets.json'))

  if (identityValidation.databaseWrite !== false || identityValidation.jsonValidated !== true) {
    throw new Error('Identity input is not validated read-only evidence.')
  }
  if (dryRunSummary.schemaVersion !== 3
    || dryRunSummary.exactBeforeAllChecksRequireTrue !== true
    || dryRunSummary.safety?.databaseWrite !== false
    || dryRunSummary.safety?.mergePerformed !== false) {
    throw new Error('v03 dry-run is not a validated non-writing transaction source.')
  }
  if (backupSummary.backupRestoreVerified !== true
    || backupSummary.productionPreMatchedChecks !== 37
    || backupSummary.productionPostMatchedChecks !== 37
    || backupSummary.restoredMatchedChecks !== 37
    || backupSummary.safety?.productionDatabaseWrite !== false
    || backupSummary.safety?.productionContainerTempFilesRemoved !== true
    || backupSummary.safety?.ephemeralVerificationContainerRemoved !== true) {
    throw new Error('Backup verification gate is incomplete.')
  }
  if (schemaSummary.readyForTransactionSqlPlanning !== true
    || schemaSummary.blockers?.length !== 0
    || schemaSummary.warnings?.length !== 0
    || schemaSummary.safety?.databaseWrite !== false
    || schemaSummary.safety?.executableTransactionSqlGenerated !== false) {
    throw new Error('Write-schema audit is not clean enough for transaction review generation.')
  }

  const backupPath = path.join(backupDir, 'database-backup.dump')
  if (!fs.existsSync(backupPath)
    || fs.statSync(backupPath).size !== Number(backupSummary.backupBytes)
    || sha256File(backupPath) !== text(backupSummary.backupSha256).toLowerCase()) {
    throw new Error('Verified local database backup is missing or changed.')
  }

  const sourceBindings = {
    identityManifestSha256: sha256File(path.join(identityDir, 'manifest.json')),
    dryRunManifestSha256: sha256File(path.join(dryRunDir, 'manifest.json')),
    backupEvidenceManifestSha256: sha256File(path.join(backupDir, 'evidence-manifest.json')),
    schemaManifestSha256: sha256File(path.join(schemaDir, 'manifest.json')),
  }
  if (schemaTargets.sourceDryRunManifestSha256 !== sourceBindings.dryRunManifestSha256
    || schemaTargets.sourceBackupEvidenceManifestSha256 !== sourceBindings.backupEvidenceManifestSha256
    || schemaTargets.localBackup?.sha256 !== backupSummary.backupSha256) {
    throw new Error('Schema audit is not bound to the current dry-run and verified backup.')
  }

  const decisions = readJson(path.join(dryRunDir, 'canonical-merge-decisions.json'))
  const fieldPlan = readJsonl(path.join(dryRunDir, 'field-merge-plan.jsonl'))
  const relationPlan = readJsonl(path.join(dryRunDir, 'relation-merge-plan.jsonl'))
  const cleanupPlan = readJsonl(path.join(dryRunDir, 'test-assessment-cleanup-plan.jsonl'))
  const feedbackPlan = readJsonl(path.join(dryRunDir, 'feedback-test-cleanup-plan.jsonl'))
  const existingStandardizationPlan = readJsonl(path.join(dryRunDir, 'work-standardization-plan.jsonl'))
  const versionPlan = readJsonl(path.join(dryRunDir, 'version-preservation-plan.jsonl'))
  const workRows = readJsonl(path.join(identityDir, 'work-rows.jsonl'))
  const relatedRows = readJsonl(path.join(identityDir, 'related-rows.jsonl'))
  const relationLocators = readJson(path.join(identityDir, 'relation-locators.json'))
  const versionRows = readJsonl(path.join(identityDir, 'version-related-rows.jsonl'))
  const versionLocators = readJson(path.join(identityDir, 'version-relation-locators.json'))
  const columns = readJsonl(path.join(schemaDir, 'column-metadata.jsonl'))
  const enums = readJsonl(path.join(schemaDir, 'enum-labels.jsonl'))

  const supportedRelationActions = new Set([
    'preserve_version_parent_in_place',
    'skip_semantic_duplicate_already_on_canonical',
    'copy_factual_child_to_canonical_if_exact_before_still_matches',
    'discard_test_assessment_child_row',
  ])
  const unsupported = relationPlan.filter((row) => !supportedRelationActions.has(row.action))
  if (unsupported.length) {
    throw new Error(`Unsupported relation actions remain: ${[...new Set(unsupported.map((row) => row.action))].join(', ')}`)
  }
  if (existingStandardizationPlan.some((row) => row.action === 'add_merge_out_title_as_canonical_alias')) {
    throw new Error('This review generator does not create new alias IDs; the current evidence should protect the title as already present.')
  }
  if (versionPlan.some((row) => row.reparentVersions !== false || row.deleteVersions !== false)) {
    throw new Error('Version preservation plan changed unexpectedly.')
  }

  const columnsByKey = new Map(columns.map((row) => [
    columnKey(row.tableSchema, row.tableName, row.columnName),
    row,
  ]))
  const enumValues = new Map()
  for (const row of enums) {
    const key = columnKey(row.tableSchema, row.tableName, row.columnName)
    if (!enumValues.has(key)) enumValues.set(key, new Set())
    enumValues.get(key).add(row.label)
  }
  function requireColumn(tableName, columnName, tableSchema = 'public') {
    const column = columnsByKey.get(columnKey(tableSchema, tableName, columnName))
    if (!column) throw new Error(`Schema audit is missing required column: ${tableSchema}.${tableName}.${columnName}`)
    return column
  }
  function validateValue(tableName, columnName, value, tableSchema = 'public') {
    const column = requireColumn(tableName, columnName, tableSchema)
    if (value !== null && value !== undefined && column.typeKind === 'e') {
      const values = enumValues.get(columnKey(tableSchema, tableName, columnName)) || new Set()
      if (!values.has(value)) throw new Error(`Invalid enum plan value: ${tableSchema}.${tableName}.${columnName}=${value}`)
    }
    return column
  }

  for (const [tableName, columnName] of [
    ['feedback_submissions', 'workflow_status'],
    ['feedback_submissions', 'updated_at'],
    ['works', 'updated_at'],
    ['works', 'search_text'],
    ['works', 'catalog_status'],
    ['works', 'is_lite_visible'],
    ['works', 'is_full_visible'],
  ]) requireColumn(tableName, columnName)
  validateValue('feedback_submissions', 'workflow_status', 'archived')

  const worksById = new Map(workRows.map((row) => [Number(row.id), row]))
  const relatedByKey = new Map()
  for (const entry of relatedRows) {
    if (entry?.row?.id === null || entry?.row?.id === undefined) continue
    relatedByKey.set(rowKey(entry.tableName, entry.row.id), entry)
  }

  const cleanupByWork = new Map(cleanupPlan.map((row) => [Number(row.workId), row]))
  const workAfterById = new Map()
  const workChangedColumnsById = new Map()
  const standardizationRefinements = []

  function setWorkValue(workId, columnName, value) {
    const row = workAfterById.get(workId)
    if (!row) throw new Error(`Missing planned Work row: ${workId}`)
    validateValue('works', columnName, value)
    row[columnName] = value
    if (!workChangedColumnsById.has(workId)) workChangedColumnsById.set(workId, new Set())
    workChangedColumnsById.get(workId).add(columnName)
  }

  for (const decision of decisions) {
    for (const id of [Number(decision.canonicalWorkId), Number(decision.mergeOutWorkId)]) {
      const baseline = worksById.get(id)
      const cleanup = cleanupByWork.get(id)
      if (!baseline || !cleanup) throw new Error(`Missing Work baseline or cleanup plan: ${id}`)
      workAfterById.set(id, deepClone(baseline))
      workChangedColumnsById.set(id, new Set())
      for (const [columnName, value] of Object.entries(cleanup.after || {})) setWorkValue(id, columnName, value)
    }

    setWorkValue(Number(decision.canonicalWorkId), 'catalog_status', 'active')
    setWorkValue(Number(decision.canonicalWorkId), 'is_lite_visible', true)
    setWorkValue(Number(decision.canonicalWorkId), 'is_full_visible', true)
    setWorkValue(Number(decision.mergeOutWorkId), 'catalog_status', 'archived')
    setWorkValue(Number(decision.mergeOutWorkId), 'is_lite_visible', false)
    setWorkValue(Number(decision.mergeOutWorkId), 'is_full_visible', false)

    const canonical = worksById.get(Number(decision.canonicalWorkId))
    const mergeOut = worksById.get(Number(decision.mergeOutWorkId))
    const desiredSearchText = uniqueLines(
      cleanedSearchLines(canonical.search_text),
      cleanedSearchLines(mergeOut.search_text),
    ).join('\n')
    if (desiredSearchText !== String(canonical.search_text || '')) {
      setWorkValue(Number(decision.canonicalWorkId), 'search_text', desiredSearchText)
      standardizationRefinements.push({
        alertId: decision.alertId,
        workId: decision.canonicalWorkId,
        action: 'merge_and_remove_all_duplicate_operation_search_markers',
        before: canonical.search_text || '',
        after: desiredSearchText,
        sourceWorkId: decision.mergeOutWorkId,
        refinementReason: 'v03 filtered incoming lines but did not update a canonical row when cleanup alone changed the text',
        executable: false,
      })
    }
  }

  for (const plan of fieldPlan) {
    if (plan.action === 'copy_missing_factual_value_from_merge_out') {
      setWorkValue(Number(plan.workId), plan.field, plan.after)
    } else if (plan.action === 'preserve_canonical_and_record_external_id_conflict') {
      continue
    } else if (plan.action === 'keep_canonical_public_identity'
      || plan.action === 'soft_archive_merge_out_without_deleting_or_rewriting_versions') {
      continue
    } else {
      throw new Error(`Unsupported field plan action: ${plan.action}`)
    }
  }

  const movedRows = []
  const deletedRows = []
  const skippedRows = []
  for (const plan of relationPlan) {
    if (plan.action === 'preserve_version_parent_in_place') continue
    const entry = relatedByKey.get(rowKey(plan.tableName, plan.rowId))
    if (!entry) throw new Error(`Missing baseline relation row: ${plan.tableName}:${plan.rowId}`)
    if (plan.action === 'skip_semantic_duplicate_already_on_canonical') {
      skippedRows.push({ ...plan, baselineRow: entry.row })
      continue
    }
    if (plan.action === 'copy_factual_child_to_canonical_if_exact_before_still_matches') {
      const after = deepClone(entry.row)
      after[plan.columnName] = plan.targetWorkId
      movedRows.push({ ...plan, beforeRow: entry.row, afterRow: after, writeStrategy: 'reparent_existing_row' })
      continue
    }
    if (plan.action === 'discard_test_assessment_child_row') {
      deletedRows.push({ ...plan, beforeRow: entry.row })
    }
  }

  const feedbackRows = feedbackPlan.map((plan) => {
    const entry = relatedByKey.get(rowKey(plan.tableName, plan.rowId))
    if (!entry) throw new Error(`Missing baseline feedback row: ${plan.rowId}`)
    const after = deepClone(entry.row)
    after.workflow_status = 'archived'
    return { ...plan, beforeRow: entry.row, afterRow: after, changedColumns: ['workflow_status', 'updated_at'] }
  })

  const targetIds = decisions.flatMap((row) => [Number(row.canonicalWorkId), Number(row.mergeOutWorkId)])
  const targetVersionIds = relatedRows
    .filter((entry) => entry.tableName === '_works_v' && targetIds.map(String).includes(String(parentId(entry))))
    .map((entry) => entry.row.id)

  const baselineRelationCounts = relationLocators.map((locator) => ({
    locator,
    ids: targetIds,
    count: relatedRows.filter((entry) =>
      entry.tableSchema === locator.tableSchema
      && entry.tableName === locator.tableName
      && entry.columnName === locator.columnName
      && targetIds.map(String).includes(String(parentId(entry))),
    ).length,
  }))
  const baselineVersionCounts = versionLocators.map((locator) => ({
    locator,
    ids: targetVersionIds,
    count: versionRows.filter((entry) =>
      entry.tableSchema === locator.tableSchema
      && entry.tableName === locator.tableName
      && entry.columnName === locator.columnName
      && targetVersionIds.map(String).includes(String(parentId(entry))),
    ).length,
  }))
  const afterRelationCounts = baselineRelationCounts.map((row) => ({
    ...row,
    count: row.count - deletedRows.filter((entry) =>
      entry.tableSchema === row.locator.tableSchema
      && entry.tableName === row.locator.tableName
      && entry.columnName === row.locator.columnName,
    ).length,
  }))

  const allExactBeforeRows = [
    ...targetIds.map((id) => ({ tableSchema: 'public', tableName: 'works', row: worksById.get(id) })),
    ...movedRows.map((row) => ({ tableSchema: row.tableSchema, tableName: row.tableName, row: row.beforeRow })),
    ...deletedRows.map((row) => ({ tableSchema: row.tableSchema, tableName: row.tableName, row: row.beforeRow })),
    ...feedbackRows.map((row) => ({ tableSchema: row.tableSchema, tableName: row.tableName, row: row.beforeRow })),
  ]
  const exactKeys = new Set()
  for (const row of allExactBeforeRows) {
    const key = `${row.tableSchema}.${row.tableName}:${row.row.id}`
    if (exactKeys.has(key)) throw new Error(`Duplicate exact-before row: ${key}`)
    exactKeys.add(key)
  }

  const sources = sourceBindings
  const backup = {
    file: backupPath,
    bytes: fs.statSync(backupPath).size,
    sha256: sha256File(backupPath),
    restoreVerified: true,
  }

  const guardChecks = [
    ...allExactBeforeRows.map(({ tableSchema, tableName, row }) => plpgsqlExactRowCheck({
      tableSchema,
      tableName,
      row,
      label: `exact_before:${tableSchema}.${tableName}:${row.id}`,
      lock: true,
    })),
    ...baselineRelationCounts.map((row) => plpgsqlRelationCountCheck({
      locator: row.locator,
      ids: row.ids,
      expectedCount: row.count,
      label: `exact_before_relation:${tableKey(row.locator)}`,
    })),
    ...baselineVersionCounts.map((row) => plpgsqlRelationCountCheck({
      locator: row.locator,
      ids: row.ids,
      expectedCount: row.count,
      label: `exact_before_version:${tableKey(row.locator)}`,
    })),
  ]

  const applyStatements = []
  for (const id of targetIds) {
    const after = workAfterById.get(id)
    const changed = [...workChangedColumnsById.get(id)].sort()
    const assignments = changed.map((columnName) => ({
      column: columnName,
      sql: sqlValue(after[columnName], requireColumn('works', columnName)),
    }))
    assignments.push({ column: 'updated_at', sql: 'transaction_timestamp()' })
    applyStatements.push(plpgsqlUpdate({
      tableName: 'works', id, assignments, label: `apply:public.works:${id}`,
    }))
  }
  for (const row of movedRows) {
    applyStatements.push(plpgsqlUpdate({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      id: row.rowId,
      assignments: [{
        column: row.columnName,
        sql: sqlValue(row.targetWorkId, requireColumn(row.tableName, row.columnName, row.tableSchema)),
      }],
      label: `apply:${row.tableSchema}.${row.tableName}:${row.rowId}`,
    }))
  }
  for (const row of deletedRows) {
    applyStatements.push(plpgsqlDelete({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      id: row.rowId,
      label: `apply:${row.tableSchema}.${row.tableName}:${row.rowId}`,
    }))
  }
  for (const row of feedbackRows) {
    applyStatements.push(plpgsqlUpdate({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      id: row.rowId,
      assignments: [
        {
          column: 'workflow_status',
          sql: sqlValue('archived', requireColumn('feedback_submissions', 'workflow_status')),
        },
        { column: 'updated_at', sql: 'transaction_timestamp()' },
      ],
      label: `apply:${row.tableSchema}.${row.tableName}:${row.rowId}`,
    }))
  }

  const acceptanceChecks = [
    ...targetIds.map((id) => plpgsqlExactRowCheck({
      tableName: 'works',
      row: workAfterById.get(id),
      label: `acceptance:public.works:${id}`,
      ignoredKeys: ['updated_at'],
    })),
    ...movedRows.map((row) => plpgsqlExactRowCheck({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      row: row.afterRow,
      label: `acceptance:${row.tableSchema}.${row.tableName}:${row.rowId}`,
    })),
    ...deletedRows.map((row) => plpgsqlMissingRowCheck({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      id: row.rowId,
      label: `acceptance:${row.tableSchema}.${row.tableName}:${row.rowId}`,
    })),
    ...feedbackRows.map((row) => plpgsqlExactRowCheck({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      row: row.afterRow,
      label: `acceptance:${row.tableSchema}.${row.tableName}:${row.rowId}`,
      ignoredKeys: ['updated_at'],
    })),
    ...afterRelationCounts.map((row) => plpgsqlRelationCountCheck({
      locator: row.locator,
      ids: row.ids,
      expectedCount: row.count,
      label: `acceptance_relation:${tableKey(row.locator)}`,
    })),
    ...baselineVersionCounts.map((row) => plpgsqlRelationCountCheck({
      locator: row.locator,
      ids: row.ids,
      expectedCount: row.count,
      label: `acceptance_version:${tableKey(row.locator)}`,
    })),
  ]

  const applySql = [
    sqlHeader('GUARDED TEST WORK MERGE APPLY TRANSACTION', backup, sources),
    'BEGIN ISOLATION LEVEL SERIALIZABLE;',
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '5min';",
    "SET LOCAL idle_in_transaction_session_timeout = '5min';",
    '',
    'DO $exact_before$',
    'DECLARE actual_row jsonb; actual_count bigint;',
    'BEGIN',
    guardChecks.join('\n\n'),
    'END',
    '$exact_before$;',
    '',
    'DO $apply$',
    'DECLARE affected bigint;',
    'BEGIN',
    applyStatements.join('\n\n'),
    'END',
    '$apply$;',
    '',
    'DO $acceptance$',
    'DECLARE actual_row jsonb; actual_count bigint;',
    'BEGIN',
    acceptanceChecks.join('\n\n'),
    'END',
    '$acceptance$;',
    '',
    'COMMIT;',
  ].join('\n')

  const rollbackGuardChecks = [
    ...targetIds.map((id) => plpgsqlExactRowCheck({
      tableName: 'works',
      row: workAfterById.get(id),
      label: `rollback_guard:public.works:${id}`,
      lock: true,
      ignoredKeys: ['updated_at'],
    })),
    ...movedRows.map((row) => plpgsqlExactRowCheck({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      row: row.afterRow,
      label: `rollback_guard:${row.tableSchema}.${row.tableName}:${row.rowId}`,
      lock: true,
    })),
    ...deletedRows.map((row) => plpgsqlMissingRowCheck({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      id: row.rowId,
      label: `rollback_guard:${row.tableSchema}.${row.tableName}:${row.rowId}`,
    })),
    ...feedbackRows.map((row) => plpgsqlExactRowCheck({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      row: row.afterRow,
      label: `rollback_guard:${row.tableSchema}.${row.tableName}:${row.rowId}`,
      lock: true,
      ignoredKeys: ['updated_at'],
    })),
    ...afterRelationCounts.map((row) => plpgsqlRelationCountCheck({
      locator: row.locator,
      ids: row.ids,
      expectedCount: row.count,
      label: `rollback_guard_relation:${tableKey(row.locator)}`,
    })),
    ...baselineVersionCounts.map((row) => plpgsqlRelationCountCheck({
      locator: row.locator,
      ids: row.ids,
      expectedCount: row.count,
      label: `rollback_guard_version:${tableKey(row.locator)}`,
    })),
  ]

  const rollbackStatements = []
  for (const id of targetIds) {
    const baseline = worksById.get(id)
    const changed = [...workChangedColumnsById.get(id)].sort()
    const assignments = changed.map((columnName) => ({
      column: columnName,
      sql: sqlValue(baseline[columnName], requireColumn('works', columnName)),
    }))
    assignments.push({
      column: 'updated_at',
      sql: sqlValue(baseline.updated_at, requireColumn('works', 'updated_at')),
    })
    rollbackStatements.push(plpgsqlUpdate({
      tableName: 'works', id, assignments, label: `rollback:public.works:${id}`,
    }))
  }
  for (const row of movedRows) {
    rollbackStatements.push(plpgsqlUpdate({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      id: row.rowId,
      assignments: [{
        column: row.columnName,
        sql: sqlValue(row.sourceWorkId, requireColumn(row.tableName, row.columnName, row.tableSchema)),
      }],
      label: `rollback:${row.tableSchema}.${row.tableName}:${row.rowId}`,
    }))
  }
  for (const row of deletedRows) {
    rollbackStatements.push(plpgsqlInsertJsonRow({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      row: row.beforeRow,
      label: `rollback:${row.tableSchema}.${row.tableName}:${row.rowId}`,
    }))
  }
  for (const row of feedbackRows) {
    rollbackStatements.push(plpgsqlUpdate({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      id: row.rowId,
      assignments: [
        {
          column: 'workflow_status',
          sql: sqlValue(row.beforeRow.workflow_status, requireColumn('feedback_submissions', 'workflow_status')),
        },
        {
          column: 'updated_at',
          sql: sqlValue(row.beforeRow.updated_at, requireColumn('feedback_submissions', 'updated_at')),
        },
      ],
      label: `rollback:${row.tableSchema}.${row.tableName}:${row.rowId}`,
    }))
  }

  const baselineAcceptanceChecks = [
    ...allExactBeforeRows.map(({ tableSchema, tableName, row }) => plpgsqlExactRowCheck({
      tableSchema,
      tableName,
      row,
      label: `rollback_acceptance:${tableSchema}.${tableName}:${row.id}`,
    })),
    ...baselineRelationCounts.map((row) => plpgsqlRelationCountCheck({
      locator: row.locator,
      ids: row.ids,
      expectedCount: row.count,
      label: `rollback_acceptance_relation:${tableKey(row.locator)}`,
    })),
    ...baselineVersionCounts.map((row) => plpgsqlRelationCountCheck({
      locator: row.locator,
      ids: row.ids,
      expectedCount: row.count,
      label: `rollback_acceptance_version:${tableKey(row.locator)}`,
    })),
  ]

  const rollbackSql = [
    sqlHeader('GUARDED TEST WORK MERGE ROLLBACK TRANSACTION', backup, sources),
    'BEGIN ISOLATION LEVEL SERIALIZABLE;',
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '5min';",
    "SET LOCAL idle_in_transaction_session_timeout = '5min';",
    '',
    'DO $rollback_guard$',
    'DECLARE actual_row jsonb; actual_count bigint;',
    'BEGIN',
    rollbackGuardChecks.join('\n\n'),
    'END',
    '$rollback_guard$;',
    '',
    'DO $rollback$',
    'DECLARE affected bigint;',
    'BEGIN',
    rollbackStatements.join('\n\n'),
    'END',
    '$rollback$;',
    '',
    'DO $rollback_acceptance$',
    'DECLARE actual_row jsonb; actual_count bigint;',
    'BEGIN',
    baselineAcceptanceChecks.join('\n\n'),
    'END',
    '$rollback_acceptance$;',
    '',
    'COMMIT;',
  ].join('\n')

  const acceptanceSql = [
    '\\set ON_ERROR_STOP on',
    '-- POST-MERGE ACCEPTANCE. READ-ONLY.',
    `-- Verified backup SHA-256: ${backup.sha256}`,
    'BEGIN TRANSACTION READ ONLY;',
    '',
    'DO $acceptance$',
    'DECLARE actual_row jsonb; actual_count bigint;',
    'BEGIN',
    acceptanceChecks.join('\n\n'),
    'END',
    '$acceptance$;',
    '',
    'ROLLBACK;',
  ].join('\n')

  const rollbackAcceptanceSql = [
    '\\set ON_ERROR_STOP on',
    '-- POST-ROLLBACK ACCEPTANCE. READ-ONLY.',
    `-- Verified backup SHA-256: ${backup.sha256}`,
    'BEGIN TRANSACTION READ ONLY;',
    '',
    'DO $rollback_acceptance$',
    'DECLARE actual_row jsonb; actual_count bigint;',
    'BEGIN',
    baselineAcceptanceChecks.join('\n\n'),
    'END',
    '$rollback_acceptance$;',
    '',
    'ROLLBACK;',
  ].join('\n')

  const operations = {
    workUpdates: targetIds.map((id) => ({
      workId: id,
      before: worksById.get(id),
      afterIgnoringUpdatedAt: workAfterById.get(id),
      changedColumns: [...workChangedColumnsById.get(id)].sort(),
      updatedAtStrategy: 'transaction_timestamp',
    })),
    factualChildReparents: movedRows,
    testAssessmentChildDeletes: deletedRows,
    feedbackArchives: feedbackRows,
    semanticDuplicateSkips: skippedRows,
    versionPolicy: versionPlan,
    standardizationRefinements,
  }

  const review = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources,
    backup,
    identityGroups: decisions.length,
    targetWorkIds: targetIds,
    operationCounts: {
      workUpdates: operations.workUpdates.length,
      factualChildReparents: movedRows.length,
      testAssessmentChildDeletes: deletedRows.length,
      feedbackArchives: feedbackRows.length,
      semanticDuplicateSkips: skippedRows.length,
      versionGroupsPreserved: versionPlan.length,
      standardizationRefinements: standardizationRefinements.length,
      exactBeforeRows: allExactBeforeRows.length,
      exactBeforeRelationCounts: baselineRelationCounts.length,
      exactBeforeVersionCounts: baselineVersionCounts.length,
    },
    strategy: {
      factualChildHandling: 'reparent existing non-duplicate rows; do not generate new child IDs',
      testAssessmentHandling: 'delete explicitly authorized inaccurate test child rows',
      feedbackHandling: 'set workflow_status=archived; preserve linked_work_id and evidence text for audit history',
      mergeOutHandling: 'catalog_status=archived and both visibility flags=false; preserve Work row, slug, site_id, _status and all versions',
      canonicalHandling: 'catalog_status=active and visible; merge missing external IDs and cleaned search text',
      assessmentBaseline: 'human pending; rank unknown; rating_notice insufficient_information; private AI cleared; no public AI conclusion created',
      rollbackHandling: 'restore only planned Work fields, exact child rows and original feedback status/timestamps',
    },
    execution: {
      applySqlFile: 'merge-transaction.sql.disabled',
      rollbackSqlFile: 'merge-rollback.sql.disabled',
      repositoryExecutionWrapperExists: false,
      executed: false,
      explicitApprovalReceived: false,
    },
    safety: {
      databaseWrite: false,
      payloadWrite: false,
      migrationGeneration: false,
      schemaPush: false,
      executableSqlTextGenerated: true,
      executableSqlExtensionDisabled: true,
      executeWrapperGenerated: false,
      mergePerformed: false,
      rollbackPerformed: false,
      hardDeleteWorkPlanned: false,
      versionRewritePlanned: false,
      backupFileModified: false,
    },
  }

  writeJson(path.join(outputDir, 'transaction-review.json'), review)
  writeJson(path.join(outputDir, 'transaction-operations.json'), operations)
  writeJsonl(path.join(outputDir, 'transaction-standardization-refinements.jsonl'), standardizationRefinements)
  writeText(path.join(outputDir, 'merge-transaction.sql.disabled'), applySql)
  writeText(path.join(outputDir, 'merge-rollback.sql.disabled'), rollbackSql)
  writeText(path.join(outputDir, 'merge-acceptance-readonly.sql'), acceptanceSql)
  writeText(path.join(outputDir, 'merge-rollback-acceptance-readonly.sql'), rollbackAcceptanceSql)

  const markdown = [
    '# Test Work merge transaction review',
    '',
    `- Identity groups: ${review.identityGroups}`,
    `- Target Works: ${targetIds.join(', ')}`,
    `- Work updates: ${review.operationCounts.workUpdates}`,
    `- Factual child reparents: ${review.operationCounts.factualChildReparents}`,
    `- Test assessment child deletes: ${review.operationCounts.testAssessmentChildDeletes}`,
    `- Feedback archives: ${review.operationCounts.feedbackArchives}`,
    `- Semantic duplicate skips: ${review.operationCounts.semanticDuplicateSkips}`,
    `- Versions preserved in place: ${review.operationCounts.versionGroupsPreserved}`,
    `- Search standardization refinements: ${review.operationCounts.standardizationRefinements}`,
    `- Exact-before rows: ${review.operationCounts.exactBeforeRows}`,
    `- Relation count guards: ${review.operationCounts.exactBeforeRelationCounts}`,
    `- Version count guards: ${review.operationCounts.exactBeforeVersionCounts}`,
    '',
    '## Important strategy decisions',
    '',
    '- Factual child rows are reparented rather than duplicated, so no new arbitrary Payload child IDs are invented.',
    '- Inaccurate test assessment child rows are deleted under the explicit authorization for these two current groups.',
    '- Feedback rows are archived without relinking or erasing their submitted evidence text.',
    '- Work rows and all Payload versions remain present; merge-out Works are soft archived and hidden.',
    '- Existing duplicate-operation search markers are removed from canonical search text, including cleanup-only changes missed by v03.',
    '',
    '## Files',
    '',
    '- `merge-transaction.sql.disabled`: guarded apply transaction; not executed by any repository wrapper.',
    '- `merge-rollback.sql.disabled`: guarded rollback transaction; not executed by any repository wrapper.',
    '- `merge-acceptance-readonly.sql`: post-merge read-only acceptance.',
    '- `merge-rollback-acceptance-readonly.sql`: post-rollback read-only acceptance.',
    '- `transaction-operations.json`: complete before/after operation detail.',
    '',
    '## Safety',
    '',
    '- Database write: false',
    '- Payload write: false',
    '- SQL text generated: true',
    '- Disabled extension: true',
    '- Execute wrapper generated: false',
    '- Explicit execution approval received: false',
    '- Merge performed: false',
    '- Rollback performed: false',
    '- Hard delete Work planned: false',
    '- Version rewrite planned: false',
    '- Backup modified: false',
  ].join('\n')
  writeText(path.join(outputDir, 'transaction-review.md'), markdown)

  const files = fs.readdirSync(outputDir).filter((name) => name !== 'manifest.json').sort()
  writeJson(path.join(outputDir, 'manifest.json'), files.map((name) => {
    const file = path.join(outputDir, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('Test Work merge transaction review complete')
  console.log(`TargetWorks: ${targetIds.join(', ')}`)
  console.log(`WorkUpdates: ${review.operationCounts.workUpdates}`)
  console.log(`FactualChildReparents: ${review.operationCounts.factualChildReparents}`)
  console.log(`TestAssessmentChildDeletes: ${review.operationCounts.testAssessmentChildDeletes}`)
  console.log(`FeedbackArchives: ${review.operationCounts.feedbackArchives}`)
  console.log(`StandardizationRefinements: ${review.operationCounts.standardizationRefinements}`)
  console.log(`ExactBeforeRows: ${review.operationCounts.exactBeforeRows}`)
  console.log(`RelationCountGuards: ${review.operationCounts.exactBeforeRelationCounts}`)
  console.log(`VersionCountGuards: ${review.operationCounts.exactBeforeVersionCounts}`)
  console.log('ExecutableSqlTextGenerated: True')
  console.log('DisabledExtension: True')
  console.log('ExecuteWrapperGenerated: False')
  console.log('DatabaseWrite: False')
  console.log('MergePerformed: False')
}

main()
