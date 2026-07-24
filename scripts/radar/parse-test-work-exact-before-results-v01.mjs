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

function writeJsonl(file, rows) {
  writeText(file, rows.map((row) => JSON.stringify(row)).join('\n'))
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function extractExpectedCheckNames(sql) {
  const names = []
  const pattern = /SELECT\s+'((?:''|[^'])+)'\s+AS\s+check_name/giu
  let match
  while ((match = pattern.exec(sql)) !== null) {
    names.push(match[1].replaceAll("''", "'"))
  }
  return names
}

function parseBoolean(value) {
  const normalized = text(value).toLowerCase()
  if (normalized === 't' || normalized === 'true') return true
  if (normalized === 'f' || normalized === 'false') return false
  throw new Error(`Invalid PostgreSQL boolean: ${value}`)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  for (const key of ['sql', 'expectations', 'stdout', 'stderr', 'output-dir']) {
    if (!text(args[key])) throw new Error(`Required: --${key}`)
  }

  const sqlPath = path.resolve(args.sql)
  const expectationsPath = path.resolve(args.expectations)
  const stdoutPath = path.resolve(args.stdout)
  const stderrPath = path.resolve(args.stderr)
  const outputDir = path.resolve(args['output-dir'])
  fs.mkdirSync(outputDir, { recursive: true })

  const sql = readText(sqlPath)
  const expectations = readJson(expectationsPath)
  const stdout = readText(stdoutPath)
  const stderr = readText(stderrPath)

  if (!/^BEGIN TRANSACTION READ ONLY;/u.test(sql.trimStart())) {
    throw new Error('Exact-before SQL is not protected by a read-only transaction.')
  }
  if (!/ROLLBACK;\s*$/u.test(sql)) {
    throw new Error('Exact-before SQL does not end with ROLLBACK.')
  }
  if (/^\s*(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/imu.test(sql)) {
    throw new Error('Exact-before SQL contains an executable write or DDL statement.')
  }

  const expectedNames = extractExpectedCheckNames(sql)
  const expectedTotal = Number(expectations.exactRowChecks)
    + Number(expectations.relationCountChecks)
    + Number(expectations.versionRelationCountChecks)
  if (expectedNames.length !== expectedTotal) {
    throw new Error(`SQL check count mismatch: ${expectedNames.length} / ${expectedTotal}`)
  }
  if (new Set(expectedNames).size !== expectedNames.length) {
    throw new Error('Exact-before SQL contains duplicate check names.')
  }

  const rows = stdout
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line, index) => {
      const columns = line.split('\t')
      if (columns.length !== 4) {
        throw new Error(`Invalid exact-before TSV at line ${index + 1}: expected 4 columns, got ${columns.length}`)
      }
      const expectedCount = Number(columns[1])
      const actualCount = Number(columns[2])
      if (!Number.isSafeInteger(expectedCount) || !Number.isSafeInteger(actualCount)) {
        throw new Error(`Invalid exact-before count at line ${index + 1}`)
      }
      return {
        checkName: columns[0],
        expectedCount,
        actualCount,
        matches: parseBoolean(columns[3]),
        countMatches: expectedCount === actualCount,
      }
    })

  const actualNames = rows.map((row) => row.checkName)
  const missingChecks = expectedNames.filter((name) => !actualNames.includes(name))
  const unexpectedChecks = actualNames.filter((name) => !expectedNames.includes(name))
  const duplicateActualChecks = actualNames.filter((name, index) => actualNames.indexOf(name) !== index)
  const failedRows = rows.filter((row) => !row.matches || !row.countMatches)
  const stderrMeaningful = stderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)

  const exactRows = rows.filter((row) => row.checkName.startsWith('exact_rows:'))
  const relationCounts = rows.filter((row) => row.checkName.startsWith('relation_count:'))
  const versionRelationCounts = rows.filter((row) => row.checkName.startsWith('version_relation_count:'))

  const allMatched = rows.length === expectedTotal
    && missingChecks.length === 0
    && unexpectedChecks.length === 0
    && duplicateActualChecks.length === 0
    && failedRows.length === 0
    && exactRows.length === Number(expectations.exactRowChecks)
    && relationCounts.length === Number(expectations.relationCountChecks)
    && versionRelationCounts.length === Number(expectations.versionRelationCountChecks)

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceSqlSha256: sha256File(sqlPath),
    sourceExpectationsSha256: sha256File(expectationsPath),
    expectedChecks: expectedTotal,
    observedChecks: rows.length,
    matchedChecks: rows.filter((row) => row.matches && row.countMatches).length,
    failedChecks: failedRows.length,
    exactRowChecks: exactRows.length,
    relationCountChecks: relationCounts.length,
    versionRelationCountChecks: versionRelationCounts.length,
    missingChecks,
    unexpectedChecks,
    duplicateActualChecks: [...new Set(duplicateActualChecks)],
    stderrLineCount: stderrMeaningful.length,
    allChecksMatched: allMatched,
    safety: {
      databaseWrite: false,
      payloadWrite: false,
      migrationGeneration: false,
      schemaPush: false,
      mergePerformed: false,
      exactBeforeOnly: true,
      readOnlyTransactionRequired: true,
      allChecksMustMatchBeforeBackup: true,
    },
  }

  writeJsonl(path.join(outputDir, 'exact-before-results.jsonl'), rows)
  writeJson(path.join(outputDir, 'exact-before-run-summary.json'), summary)
  writeText(path.join(outputDir, 'exact-before-stdout.tsv'), stdout)
  writeText(path.join(outputDir, 'exact-before-stderr.txt'), stderr)

  const markdown = [
    '# Test Work exact-before result',
    '',
    `- Expected checks: ${summary.expectedChecks}`,
    `- Observed checks: ${summary.observedChecks}`,
    `- Matched checks: ${summary.matchedChecks}`,
    `- Failed checks: ${summary.failedChecks}`,
    `- Exact row checks: ${summary.exactRowChecks}`,
    `- Work relation count checks: ${summary.relationCountChecks}`,
    `- Version relation count checks: ${summary.versionRelationCountChecks}`,
    `- All checks matched: ${summary.allChecksMatched}`,
    `- PostgreSQL stderr non-empty lines: ${summary.stderrLineCount}`,
    '',
    '## Safety',
    '',
    '- Read-only transaction required: true',
    '- Database write: false',
    '- Payload write: false',
    '- Merge performed: false',
    '- Backup allowed only when every check matched: true',
    '',
    ...(failedRows.length ? [
      '## Failed checks',
      '',
      ...failedRows.map((row) => `- ${row.checkName}: expected=${row.expectedCount}, actual=${row.actualCount}, matches=${row.matches}`),
    ] : []),
  ].join('\n')
  writeText(path.join(outputDir, 'exact-before-run-summary.md'), markdown)

  const files = fs.readdirSync(outputDir).filter((name) => name !== 'manifest.json').sort()
  writeJson(path.join(outputDir, 'manifest.json'), files.map((name) => {
    const file = path.join(outputDir, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('Test Work exact-before result parsing complete')
  console.log(`ExpectedChecks: ${summary.expectedChecks}`)
  console.log(`ObservedChecks: ${summary.observedChecks}`)
  console.log(`MatchedChecks: ${summary.matchedChecks}`)
  console.log(`FailedChecks: ${summary.failedChecks}`)
  console.log(`AllChecksMatched: ${summary.allChecksMatched ? 'True' : 'False'}`)
  console.log('DatabaseWrite: False')
  console.log('MergePerformed: False')

  if (!summary.allChecksMatched) process.exitCode = 2
}

main()
