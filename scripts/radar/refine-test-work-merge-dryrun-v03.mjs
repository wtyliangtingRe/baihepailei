#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      i += 1
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

function writeJsonl(file, rows) {
  writeText(file, rows.map((row) => JSON.stringify(row)).join('\n'))
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function verifyManifest(directory) {
  const manifest = readJson(path.join(directory, 'manifest.json'))
  for (const entry of manifest) {
    const file = path.join(directory, entry.file)
    if (!fs.existsSync(file)) throw new Error(`Manifest file missing: ${entry.file}`)
    if (fs.statSync(file).size !== Number(entry.bytes)) {
      throw new Error(`Manifest byte mismatch: ${entry.file}`)
    }
    if (sha256File(file) !== String(entry.sha256).toLowerCase()) {
      throw new Error(`Manifest SHA-256 mismatch: ${entry.file}`)
    }
  }
}

function copyDirectoryFiles(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const name of fs.readdirSync(source)) {
    const from = path.join(source, name)
    if (!fs.statSync(from).isFile() || name === 'manifest.json') continue
    fs.copyFileSync(from, path.join(target, name))
  }
}

function identifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function sqlScalar(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return sqlString(value)
}

function jsonbLiteral(value) {
  return `${sqlString(JSON.stringify(value))}::jsonb`
}

function parentId(entry) {
  return entry?.row?.[entry.columnName]
}

function rowKey(tableName, id) {
  return `${tableName}\u0000${String(id)}`
}

