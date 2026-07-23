#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'radar-public-conclusions-schema-review-v0.1'
const EXPECTED_AUDIT_ZIP_SHA256 = '7877020d0314352531290be0d4e334d2b17e18e6f552591dd14e30431f7837ba'
const EXPECTED_READY_SHA256 = '95111c7a01fc5c56efd58a9ed03a2c446ec831d1b6fe3ce6822a9bdfafc1258f'
const EXPECTED_READY_ROWS = 9000
const EXPECTED_SOURCE_ROWS = 10805
const EXPECTED_WORKS = 35615

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; i += 1 }
  }
  return args
}

function required(args, key) {
  const value = String(args[key] || '').trim()
  if (!value) throw new Error(`Required: --${key}`)
  return value
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file))
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

function readJsonl(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
  if (!text.trim()) return []
  return text.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) }
    catch (error) { throw new Error(`Invalid JSONL at ${file}:${index + 1}: ${error.message}`) }
  })
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function normalizeHash(value) {
  return String(value || '').trim().toLowerCase()
}

function manifestMap(manifest) {
  return new Map((Array.isArray(manifest) ? manifest : []).map((entry) => [String(entry.file), entry]))
}

function extractMigrationSql(source, functionName) {
  const functionPattern = new RegExp(`export\\s+async\\s+function\\s+${functionName}\\b[\\s\\S]*?await\\s+db\\.execute\\(sql\\x60([\\s\\S]*?)\\x60\\)`, 'u')
  const match = source.match(functionPattern)
  if (!match) throw new Error(`Cannot extract ${functionName} SQL from generated migration.`)
  const sql = match[1].replace(/\r\n?/gu, '\n').trim() + '\n'
  if (sql.includes('${')) throw new Error(`${functionName} SQL contains interpolation and is not review-stable.`)
  return sql
}

function assertRadarOnlySql(sql, label) {
  const forbidden = [
    /(?:ALTER|DROP|TRUNCATE)\s+TABLE\s+(?:"public"\.)?"?(?:works|_works_v|payload_locked_documents_rels)"?/iu,
    /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?(?:"public"\.)?"?(?:works|_works_v)"?/iu,
    /human_assessment/iu,
    /legacy_x_wiki_page/iu,
  ]
  for (const pattern of forbidden) {
    if (pattern.test(sql)) throw new Error(`${label} SQL touches forbidden existing structures: ${pattern}`)
  }

  for (const match of sql.matchAll(/(?:CREATE|ALTER|DROP)\s+TABLE\s+(?:"public"\.)?"([^"]+)"/giu)) {
    if (!match[1].startsWith('radar_public')) {
      throw new Error(`${label} SQL touches non-Radar table: ${match[1]}`)
    }
  }
  for (const match of sql.matchAll(/(?:CREATE|ALTER|DROP)\s+TYPE\s+(?:"public"\.)?"([^"]+)"/giu)) {
    if (!match[1].startsWith('enum_radar_public')) {
      throw new Error(`${label} SQL touches non-Radar enum: ${match[1]}`)
    }
  }
}

function assertAudit(summary, manifest, readyPath, auditZipSha256) {
  const blockers = []
  if (normalizeHash(auditZipSha256) !== EXPECTED_AUDIT_ZIP_SHA256) blockers.push('audit_zip_sha256_mismatch')
  if (Number(summary?.source?.rows) !== EXPECTED_SOURCE_ROWS) blockers.push('source_rows_mismatch')
  if (Number(summary?.production?.worksRead) !== EXPECTED_WORKS) blockers.push('draft_works_mismatch')
  if (Number(summary?.production?.publishedWorksRead) !== EXPECTED_WORKS) blockers.push('live_works_mismatch')
  if (Number(summary?.production?.publishedSnapshotUniqueIds) !== EXPECTED_WORKS) blockers.push('live_unique_ids_mismatch')
  if (summary?.production?.publishedSnapshotIdSetMatchesDraft !== true) blockers.push('live_id_set_mismatch')
  if (summary?.production?.publicSchemaReady !== false) blockers.push('public_schema_not_absent')
  if (summary?.privateTrack?.readyToWrite !== 0) blockers.push('private_ready_not_zero')
  if (summary?.privateTrack?.alreadyCurrent !== 9361) blockers.push('private_current_mismatch')
  if (summary?.publicTrack?.readyToWrite !== EXPECTED_READY_ROWS) blockers.push('public_ready_mismatch')
  if (summary?.publicTrack?.alreadyCurrent !== 0) blockers.push('public_current_not_zero')
  if (summary?.publicTrack?.blocked !== 1805) blockers.push('public_blocked_mismatch')
  if (summary?.publicTrack?.schemaCreationRequired !== true) blockers.push('schema_creation_not_required')
  if (!Array.isArray(summary?.globalBlockers) || summary.globalBlockers.length !== 0) blockers.push('audit_global_blockers_present')
  if (summary?.readyForSingleExecutionPlanning !== true) blockers.push('audit_not_ready_for_execution_planning')
  if (summary?.safety?.payloadWrite !== false || summary?.safety?.directPostgresqlWrite !== false) blockers.push('audit_claims_write')

  const entry = manifestMap(manifest).get('public-ai-ready.jsonl')
  if (!entry) blockers.push('ready_manifest_entry_missing')
  else {
    if (Number(entry.bytes) !== fs.statSync(readyPath).size) blockers.push('ready_manifest_bytes_mismatch')
    if (normalizeHash(entry.sha256) !== EXPECTED_READY_SHA256) blockers.push('ready_manifest_sha_mismatch')
  }
  if (sha256File(readyPath) !== EXPECTED_READY_SHA256) blockers.push('ready_file_sha_mismatch')
  if (blockers.length) throw new Error(`Audit binding failed: ${blockers.join(', ')}`)
}

