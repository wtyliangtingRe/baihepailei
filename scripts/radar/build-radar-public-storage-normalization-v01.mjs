#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  PUBLIC_CONCLUSION_STORAGE_VERSION,
  canonical,
  conclusionSha256ForRecord,
  normalizePublicRecordForStorage,
} from './lib/public-conclusion-storage-v01.mjs'

const EXPECTED_AUDIT_ZIP_SHA256 = '7877020d0314352531290be0d4e334d2b17e18e6f552591dd14e30431f7837ba'
const EXPECTED_SCHEMA_REVIEW_ZIP_SHA256 = '297fed9ab54675748e5ae0dd812cfa4ac367966d12e7732541913223d74ac0fb'
const EXPECTED_OLD_READY_SHA256 = '95111c7a01fc5c56efd58a9ed03a2c446ec831d1b6fe3ce6822a9bdfafc1258f'
const EXPECTED_FAILED_BACKUP_SHA256 = 'f44f647833b4a1ea39ea48ee71d59a5f707c0f8595734ce6a1871372ba7014dc'
const EXPECTED_FAILED_BACKUP_BYTES = 27596786
const EXPECTED_ROWS = 9000
const EXPECTED_GRADES = { S: 8, A: 267, B: 675, C: 868, D: 7032, E: 138, F: 12 }

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
    catch (error) { throw new Error(`Invalid JSONL ${file}:${index + 1}: ${error.message}`) }
  })
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function assertManifest(directory) {
  const manifestPath = path.join(directory, 'manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`)
  const manifest = readJson(manifestPath)
  for (const entry of manifest) {
    const file = path.join(directory, String(entry.file))
    if (!fs.existsSync(file)) throw new Error(`Manifest file missing: ${entry.file}`)
    if (fs.statSync(file).size !== Number(entry.bytes)) throw new Error(`Manifest bytes mismatch: ${entry.file}`)
    if (sha256File(file) !== String(entry.sha256).toLowerCase()) throw new Error(`Manifest hash mismatch: ${entry.file}`)
  }
  return manifest
}

function comparableOuterRow(row) {
  const copy = structuredClone(row)
  delete copy.publicRecord
  delete copy.storageStatus
  delete copy.storageNormalizationVersion
  return canonical(copy)
}

function timestampStats(source, normalized) {
  const match = String(source).match(/\.(\d{1,6})(Z|[+-]\d{2}:\d{2})$/u)
  const fraction = String(match?.[1] || '').padEnd(6, '0')
  const microseconds = fraction ? Number(fraction) : 0
  const base = Date.parse(String(source).replace(/\.\d{1,6}(?=Z|[+-]\d{2}:\d{2}$)/u, ''))
  const truncated = new Date(base + Math.floor(microseconds / 1000)).toISOString()
  return {
    fractionDigits: match?.[1]?.length || 0,
    roundedUp: normalized !== truncated,
    carriedSecond: normalized.slice(0, 19) !== truncated.slice(0, 19),
    sourceHadNonUtcOffset: !String(source).endsWith('Z') && !String(source).endsWith('+00:00'),
  }
}

function validateFailedLab(directory) {
  const stagePath = path.join(directory, 'lab-stage-status.json')
  const stderrPath = path.join(directory, 'apply-stderr.txt')
  const backupPath = path.join(directory, 'database-backup.dump')
  for (const file of [stagePath, stderrPath, backupPath]) {
    if (!fs.existsSync(file)) throw new Error(`Failed lab evidence missing: ${file}`)
  }
  const stage = readJson(stagePath)
  const stderr = fs.readFileSync(stderrPath, 'utf8')
  const backupBytes = fs.statSync(backupPath).size
  const backupSha256 = sha256File(backupPath)
  const blockers = []
  if (stage.productionDatabaseWrite !== false) blockers.push('failed_lab_claims_production_write')
  if (stage.freshBackupCreated !== true) blockers.push('failed_lab_backup_not_created')
  if (stage.isolatedRestorePassed !== true) blockers.push('failed_lab_restore_not_passed')
  if (stage.schemaApplyPassed !== false) blockers.push('failed_lab_schema_apply_unexpected')
  if (Number(stage.dataRowsApplied) !== 0) blockers.push('failed_lab_data_rows_not_zero')
  if (stage.labContainerRemoved !== true) blockers.push('failed_lab_container_not_removed')
  if (stage.sourceContainerTempFilesRemoved !== true) blockers.push('failed_lab_source_temp_not_removed')
  if (stage.evidencePackageCompleted !== false) blockers.push('failed_lab_package_unexpected')
  if (!/main row field mismatches:\s*9000/u.test(stderr)) blockers.push('failed_lab_expected_mismatch_missing')
  if (backupBytes !== EXPECTED_FAILED_BACKUP_BYTES) blockers.push('failed_lab_backup_bytes_mismatch')
  if (backupSha256 !== EXPECTED_FAILED_BACKUP_SHA256) blockers.push('failed_lab_backup_sha256_mismatch')
  if (blockers.length) throw new Error(`Failed lab binding failed: ${blockers.join(', ')}`)
  return { stage, stderr, backupBytes, backupSha256, stagePath, stderrPath }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const auditDir = path.resolve(required(args, 'audit-dir'))
  const schemaReviewDir = path.resolve(required(args, 'schema-review-dir'))
  const failedLabDir = path.resolve(required(args, 'failed-lab-dir'))
  const outDir = path.resolve(required(args, 'out-dir'))
  const auditZipSha256 = required(args, 'audit-zip-sha256').toLowerCase()
  const schemaReviewZipSha256 = required(args, 'schema-review-zip-sha256').toLowerCase()

  if (auditZipSha256 !== EXPECTED_AUDIT_ZIP_SHA256) throw new Error('Audit ZIP SHA-256 mismatch.')
  if (schemaReviewZipSha256 !== EXPECTED_SCHEMA_REVIEW_ZIP_SHA256) throw new Error('Schema review ZIP SHA-256 mismatch.')
  assertManifest(auditDir)
  assertManifest(schemaReviewDir)
  const failedLab = validateFailedLab(failedLabDir)

  const oldReadyPath = path.join(auditDir, 'public-ai-ready.jsonl')
  const oldPlanPath = path.join(schemaReviewDir, 'public-conclusions-write-plan.jsonl')
  const auditSummary = readJson(path.join(auditDir, 'all-remaining-radar-global-audit-summary.json'))
  const schemaSummary = readJson(path.join(schemaReviewDir, 'radar-public-conclusions-schema-review-summary.json'))
  const schemaValidation = readJson(path.join(schemaReviewDir, 'schema-review-run-validation.json'))

  if (sha256File(oldReadyPath) !== EXPECTED_OLD_READY_SHA256) throw new Error('Old public ready SHA-256 mismatch.')
  if (Number(auditSummary?.publicTrack?.readyToWrite) !== EXPECTED_ROWS) throw new Error('Audit public-ready count mismatch.')
  if (Number(schemaSummary?.dataPlan?.rows) !== EXPECTED_ROWS) throw new Error('Schema review data-plan count mismatch.')
  if (schemaSummary?.schema?.radarOnly !== true || schemaSummary?.schema?.additive !== true) throw new Error('Schema review is not Radar-only additive.')
  if (schemaValidation?.productionDatabaseWrite !== false || schemaValidation?.productionMigrationExecuted !== false) {
    throw new Error('Schema review claims a production write or migration execution.')
  }

  const oldRows = readJsonl(oldReadyPath)
  const oldPlan = readJsonl(oldPlanPath)
  if (oldRows.length !== EXPECTED_ROWS || oldPlan.length !== EXPECTED_ROWS) throw new Error('Old ready/plan row count mismatch.')
  const oldPlanByKey = new Map(oldPlan.map((row) => [String(row.publicationKey), row]))
  if (oldPlanByKey.size !== EXPECTED_ROWS) throw new Error('Old write plan contains duplicate publication keys.')

  const normalizedRows = []
  const rewriteMap = []
  const storagePlan = []
  const gradeCounts = Object.fromEntries(Object.keys(EXPECTED_GRADES).map((grade) => [grade, 0]))
  const oldHashes = new Set()
  const newHashes = new Set()
  const publicationKeys = new Set()
  const workIds = new Set()
  const rounding = {
    fractionDigits: {},
    roundedUpRows: 0,
    carriedToNextSecondRows: 0,
    nonUtcOffsetRows: 0,
  }

  for (const [index, row] of oldRows.entries()) {
    const record = row?.publicRecord
    const key = String(record?.publicationKey || '')
    const work = String(record?.work || '')
    if (row?.publicStatus !== 'ready_public_ai_after_schema') throw new Error(`Row ${index + 1} publicStatus mismatch.`)
    if ((row?.publicBlockers || []).length || (row?.blockers || []).length) throw new Error(`Row ${index + 1} contains blockers.`)
    if (!record || key !== `work:${work}` || work !== String(record.workIdSnapshot)) throw new Error(`Row ${index + 1} identity mismatch.`)
    if (conclusionSha256ForRecord(record) !== String(record.conclusionSha256).toLowerCase()) throw new Error(`Row ${index + 1} old hash mismatch.`)

    const planRow = oldPlanByKey.get(key)
    if (!planRow || String(planRow.conclusionSha256).toLowerCase() !== String(record.conclusionSha256).toLowerCase()) {
      throw new Error(`Row ${index + 1} is not bound to the old schema-review plan.`)
    }

    const { normalizedRecord, mapping } = normalizePublicRecordForStorage(record)
    const normalizedRow = canonical({
      ...structuredClone(row),
      publicRecord: normalizedRecord,
      storageStatus: 'ready_public_ai_storage_normalized',
      storageNormalizationVersion: PUBLIC_CONCLUSION_STORAGE_VERSION,
    })
    if (JSON.stringify(comparableOuterRow(row)) !== JSON.stringify(comparableOuterRow(normalizedRow))) {
      throw new Error(`Row ${index + 1} changed an outer business field.`)
    }

    if (!(normalizedRecord.compatibilityGrade in gradeCounts)) throw new Error(`Unexpected grade at row ${index + 1}.`)
    gradeCounts[normalizedRecord.compatibilityGrade] += 1
    if (publicationKeys.has(key)) throw new Error(`Duplicate publicationKey: ${key}`)
    if (workIds.has(work)) throw new Error(`Duplicate Work ID: ${work}`)
    if (oldHashes.has(mapping.oldConclusionSha256)) throw new Error(`Duplicate old conclusion hash: ${mapping.oldConclusionSha256}`)
    if (newHashes.has(mapping.newConclusionSha256)) throw new Error(`Duplicate normalized conclusion hash: ${mapping.newConclusionSha256}`)
    publicationKeys.add(key)
    workIds.add(work)
    oldHashes.add(mapping.oldConclusionSha256)
    newHashes.add(mapping.newConclusionSha256)

    const stats = timestampStats(mapping.oldAssessedAt, mapping.normalizedAssessedAt)
    rounding.fractionDigits[stats.fractionDigits] = (rounding.fractionDigits[stats.fractionDigits] || 0) + 1
    if (stats.roundedUp) rounding.roundedUpRows += 1
    if (stats.carriedSecond) rounding.carriedToNextSecondRows += 1
    if (stats.sourceHadNonUtcOffset) rounding.nonUtcOffsetRows += 1

    normalizedRows.push(normalizedRow)
    rewriteMap.push(mapping)
    storagePlan.push(canonical({
      publicationKey: key,
      work,
      workIdSnapshot: String(normalizedRecord.workIdSnapshot),
      workSiteId: normalizedRecord.workSiteId,
      title: normalizedRecord.title,
      grade: normalizedRecord.compatibilityGrade,
      assessedAt: normalizedRecord.radarAssessment.assessedAt,
      conclusionSha256: normalizedRecord.conclusionSha256,
      supersededConclusionSha256: mapping.oldConclusionSha256,
      assessmentBatch: normalizedRecord.radarAssessment.assessmentBatch,
      sourcePackageSha256: normalizedRecord.sourcePackageSha256,
      storageNormalizationVersion: PUBLIC_CONCLUSION_STORAGE_VERSION,
    }))
  }

  if (JSON.stringify(gradeCounts) !== JSON.stringify(EXPECTED_GRADES)) {
    throw new Error(`Grade distribution changed: ${JSON.stringify(gradeCounts)}`)
  }
  if (normalizedRows.length !== EXPECTED_ROWS || rewriteMap.length !== EXPECTED_ROWS || storagePlan.length !== EXPECTED_ROWS) {
    throw new Error('Normalized output row accounting mismatch.')
  }
  if (rewriteMap.some((row) => row.oldConclusionSha256 === row.newConclusionSha256)) {
    throw new Error('At least one conclusion hash did not change after timestamp normalization.')
  }

  fs.mkdirSync(outDir, { recursive: true })
  const normalizedReadyPath = path.join(outDir, 'public-ai-storage-ready.jsonl')
  const rewriteMapPath = path.join(outDir, 'public-conclusion-storage-rewrite-map.jsonl')
  const storagePlanPath = path.join(outDir, 'public-conclusions-storage-write-plan.jsonl')
  writeJsonl(normalizedReadyPath, normalizedRows)
  writeJsonl(rewriteMapPath, rewriteMap)
  writeJsonl(storagePlanPath, storagePlan)
  fs.copyFileSync(failedLab.stagePath, path.join(outDir, 'bound-failed-lab-stage-status.json'))
  fs.copyFileSync(failedLab.stderrPath, path.join(outDir, 'bound-failed-lab-apply-stderr.txt'))

  const normalizedReadySha256 = sha256File(normalizedReadyPath)
  const rewriteMapSha256 = sha256File(rewriteMapPath)
  const storagePlanSha256 = sha256File(storagePlanPath)
  const summary = canonical({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version: PUBLIC_CONCLUSION_STORAGE_VERSION,
    inputs: {
      auditZipSha256,
      schemaReviewZipSha256,
      oldReadyFileSha256: EXPECTED_OLD_READY_SHA256,
      failedLabBackupBytes: failedLab.backupBytes,
      failedLabBackupSha256: failedLab.backupSha256,
      failedLabError: 'main row field mismatches: 9000',
    },
    normalization: {
      timestampTarget: 'UTC ISO-8601 milliseconds',
      postgresTargetType: 'timestamp(3) with time zone',
      rows: normalizedRows.length,
      assessedAtChangedRows: rewriteMap.length,
      conclusionHashChangedRows: rewriteMap.length,
      unchangedBusinessFieldRows: normalizedRows.length,
      changedFieldsOnly: ['publicRecord.radarAssessment.assessedAt', 'publicRecord.conclusionSha256'],
      rounding,
    },
    outputs: {
      normalizedReadyFile: path.basename(normalizedReadyPath),
      normalizedReadyFileSha256: normalizedReadySha256,
      rewriteMapFile: path.basename(rewriteMapPath),
      rewriteMapSha256,
      storageWritePlanFile: path.basename(storagePlanPath),
      storageWritePlanSha256: storagePlanSha256,
    },
    invariants: {
      rows: EXPECTED_ROWS,
      uniquePublicationKeys: publicationKeys.size,
      uniqueWorkIds: workIds.size,
      uniqueOldConclusionHashes: oldHashes.size,
      uniqueNewConclusionHashes: newHashes.size,
      gradeCounts,
      businessAuditSuperseded: false,
      migrationDdlSuperseded: false,
      oldPublicWritePlanSuperseded: true,
      oldReadyFileMustNotBeWritten: true,
    },
    safety: {
      payloadRead: false,
      payloadWrite: false,
      productionDatabaseRead: false,
      productionDatabaseWrite: false,
      migrationExecuted: false,
      schemaPush: false,
      prMerge: false,
      productionApplyAuthorized: false,
      rollbackAuthorized: false,
    },
    readyForStoragePlanReview: true,
  })
  writeJson(path.join(outDir, 'radar-public-storage-normalization-summary.json'), summary)
  writeJson(path.join(outDir, 'storage-normalization-supersession.json'), canonical({
    schemaVersion: 1,
    businessAudit: {
      sha256: auditZipSha256,
      status: 'retained_as_business_decision_evidence',
    },
    schemaMigration: {
      commit: schemaSummary.afterHead,
      status: 'retained',
    },
    supersededDataArtifacts: [
      { file: 'public-ai-ready.jsonl', sha256: EXPECTED_OLD_READY_SHA256 },
      { file: 'public-conclusions-write-plan.jsonl', sha256: sha256File(oldPlanPath) },
      { bundleSha256: schemaReviewZipSha256, scope: 'data_plan_only' },
    ],
    replacementDataArtifacts: {
      normalizedReadyFileSha256: normalizedReadySha256,
      storageWritePlanSha256: storagePlanSha256,
      rewriteMapSha256,
    },
  }))

  console.log('Radar public storage normalization complete')
  console.log(`Rows: ${EXPECTED_ROWS}`)
  console.log(`NormalizedReadySHA256: ${normalizedReadySha256}`)
  console.log(`StorageWritePlanSHA256: ${storagePlanSha256}`)
  console.log(`RewriteMapSHA256: ${rewriteMapSha256}`)
  console.log(`RoundedUpRows: ${rounding.roundedUpRows}`)
  console.log(`CarriedToNextSecondRows: ${rounding.carriedToNextSecondRows}`)
  console.log('ProductionDatabaseWrite: False')
  console.log('ProductionApplyAuthorized: False')
}

main()
