#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const source = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-test-work-merge-transaction-review-v01.mjs')
if (!fs.existsSync(source)) throw new Error(`Missing v01 source: ${source}`)

let content = fs.readFileSync(source, 'utf8').replace(/^\uFEFF/u, '')

function replaceExact(needle, replacement, expected = 1) {
  const count = content.split(needle).length - 1
  if (count !== expected) throw new Error(`Expected ${expected} occurrence(s), found ${count}: ${needle.slice(0, 100)}`)
  content = content.split(needle).join(replacement)
}

replaceExact(
  '`${label}:count_mismatch`)}, actual_count; END IF;`,',
  '`${label}:count_mismatch actual_count=%`)}, actual_count; END IF;`,',
)
replaceExact(
  '`${label}:update_count`)}, affected; END IF;`,',
  '`${label}:update_count affected=%`)}, affected; END IF;`,',
)
replaceExact(
  '`${label}:delete_count`)}, affected; END IF;`,',
  '`${label}:delete_count affected=%`)}, affected; END IF;`,',
)
replaceExact(
  '`${label}:insert_count`)}, affected; END IF;`,',
  '`${label}:insert_count affected=%`)}, affected; END IF;`,',
)

replaceExact(
  `  const movedRows = []
  const deletedRows = []
  const skippedRows = []`,
  `  const movedRows = []
  const deletedRows = []
  const skippedRows = []
  const preservedRows = []`,
)
replaceExact(
  `    if (plan.action === 'preserve_version_parent_in_place') continue`,
  `    if (plan.action === 'preserve_version_parent_in_place') {
      const entry = relatedByKey.get(rowKey(plan.tableName, plan.rowId))
      if (!entry) throw new Error(\`Missing preserved relation row: \${plan.tableName}:\${plan.rowId}\`)
      preservedRows.push({ ...plan, baselineRow: entry.row })
      continue
    }`,
)
replaceExact(
  `  const targetVersionIds = relatedRows
    .filter((entry) => entry.tableName === '_works_v' && targetIds.map(String).includes(String(parentId(entry))))
    .map((entry) => entry.row.id)`,
  `  const targetVersionEntries = relatedRows
    .filter((entry) => entry.tableName === '_works_v' && targetIds.map(String).includes(String(parentId(entry))))
  const targetVersionIds = targetVersionEntries.map((entry) => entry.row.id)
  const versionPreservationExactRows = [
    ...targetVersionEntries.map((entry) => ({
      tableSchema: entry.tableSchema || 'public',
      tableName: entry.tableName,
      row: entry.row,
    })),
    ...versionRows
      .filter((entry) => targetVersionIds.map(String).includes(String(parentId(entry))))
      .map((entry) => ({
        tableSchema: entry.tableSchema || 'public',
        tableName: entry.tableName,
        row: entry.row,
      })),
  ].filter((entry) => entry.row?.id !== null && entry.row?.id !== undefined)`,
)
replaceExact(
  `    ...deletedRows.map((row) => ({ tableSchema: row.tableSchema, tableName: row.tableName, row: row.beforeRow })),
    ...feedbackRows.map((row) => ({ tableSchema: row.tableSchema, tableName: row.tableName, row: row.beforeRow })),`,
  `    ...deletedRows.map((row) => ({ tableSchema: row.tableSchema, tableName: row.tableName, row: row.beforeRow })),
    ...feedbackRows.map((row) => ({ tableSchema: row.tableSchema, tableName: row.tableName, row: row.beforeRow })),
    ...skippedRows.map((row) => ({ tableSchema: row.tableSchema, tableName: row.tableName, row: row.baselineRow })),
    ...versionPreservationExactRows,`,
)
replaceExact(
  `    ...feedbackRows.map((row) => plpgsqlExactRowCheck({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      row: row.afterRow,
      label: \`acceptance:\${row.tableSchema}.\${row.tableName}:\${row.rowId}\`,
      ignoredKeys: ['updated_at'],
    })),
    ...afterRelationCounts.map((row) => plpgsqlRelationCountCheck({`,
  `    ...feedbackRows.map((row) => plpgsqlExactRowCheck({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      row: row.afterRow,
      label: \`acceptance:\${row.tableSchema}.\${row.tableName}:\${row.rowId}\`,
      ignoredKeys: ['updated_at'],
    })),
    ...skippedRows.map((row) => plpgsqlExactRowCheck({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      row: row.baselineRow,
      label: \`acceptance_unchanged:\${row.tableSchema}.\${row.tableName}:\${row.rowId}\`,
    })),
    ...versionPreservationExactRows.map((row) => plpgsqlExactRowCheck({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      row: row.row,
      label: \`acceptance_version_preserved:\${row.tableSchema}.\${row.tableName}:\${row.row.id}\`,
    })),
    ...afterRelationCounts.map((row) => plpgsqlRelationCountCheck({`,
)
replaceExact(
  `    ...feedbackRows.map((row) => plpgsqlExactRowCheck({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      row: row.afterRow,
      label: \`rollback_guard:\${row.tableSchema}.\${row.tableName}:\${row.rowId}\`,
      lock: true,
      ignoredKeys: ['updated_at'],
    })),
    ...afterRelationCounts.map((row) => plpgsqlRelationCountCheck({`,
  `    ...feedbackRows.map((row) => plpgsqlExactRowCheck({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      row: row.afterRow,
      label: \`rollback_guard:\${row.tableSchema}.\${row.tableName}:\${row.rowId}\`,
      lock: true,
      ignoredKeys: ['updated_at'],
    })),
    ...skippedRows.map((row) => plpgsqlExactRowCheck({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      row: row.baselineRow,
      label: \`rollback_guard_unchanged:\${row.tableSchema}.\${row.tableName}:\${row.rowId}\`,
      lock: true,
    })),
    ...versionPreservationExactRows.map((row) => plpgsqlExactRowCheck({
      tableSchema: row.tableSchema,
      tableName: row.tableName,
      row: row.row,
      label: \`rollback_guard_version_preserved:\${row.tableSchema}.\${row.tableName}:\${row.row.id}\`,
      lock: true,
    })),
    ...afterRelationCounts.map((row) => plpgsqlRelationCountCheck({`,
)
replaceExact(
  `    semanticDuplicateSkips: skippedRows,
    versionPolicy: versionPlan,`,
  `    semanticDuplicateSkips: skippedRows,
    preservedRelationRows: preservedRows,
    versionPreservationExactRows,
    versionPolicy: versionPlan,`,
)
replaceExact(
  `      semanticDuplicateSkips: skippedRows.length,
      versionGroupsPreserved: versionPlan.length,`,
  `      semanticDuplicateSkips: skippedRows.length,
      preservedRelationRows: preservedRows.length,
      versionRowsGuardedExactly: versionPreservationExactRows.length,
      versionGroupsPreserved: versionPlan.length,`,
)
replaceExact(
  "    `- Semantic duplicate skips: ${review.operationCounts.semanticDuplicateSkips}`,\n    `- Versions preserved in place: ${review.operationCounts.versionGroupsPreserved}`,",
  "    `- Semantic duplicate skips: ${review.operationCounts.semanticDuplicateSkips}`,\n    `- Preserved relation rows represented by the plan: ${review.operationCounts.preservedRelationRows}`,\n    `- Version and version-child rows guarded exactly: ${review.operationCounts.versionRowsGuardedExactly}`,\n    `- Versions preserved in place: ${review.operationCounts.versionGroupsPreserved}`,",
)
replaceExact(
  "  console.log(`FeedbackArchives: ${review.operationCounts.feedbackArchives}`)\n  console.log(`StandardizationRefinements: ${review.operationCounts.standardizationRefinements}`)",
  "  console.log(`FeedbackArchives: ${review.operationCounts.feedbackArchives}`)\n  console.log(`PreservedRelationRows: ${review.operationCounts.preservedRelationRows}`)\n  console.log(`VersionRowsGuardedExactly: ${review.operationCounts.versionRowsGuardedExactly}`)\n  console.log(`StandardizationRefinements: ${review.operationCounts.standardizationRefinements}`)",
)

const temporary = path.join(os.tmpdir(), `build-test-work-merge-transaction-review-v02-${crypto.randomUUID()}.mjs`)
fs.writeFileSync(temporary, content, 'utf8')
try {
  const check = spawnSync(process.execPath, ['--check', temporary], { encoding: 'utf8' })
  if (check.status !== 0) throw new Error(check.stderr || check.stdout || 'Patched transaction source syntax check failed.')

  const result = spawnSync(process.execPath, [temporary, ...process.argv.slice(2)], {
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exitCode = result.status || 1
} finally {
  fs.rmSync(temporary, { force: true })
}
