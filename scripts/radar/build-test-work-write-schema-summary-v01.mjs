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

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function tableKey(row) {
  return `${row.tableSchema || row.table_schema}.${row.tableName || row.table_name}`
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.directory) throw new Error('Required: --directory')
  const directory = path.resolve(args.directory)

  const targets = readJson(path.join(directory, 'write-schema-targets.json'))
  const validation = readJson(path.join(directory, 'validation.json'))
  const tables = readJsonl(path.join(directory, 'table-metadata.jsonl'))
  const columns = readJsonl(path.join(directory, 'column-metadata.jsonl'))
  const constraints = readJsonl(path.join(directory, 'constraints.jsonl'))
  const indexes = readJsonl(path.join(directory, 'indexes.jsonl'))
  const triggers = readJsonl(path.join(directory, 'triggers.jsonl'))
  const policies = readJsonl(path.join(directory, 'policies.jsonl'))
  const enums = readJsonl(path.join(directory, 'enum-labels.jsonl'))
  const sequences = readJsonl(path.join(directory, 'sequence-metadata.jsonl'))

  if (targets.safety?.databaseWrite !== false
    || targets.safety?.executableTransactionSqlGenerated !== false
    || targets.localBackup?.restoreVerified !== true) {
    throw new Error('Write target input does not prove backup-bound non-writing safety.')
  }
  if (validation.databaseWrite !== false
    || validation.payloadWrite !== false
    || validation.executableTransactionSqlGenerated !== false
    || validation.postgresReadOnly !== true
    || validation.jsonValidated !== true) {
    throw new Error('Write-schema audit validation does not prove read-only JSON-safe execution.')
  }

  const targetByKey = new Map(targets.writeTargets.map((row) => [tableKey(row), row]))
  const tableByKey = new Map(tables.map((row) => [tableKey(row), row]))
  const columnsByKey = new Map()
  for (const row of columns) {
    const key = tableKey(row)
    if (!columnsByKey.has(key)) columnsByKey.set(key, [])
    columnsByKey.get(key).push(row)
  }

  const blockers = []
  const warnings = []
  for (const [key, target] of targetByKey) {
    const table = tableByKey.get(key)
    if (!table) {
      blockers.push(`missing_target_table:${key}`)
      continue
    }
    if (!['r', 'p'].includes(table.relationKind)) blockers.push(`unsupported_relation_kind:${key}:${table.relationKind}`)
    if (table.rowLevelSecurityEnabled === true || table.rowLevelSecurityForced === true) {
      blockers.push(`row_level_security_enabled:${key}`)
    }

    const available = new Set((columnsByKey.get(key) || []).map((row) => row.columnName))
    for (const column of target.plannedColumns || []) {
      if (!available.has(column)) blockers.push(`missing_planned_column:${key}.${column}`)
    }

    const tableConstraints = constraints.filter((row) => tableKey(row) === key)
    const hasPrimaryKey = tableConstraints.some((row) => row.constraintType === 'p')
    if (!hasPrimaryKey) warnings.push(`no_primary_key:${key}`)
  }

  const enabledUserTriggers = triggers.filter((row) => row.isInternal !== true && row.enabled !== 'D')
  for (const row of enabledUserTriggers) warnings.push(`enabled_user_trigger:${tableKey(row)}:${row.triggerName}`)
  for (const row of policies) warnings.push(`row_policy_present:${tableKey(row)}:${row.policyName}`)

  const uniqueDefinitions = [
    ...constraints.filter((row) => ['p', 'u', 'x'].includes(row.constraintType)).map((row) => ({
      table: tableKey(row),
      name: row.constraintName,
      kind: `constraint:${row.constraintType}`,
      definition: row.definition,
    })),
    ...indexes.filter((row) => row.isUnique === true).map((row) => ({
      table: tableKey(row),
      name: row.indexName,
      kind: 'unique_index',
      definition: row.definition,
    })),
  ]

  const targetDetails = targets.writeTargets.map((target) => {
    const key = tableKey(target)
    const tableColumns = columnsByKey.get(key) || []
    const tableConstraints = constraints.filter((row) => tableKey(row) === key)
    const tableIndexes = indexes.filter((row) => tableKey(row) === key)
    const tableTriggers = triggers.filter((row) => tableKey(row) === key)
    const tablePolicies = policies.filter((row) => tableKey(row) === key)
    return {
      ...target,
      relationKind: tableByKey.get(key)?.relationKind ?? null,
      columnCount: tableColumns.length,
      primaryKeyCount: tableConstraints.filter((row) => row.constraintType === 'p').length,
      uniqueConstraintCount: tableConstraints.filter((row) => row.constraintType === 'u').length,
      uniqueIndexCount: tableIndexes.filter((row) => row.isUnique === true).length,
      foreignKeyCount: tableConstraints.filter((row) => row.constraintType === 'f').length,
      checkConstraintCount: tableConstraints.filter((row) => row.constraintType === 'c').length,
      enabledUserTriggerCount: tableTriggers.filter((row) => row.isInternal !== true && row.enabled !== 'D').length,
      policyCount: tablePolicies.length,
      enumColumns: tableColumns.filter((row) => row.typeKind === 'e').map((row) => row.columnName),
    }
  })

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    writeTargetTables: targets.writeTargets.length,
    auditedTables: tables.length,
    auditedColumns: columns.length,
    auditedConstraints: constraints.length,
    auditedIndexes: indexes.length,
    auditedTriggers: triggers.length,
    auditedPolicies: policies.length,
    auditedEnumLabels: enums.length,
    auditedSequences: sequences.length,
    uniqueDefinitions: uniqueDefinitions.length,
    enabledUserTriggers: enabledUserTriggers.length,
    blockers,
    warnings,
    readyForTransactionSqlPlanning: blockers.length === 0,
    requiresManualTriggerReview: enabledUserTriggers.length > 0,
    localBackup: targets.localBackup,
    targetDetails,
    safety: {
      postgresReadOnly: true,
      databaseWrite: false,
      payloadWrite: false,
      migrationGeneration: false,
      schemaPush: false,
      executableTransactionSqlGenerated: false,
      mergePerformed: false,
      backupFileModified: false,
    },
  }

  writeJson(path.join(directory, 'write-schema-audit-summary.json'), summary)
  writeJson(path.join(directory, 'unique-definitions.json'), uniqueDefinitions)

  const markdown = [
    '# Test Work merge write-schema audit',
    '',
    `- Write target tables: ${summary.writeTargetTables}`,
    `- Audited tables: ${summary.auditedTables}`,
    `- Audited columns: ${summary.auditedColumns}`,
    `- Constraints: ${summary.auditedConstraints}`,
    `- Indexes: ${summary.auditedIndexes}`,
    `- Enabled user triggers: ${summary.enabledUserTriggers}`,
    `- Row policies: ${summary.auditedPolicies}`,
    `- Enum labels: ${summary.auditedEnumLabels}`,
    `- Blockers: ${summary.blockers.length}`,
    `- Warnings: ${summary.warnings.length}`,
    `- Ready for transaction SQL planning: ${summary.readyForTransactionSqlPlanning}`,
    '',
    '## Target tables',
    '',
    ...targetDetails.map((row) => `- ${row.tableSchema}.${row.tableName}: actions=${row.plannedActions.join(', ') || 'none'}; columns=${row.columnCount}; PK=${row.primaryKeyCount}; unique=${row.uniqueConstraintCount + row.uniqueIndexCount}; FK=${row.foreignKeyCount}; checks=${row.checkConstraintCount}; userTriggers=${row.enabledUserTriggerCount}; policies=${row.policyCount}`),
    '',
    '## Blockers',
    '',
    ...(blockers.length ? blockers.map((row) => `- ${row}`) : ['- none']),
    '',
    '## Warnings',
    '',
    ...(warnings.length ? warnings.map((row) => `- ${row}`) : ['- none']),
    '',
    '## Safety',
    '',
    '- PostgreSQL read-only: true',
    '- Database write: false',
    '- Payload write: false',
    '- Executable transaction SQL generated: false',
    '- Merge performed: false',
    '- Local backup modified: false',
  ].join('\n')
  writeText(path.join(directory, 'write-schema-audit-summary.md'), markdown)

  const files = fs.readdirSync(directory)
    .filter((name) => name !== 'manifest.json')
    .sort()
  writeJson(path.join(directory, 'manifest.json'), files.map((name) => {
    const file = path.join(directory, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('Test Work write-schema audit summary complete')
  console.log(`WriteTargetTables: ${summary.writeTargetTables}`)
  console.log(`AuditedTables: ${summary.auditedTables}`)
  console.log(`Blockers: ${summary.blockers.length}`)
  console.log(`Warnings: ${summary.warnings.length}`)
  console.log(`ReadyForTransactionSqlPlanning: ${summary.readyForTransactionSqlPlanning ? 'True' : 'False'}`)
  console.log('DatabaseWrite: False')
  console.log('ExecutableTransactionSqlGenerated: False')
}

main()
