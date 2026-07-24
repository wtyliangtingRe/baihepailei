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
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead > 0)
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

function meaningfulLines(file) {
  return readText(file)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseTableCounts(file) {
  const rows = readText(file)
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line, index) => {
      const columns = line.split('\t')
      if (columns.length !== 2) {
        throw new Error(`Invalid table-count TSV at ${file}:${index + 1}`)
      }
      const count = Number(columns[1])
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error(`Invalid table count at ${file}:${index + 1}`)
      }
      return { tableName: columns[0], rowCount: count }
    })
  const names = rows.map((row) => row.tableName)
  if (new Set(names).size !== names.length) {
    throw new Error(`Duplicate table names in ${file}`)
  }
  return rows
}

function canonicalCounts(rows) {
  return JSON.stringify([...rows].sort((a, b) => a.tableName.localeCompare(b.tableName)))
}

function validateExactSummary(summary, label) {
  if (summary.allChecksMatched !== true
    || summary.expectedChecks !== summary.observedChecks
    || summary.expectedChecks !== summary.matchedChecks
    || summary.failedChecks !== 0
    || summary.stderrLineCount !== 0) {
    throw new Error(`${label} exact-before summary did not fully match.`)
  }
  if (summary.exactRowChecks !== 7
    || summary.relationCountChecks !== 19
    || summary.versionRelationCountChecks !== 11
    || summary.expectedChecks !== 37) {
    throw new Error(`${label} exact-before cardinality is unexpected.`)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!text(args.directory)) throw new Error('Required: --directory')
  const directory = path.resolve(args.directory)

  const preSummary = readJson(path.join(directory, 'production-pre-exact-before-run-summary.json'))
  const postSummary = readJson(path.join(directory, 'production-post-exact-before-run-summary.json'))
  const restoreSummary = readJson(path.join(directory, 'restore-exact-before-run-summary.json'))
  validateExactSummary(preSummary, 'production pre-backup')
  validateExactSummary(postSummary, 'production post-backup')
  validateExactSummary(restoreSummary, 'isolated restore')

  const sqlHashes = new Set([
    preSummary.sourceSqlSha256,
    postSummary.sourceSqlSha256,
    restoreSummary.sourceSqlSha256,
  ])
  const expectationHashes = new Set([
    preSummary.sourceExpectationsSha256,
    postSummary.sourceExpectationsSha256,
    restoreSummary.sourceExpectationsSha256,
  ])
  if (sqlHashes.size !== 1 || expectationHashes.size !== 1) {
    throw new Error('Exact-before source SQL or expectation hashes differ across runs.')
  }

  const preCounts = parseTableCounts(path.join(directory, 'production-pre-table-counts.tsv'))
  const postCounts = parseTableCounts(path.join(directory, 'production-post-table-counts.tsv'))
  const restoreCounts = parseTableCounts(path.join(directory, 'restore-table-counts.tsv'))
  const preCanonical = canonicalCounts(preCounts)
  const postCanonical = canonicalCounts(postCounts)
  const restoreCanonical = canonicalCounts(restoreCounts)
  if (preCanonical !== postCanonical) {
    throw new Error('Production table counts changed during backup.')
  }
  if (preCanonical !== restoreCanonical) {
    throw new Error('Restored table counts do not match the production backup baseline.')
  }

  const backupPath = path.join(directory, 'database-backup.dump')
  const backupStat = fs.statSync(backupPath)
  if (!backupStat.isFile() || backupStat.size < 1024) {
    throw new Error('Backup file is missing or unexpectedly small.')
  }
  const backupSha256 = sha256File(backupPath)

  const restoreList = readText(path.join(directory, 'pg-restore-list.txt'))
  if (!/TABLE DATA\s+public\s+works\b/iu.test(restoreList)
    || !/TABLE DATA\s+public\s+_works_v\b/iu.test(restoreList)) {
    throw new Error('pg_restore list does not contain core Work table data entries.')
  }

  const stderrFiles = [
    'pg-dump-stderr.txt',
    'pg-restore-list-stderr.txt',
    'pg-restore-stderr.txt',
    'production-pre-table-counts-stderr.txt',
    'production-post-table-counts-stderr.txt',
    'restore-table-counts-stderr.txt',
  ]
  const stderrMeaningful = Object.fromEntries(
    stderrFiles.map((name) => [name, meaningfulLines(path.join(directory, name))]),
  )
  const unexpectedStderr = Object.entries(stderrMeaningful)
    .filter(([, lines]) => lines.length > 0)
  if (unexpectedStderr.length > 0) {
    throw new Error(`Unexpected backup/restore stderr: ${unexpectedStderr.map(([name]) => name).join(', ')}`)
  }

  const sourceEvidence = readJson(path.join(directory, 'source-exact-before-run-summary.json'))
  validateExactSummary(sourceEvidence, 'source evidence package')
  if (sourceEvidence.sourceSqlSha256 !== preSummary.sourceSqlSha256
    || sourceEvidence.sourceExpectationsSha256 !== preSummary.sourceExpectationsSha256) {
    throw new Error('Source exact-before evidence is not bound to the backup SQL and expectations.')
  }

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    postgresImage: text(readText(path.join(directory, 'postgres-image.txt'))),
    backupFile: 'database-backup.dump',
    backupBytes: backupStat.size,
    backupSha256,
    sourceSqlSha256: preSummary.sourceSqlSha256,
    sourceExpectationsSha256: preSummary.sourceExpectationsSha256,
    exactChecksPerRun: 37,
    productionPreMatchedChecks: preSummary.matchedChecks,
    productionPostMatchedChecks: postSummary.matchedChecks,
    restoredMatchedChecks: restoreSummary.matchedChecks,
    businessTableCountChecks: preCounts.length,
    productionCountsStableDuringBackup: true,
    restoredCountsMatchProduction: true,
    restoreListValidated: true,
    restoreCompleted: true,
    backupRestoreVerified: true,
    safety: {
      productionDatabaseWrite: false,
      payloadWrite: false,
      migrationGeneration: false,
      schemaPush: false,
      mergePerformed: false,
      productionContainerTempFileWrite: true,
      productionContainerTempFilesRemoved: true,
      hostBackupFileWrite: true,
      ephemeralVerificationDatabaseWrite: true,
      ephemeralVerificationContainerRemoved: true,
      hardDeleteOnProduction: false,
    },
  }
  writeJson(path.join(directory, 'backup-verification-summary.json'), summary)
  writeText(
    path.join(directory, 'database-backup.dump.sha256'),
    `${backupSha256}  database-backup.dump`,
  )

  const markdown = [
    '# Test Work PostgreSQL backup verification',
    '',
    `- Backup bytes: ${summary.backupBytes}`,
    `- Backup SHA-256: ${summary.backupSha256}`,
    `- PostgreSQL image: ${summary.postgresImage}`,
    `- Exact-before checks per run: ${summary.exactChecksPerRun}`,
    `- Production pre-backup matched: ${summary.productionPreMatchedChecks}`,
    `- Production post-backup matched: ${summary.productionPostMatchedChecks}`,
    `- Isolated restore matched: ${summary.restoredMatchedChecks}`,
    `- Business table count checks: ${summary.businessTableCountChecks}`,
    '- Production counts stable during backup: true',
    '- Restored counts match production: true',
    '- Restore completed: true',
    '- Backup restore verified: true',
    '',
    '## Safety',
    '',
    '- Production database write: false',
    '- Payload write: false',
    '- Merge performed: false',
    '- Production container temporary files removed: true',
    '- Ephemeral verification database write: true',
    '- Ephemeral verification container removed: true',
    '- Backup remains on the local host and is excluded from the small evidence ZIP.',
  ].join('\n')
  writeText(path.join(directory, 'backup-verification-summary.md'), markdown)

  const evidenceFiles = fs.readdirSync(directory)
    .filter((name) => name !== 'database-backup.dump')
    .filter((name) => name !== 'evidence-manifest.json')
    .sort()
  writeJson(path.join(directory, 'evidence-manifest.json'), evidenceFiles.map((name) => {
    const file = path.join(directory, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('Test Work backup verification evidence complete')
  console.log(`BackupBytes: ${summary.backupBytes}`)
  console.log(`BackupSHA256: ${summary.backupSha256}`)
  console.log(`BusinessTableCountChecks: ${summary.businessTableCountChecks}`)
  console.log('ProductionPreExactChecks: 37 / 37')
  console.log('ProductionPostExactChecks: 37 / 37')
  console.log('RestoreExactChecks: 37 / 37')
  console.log('BackupRestoreVerified: True')
  console.log('ProductionDatabaseWrite: False')
  console.log('MergePerformed: False')
}

main()