function cleanedSearchLines(value) {
  const blockedPrefixes = [
    'mergedintoworkid:',
    'mergedintoworktitle:',
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
  const result = []
  for (const line of groups.flat()) {
    const key = line.normalize('NFKC').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(line)
  }
  return result
}

function expectedRowsCheck({ checkName, tableSchema = 'public', tableName, rows }) {
  if (!rows.length) return null
  const values = rows.map((row) => `    (${jsonbLiteral(row)})`).join(',\n')
  const ids = rows.map((row) => row.id)
  return `WITH expected(row_json) AS (\n  VALUES\n${values}\n), actual AS (\n  SELECT to_jsonb(t) AS row_json\n  FROM ${identifier(tableSchema)}.${identifier(tableName)} t\n  WHERE t.${identifier('id')} IN (${ids.map(sqlScalar).join(', ')})\n)\nSELECT ${sqlString(checkName)} AS check_name,\n       (SELECT count(*) FROM expected) AS expected_count,\n       (SELECT count(*) FROM actual) AS actual_count,\n       COALESCE((SELECT jsonb_agg(row_json ORDER BY row_json::text) FROM expected), '[]'::jsonb)\n         = COALESCE((SELECT jsonb_agg(row_json ORDER BY row_json::text) FROM actual), '[]'::jsonb) AS matches;`
}

function relationCountCheck({ tableSchema, tableName, columnName, ids, expectedCount, checkName }) {
  if (!ids.length) return null
  return `SELECT ${sqlString(checkName)} AS check_name,\n       ${expectedCount}::bigint AS expected_count,\n       count(*)::bigint AS actual_count,\n       count(*) = ${expectedCount} AS matches\nFROM ${identifier(tableSchema)}.${identifier(tableName)}\nWHERE ${identifier(columnName)} IN (${ids.map(sqlScalar).join(', ')});`
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const identityDir = path.resolve(String(args['identity-audit-dir'] || ''))
  const dryRunDir = path.resolve(String(args['dryrun-v02-dir'] || ''))
  const outputDir = path.resolve(String(args['output-dir'] || ''))
  if (!args['identity-audit-dir'] || !args['dryrun-v02-dir'] || !args['output-dir']) {
    throw new Error('Required: --identity-audit-dir, --dryrun-v02-dir and --output-dir')
  }

  verifyManifest(identityDir)
  verifyManifest(dryRunDir)
  copyDirectoryFiles(dryRunDir, outputDir)

  const decisions = readJson(path.join(outputDir, 'canonical-merge-decisions.json'))
  const workRows = readJsonl(path.join(identityDir, 'work-rows.jsonl'))
  const relatedRows = readJsonl(path.join(identityDir, 'related-rows.jsonl'))
  const relationLocators = readJson(path.join(identityDir, 'relation-locators.json'))
  const versionRows = readJsonl(path.join(identityDir, 'version-related-rows.jsonl'))
  const versionLocators = readJson(path.join(identityDir, 'version-relation-locators.json'))
  const relationPlan = readJsonl(path.join(outputDir, 'relation-merge-plan.jsonl'))
  const feedbackPlan = readJsonl(path.join(outputDir, 'feedback-test-cleanup-plan.jsonl'))
  const worksById = new Map(workRows.map((row) => [Number(row.id), row]))

  const standardizationPlan = []
  for (const decision of decisions) {
    const canonical = worksById.get(Number(decision.canonicalWorkId))
    const mergeOut = worksById.get(Number(decision.mergeOutWorkId))
    if (!canonical || !mergeOut) throw new Error(`Missing Work row for ${decision.alertId}`)

    const canonicalNames = new Set([
      canonical.title,
      canonical.original_title,
      ...relatedRows
        .filter((entry) => Number(parentId(entry)) === Number(decision.canonicalWorkId))
        .filter((entry) => entry.tableName === 'works_aliases' || entry.tableName === 'works_localized_titles')
        .flatMap((entry) => [entry.row?.value, entry.row?.title]),
    ].filter(Boolean).map((value) => String(value).normalize('NFKC').toLowerCase()))

    if (mergeOut.title
      && String(mergeOut.title).normalize('NFKC').toLowerCase() !== String(canonical.title).normalize('NFKC').toLowerCase()
      && !canonicalNames.has(String(mergeOut.title).normalize('NFKC').toLowerCase())) {
      standardizationPlan.push({
        alertId: decision.alertId,
        workId: decision.canonicalWorkId,
        action: 'add_merge_out_title_as_canonical_alias',
        value: mergeOut.title,
        sourceWorkId: decision.mergeOutWorkId,
        executable: false,
      })
    }

    const beforeLines = cleanedSearchLines(canonical.search_text)
    const sourceLines = cleanedSearchLines(mergeOut.search_text)
    const afterLines = uniqueLines(beforeLines, sourceLines)
    if (afterLines.join('\n') !== beforeLines.join('\n')) {
      standardizationPlan.push({
        alertId: decision.alertId,
        workId: decision.canonicalWorkId,
        action: 'merge_clean_search_text_lines',
        before: canonical.search_text || '',
        after: afterLines.join('\n'),
        sourceWorkId: decision.mergeOutWorkId,
        removedOperationalPrefixes: [
          'mergedIntoWorkId',
          'mergedIntoWorkTitle',
          'duplicateMergeSourceKey',
          'duplicateMergeMediumKey',
        ],
        executable: false,
      })
    }
  }
  writeJsonl(path.join(outputDir, 'work-standardization-plan.jsonl'), standardizationPlan)

  const relatedByKey = new Map()
  for (const entry of relatedRows) {
    const id = entry?.row?.id
    if (id === null || id === undefined) continue
    relatedByKey.set(rowKey(entry.tableName, id), entry)
  }

  const exactRelationRowsByTable = new Map()
  for (const plan of [...relationPlan, ...feedbackPlan]) {
    if (plan.rowId === null || plan.rowId === undefined) continue
    const entry = relatedByKey.get(rowKey(plan.tableName, plan.rowId))
    if (!entry) throw new Error(`Missing audited row for ${plan.tableName}:${plan.rowId}`)
    const groupKey = `${entry.tableSchema || 'public'}\u0000${entry.tableName}`
    if (!exactRelationRowsByTable.has(groupKey)) {
      exactRelationRowsByTable.set(groupKey, {
        tableSchema: entry.tableSchema || 'public',
        tableName: entry.tableName,
        rows: [],
      })
    }
    const rows = exactRelationRowsByTable.get(groupKey).rows
    if (!rows.some((row) => String(row.id) === String(entry.row.id))) rows.push(entry.row)
  }

  const targetIds = decisions.flatMap((decision) => [
    Number(decision.canonicalWorkId),
    Number(decision.mergeOutWorkId),
  ])
  const exactChecks = []
  exactChecks.push(expectedRowsCheck({
    checkName: 'exact_rows:public.works',
    tableName: 'works',
    rows: targetIds.map((id) => worksById.get(id)),
  }))
  for (const group of [...exactRelationRowsByTable.values()].sort((a, b) => a.tableName.localeCompare(b.tableName))) {
    exactChecks.push(expectedRowsCheck({
      checkName: `exact_rows:${group.tableSchema}.${group.tableName}`,
      tableSchema: group.tableSchema,
      tableName: group.tableName,
      rows: group.rows,
    }))
  }

  const countChecks = []
  for (const locator of relationLocators) {
    const expectedCount = relatedRows.filter((entry) =>
      entry.tableSchema === locator.tableSchema
      && entry.tableName === locator.tableName
      && entry.columnName === locator.columnName
      && targetIds.map(String).includes(String(parentId(entry))),
    ).length
    countChecks.push(relationCountCheck({
      ...locator,
      ids: targetIds,
      expectedCount,
      checkName: `relation_count:${locator.tableSchema}.${locator.tableName}.${locator.columnName}`,
    }))
  }

  const targetVersionIds = relatedRows
    .filter((entry) => entry.tableName === '_works_v' && targetIds.map(String).includes(String(parentId(entry))))
    .map((entry) => entry.row.id)
  for (const locator of versionLocators) {
    const expectedCount = versionRows.filter((entry) =>
      entry.tableSchema === locator.tableSchema
      && entry.tableName === locator.tableName
      && entry.columnName === locator.columnName
      && targetVersionIds.map(String).includes(String(parentId(entry))),
    ).length
    countChecks.push(relationCountCheck({
      ...locator,
      ids: targetVersionIds,
      expectedCount,
      checkName: `version_relation_count:${locator.tableSchema}.${locator.tableName}.${locator.columnName}`,
    }))
  }

  const sql = [
    'BEGIN TRANSACTION READ ONLY;',
    '',
    '-- Every result row must return matches = true before an execution package may be built.',
    '',
    ...exactChecks.filter(Boolean),
    ...countChecks.filter(Boolean),
    'ROLLBACK;',
  ].join('\n\n')
  writeText(path.join(outputDir, 'exact-before-readonly.sql'), sql)

  const expectations = {
    schemaVersion: 1,
    targetWorkIds: targetIds,
    exactRowChecks: exactChecks.filter(Boolean).length,
    relationCountChecks: relationLocators.length,
    versionRelationCountChecks: versionLocators.length,
    plannedRelationRowsVerifiedExactly: [...exactRelationRowsByTable.values()]
      .reduce((sum, group) => sum + group.rows.length, 0),
    targetVersionIds: targetVersionIds.length,
    allChecksMustReturnMatchesTrue: true,
    databaseWrite: false,
  }
  writeJson(path.join(outputDir, 'exact-before-expectations.json'), expectations)

  const summaryPath = path.join(outputDir, 'merge-dryrun-summary.json')
  const summary = readJson(summaryPath)
  summary.schemaVersion = 3
  summary.semanticRefinementVersion = 3
  summary.standardizationPlanRows = standardizationPlan.length
  summary.exactBeforeExactRowChecks = expectations.exactRowChecks
  summary.exactBeforeRelationCountChecks = expectations.relationCountChecks
  summary.exactBeforeVersionRelationCountChecks = expectations.versionRelationCountChecks
  summary.exactBeforeAllChecksRequireTrue = true
  summary.searchTextOperationalNoiseFiltered = true
  summary.mergeOutTitleAliasProtected = true
  summary.safety = {
    ...summary.safety,
    databaseWrite: false,
    payloadWrite: false,
    executableUpdateSqlGenerated: false,
    canonicalDecisionApplied: false,
    mergePerformed: false,
    hardDeletePlanned: false,
    versionRewritePlanned: false,
  }
  writeJson(summaryPath, summary)

  const previewPath = path.join(outputDir, 'merge-preview-commented.sql')
  const preview = readText(previewPath).trimEnd()
  writeText(previewPath, `${preview}\n--\n-- V03 PLAN: preserve distinct merge-out titles as canonical aliases.\n-- V03 PLAN: merge cleaned search_text lines and remove operational merge markers.\n-- V03 GATE: every exact-before result must return matches=true before execution planning.`)

  const markdownPath = path.join(outputDir, 'merge-dryrun-summary.md')
  const markdown = readText(markdownPath).trimEnd()
  writeText(markdownPath, `${markdown}\n\n## v03 execution-preflight refinement\n\n- Merge-out title alias protected: true\n- Clean search text union planned: true\n- Operational merge markers excluded from search text: true\n- Exact Work and planned-row comparisons generated: ${expectations.exactRowChecks}\n- Relation count guards generated: ${expectations.relationCountChecks}\n- Version relation count guards generated: ${expectations.versionRelationCountChecks}\n- Every guard must return matches=true: true\n`)

  const files = fs.readdirSync(outputDir).filter((name) => name !== 'manifest.json').sort()
  writeJson(path.join(outputDir, 'manifest.json'), files.map((name) => {
    const file = path.join(outputDir, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('Test Work merge dry-run v03 refinement complete')
  console.log(`OutputDirectory: ${outputDir}`)
  console.log(`StandardizationPlanRows: ${standardizationPlan.length}`)
  console.log(`ExactRowChecks: ${expectations.exactRowChecks}`)
  console.log(`RelationCountChecks: ${expectations.relationCountChecks}`)
  console.log(`VersionRelationCountChecks: ${expectations.versionRelationCountChecks}`)
  console.log('AllChecksMustReturnMatchesTrue: True')
  console.log('DatabaseWrite: False')
  console.log('ExecutableUpdateSqlGenerated: False')
  console.log('MergePerformed: False')
}

main()