function validateReadyRows(rows) {
  if (rows.length !== EXPECTED_READY_ROWS) throw new Error(`Expected ${EXPECTED_READY_ROWS} public-ready rows, received ${rows.length}.`)
  const publicationKeys = new Set()
  const workIds = new Set()
  const conclusionHashes = new Set()
  const plan = []
  for (const [index, row] of rows.entries()) {
    const record = row?.publicRecord
    const key = String(record?.publicationKey || '')
    const work = String(record?.work || '')
    const workSnapshot = String(record?.workIdSnapshot || '')
    const conclusionSha256 = normalizeHash(record?.conclusionSha256)
    if (row?.publicStatus !== 'ready_public_ai_after_schema') throw new Error(`Row ${index + 1} has unexpected publicStatus.`)
    if ((row?.publicBlockers || []).length || (row?.blockers || []).length) throw new Error(`Row ${index + 1} contains blockers.`)
    if (!key || key !== `work:${work}` || work !== workSnapshot) throw new Error(`Row ${index + 1} has inconsistent publication identity.`)
    if (!/^[0-9a-f]{64}$/u.test(conclusionSha256)) throw new Error(`Row ${index + 1} has invalid conclusion SHA-256.`)
    if (publicationKeys.has(key)) throw new Error(`Duplicate publicationKey: ${key}`)
    if (workIds.has(work)) throw new Error(`Duplicate Work ID: ${work}`)
    if (conclusionHashes.has(conclusionSha256)) throw new Error(`Duplicate conclusion SHA-256: ${conclusionSha256}`)
    publicationKeys.add(key)
    workIds.add(work)
    conclusionHashes.add(conclusionSha256)
    plan.push({
      publicationKey: key,
      work,
      workIdSnapshot: workSnapshot,
      workSiteId: record.workSiteId,
      title: record.title,
      grade: record.compatibilityGrade,
      conclusionSha256,
      assessmentBatch: record?.radarAssessment?.assessmentBatch,
      assessedAt: record?.radarAssessment?.assessedAt,
      sourcePackageSha256: record.sourcePackageSha256,
    })
  }
  return plan
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const auditDir = path.resolve(required(args, 'audit-dir'))
  const auditZipSha256 = required(args, 'audit-zip-sha256')
  const baselineTs = path.resolve(required(args, 'baseline-ts'))
  const baselineSnapshot = path.resolve(required(args, 'baseline-snapshot'))
  const migrationTs = path.resolve(required(args, 'migration-ts'))
  const migrationSnapshot = path.resolve(required(args, 'migration-snapshot'))
  const beforeHead = required(args, 'before-head')
  const afterHead = required(args, 'after-head')
  const outDir = path.resolve(required(args, 'out-dir'))

  for (const file of [baselineTs, baselineSnapshot, migrationTs, migrationSnapshot]) {
    if (!fs.existsSync(file)) throw new Error(`Missing input file: ${file}`)
  }
  fs.mkdirSync(outDir, { recursive: true })

  const auditSummaryPath = path.join(auditDir, 'all-remaining-radar-global-audit-summary.json')
  const auditManifestPath = path.join(auditDir, 'manifest.json')
  const readyPath = path.join(auditDir, 'public-ai-ready.jsonl')
  const auditSummary = readJson(auditSummaryPath)
  const auditManifest = readJson(auditManifestPath)
  assertAudit(auditSummary, auditManifest, readyPath, auditZipSha256)
  const writePlan = validateReadyRows(readJsonl(readyPath))

  const baselineSource = fs.readFileSync(baselineTs, 'utf8')
  const baselineSnapshotSource = fs.readFileSync(baselineSnapshot, 'utf8')
  const migrationSource = fs.readFileSync(migrationTs, 'utf8')
  const migrationSnapshotSource = fs.readFileSync(migrationSnapshot, 'utf8')
  if (/db\.execute|CREATE TABLE|ALTER TABLE|DROP TABLE/u.test(baselineSource)) throw new Error('Baseline migration is not empty.')
  if (/public\.radar_public|"name"\s*:\s*"radar_public"/u.test(baselineSnapshotSource)) throw new Error('Baseline snapshot unexpectedly contains radar_public.')
  if (!/CREATE TABLE\s+(?:"public"\.)?"radar_public"/u.test(migrationSource)) throw new Error('Radar migration does not create radar_public.')
  if (!/public\.radar_public|"name"\s*:\s*"radar_public"/u.test(migrationSnapshotSource)) throw new Error('Radar snapshot does not contain radar_public.')

  const upSql = extractMigrationSql(migrationSource, 'up')
  const downSql = extractMigrationSql(migrationSource, 'down')
  assertRadarOnlySql(upSql, 'up')
  assertRadarOnlySql(downSql, 'down')

  const copied = {
    baselineTs: path.join(outDir, path.basename(baselineTs)),
    baselineSnapshot: path.join(outDir, path.basename(baselineSnapshot)),
    migrationTs: path.join(outDir, path.basename(migrationTs)),
    migrationSnapshot: path.join(outDir, path.basename(migrationSnapshot)),
  }
  fs.copyFileSync(baselineTs, copied.baselineTs)
  fs.copyFileSync(baselineSnapshot, copied.baselineSnapshot)
  fs.copyFileSync(migrationTs, copied.migrationTs)
  fs.copyFileSync(migrationSnapshot, copied.migrationSnapshot)
  fs.copyFileSync(auditSummaryPath, path.join(outDir, 'bound-global-audit-summary.json'))
  fs.copyFileSync(auditManifestPath, path.join(outDir, 'bound-global-audit-manifest.json'))
  fs.writeFileSync(path.join(outDir, 'radar-public-schema-up.sql.disabled'), upSql, 'utf8')
  fs.writeFileSync(path.join(outDir, 'radar-public-schema-down.sql.disabled'), downSql, 'utf8')
  writeJsonl(path.join(outDir, 'public-conclusions-write-plan.jsonl'), writePlan)

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version: VERSION,
    branch: 'agent/radar-public-conclusions-v01',
    beforeHead,
    afterHead,
    audit: {
      bundleSha256: normalizeHash(auditZipSha256),
      readyFileSha256: EXPECTED_READY_SHA256,
      sourceRows: EXPECTED_SOURCE_ROWS,
      publicReadyRows: writePlan.length,
      privateReadyRows: 0,
      blockedRows: 1805,
      globalBlockers: 0,
    },
    schema: {
      baselineMigration: path.basename(baselineTs),
      baselineMigrationSha256: sha256File(baselineTs),
      baselineSnapshot: path.basename(baselineSnapshot),
      baselineSnapshotSha256: sha256File(baselineSnapshot),
      radarMigration: path.basename(migrationTs),
      radarMigrationSha256: sha256File(migrationTs),
      radarSnapshot: path.basename(migrationSnapshot),
      radarSnapshotSha256: sha256File(migrationSnapshot),
      upSqlSha256: sha256Buffer(upSql),
      downSqlSha256: sha256Buffer(downSql),
      radarOnly: true,
      additive: true,
    },
    dataPlan: {
      rows: writePlan.length,
      uniquePublicationKeys: new Set(writePlan.map((row) => row.publicationKey)).size,
      uniqueWorkIds: new Set(writePlan.map((row) => row.work)).size,
      writePlanSha256: sha256File(path.join(outDir, 'public-conclusions-write-plan.jsonl')),
    },
    authorization: {
      applyPhrase: 'AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-APPLY-V01',
      applyReceived: false,
      rollbackPhrase: 'AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-ROLLBACK-V01',
      rollbackReceived: false,
    },
    status: {
      schemaGenerated: true,
      schemaReviewed: false,
      labRehearsed: false,
      productionRunnerGenerated: false,
      productionSchemaExecuted: false,
      productionRowsWritten: 0,
      productionWriteAuthorized: false,
    },
    safety: {
      payloadWorksPatch: false,
      privateAiWrite: false,
      humanTrackWrite: false,
      productionDatabaseConnect: false,
      productionDatabaseWrite: false,
      productionMigrationExecuted: false,
      schemaPush: false,
      prMerge: false,
      rollbackGenerated: false,
      rollbackExecuted: false,
    },
  }
  writeJson(path.join(outDir, 'radar-public-conclusions-schema-review-summary.json'), summary)

  const manifest = fs.readdirSync(outDir).sort().filter((name) => name !== 'manifest.json').map((name) => {
    const file = path.join(outDir, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  })
  writeJson(path.join(outDir, 'manifest.json'), manifest)

  console.log('Radar public conclusions schema review built')
  console.log(`BeforeHead: ${beforeHead}`)
  console.log(`AfterHead: ${afterHead}`)
  console.log(`PublicReadyRows: ${writePlan.length}`)
  console.log(`UniquePublicationKeys: ${summary.dataPlan.uniquePublicationKeys}`)
  console.log(`UniqueWorkIds: ${summary.dataPlan.uniqueWorkIds}`)
  console.log('SchemaGenerated: True')
  console.log('SchemaReviewed: False')
  console.log('LabRehearsed: False')
  console.log('ProductionDatabaseConnect: False')
  console.log('ProductionDatabaseWrite: False')
  console.log('ProductionWriteAuthorized: False')
}

try { main() }
catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
}
