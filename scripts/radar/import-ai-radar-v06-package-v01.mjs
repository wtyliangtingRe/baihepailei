#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import {
  V06_IMPORT_VERSION,
  assertUnderDataLocal,
  buildCanonicalV06Assessment,
  indexUnique,
  jsonlText,
  readJson,
  readJsonl,
  sha256File,
  unique,
  val,
  validatePackageManifest,
  verifyPackageChecksums,
} from './lib/v06-package-import-v01.mjs'

const DEFAULT_CATALOG_MANIFEST = 'data_local/staging/ai-radar/catalog-v01/queue/catalog-batch-manifest-v01.json'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar/v06-package-import-v01'

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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, jsonlText(rows), 'utf8')
}

function listFiles(root, matcher) {
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(file, matcher))
    else if (matcher(file)) files.push(file)
  }
  return files.sort()
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.write || args.patch || args.confirm || args.gate || args['approval-token']) {
    throw new Error('v0.6 package import is read-only. Execute/apply/write flags are rejected.')
  }

  const packageDir = path.resolve(val(args['package-dir']))
  if (!val(args['package-dir'])) throw new Error('--package-dir is required and must point to the extracted v0.6 package root')
  const catalogManifestFile = val(args['catalog-manifest']) || DEFAULT_CATALOG_MANIFEST
  const outDir = val(args['out-dir']) || DEFAULT_OUT_DIR
  assertUnderDataLocal(outDir)
  if (!fs.existsSync(packageDir)) throw new Error(`Package directory not found: ${packageDir}`)
  if (!fs.existsSync(catalogManifestFile)) throw new Error(`Catalog manifest not found: ${catalogManifestFile}`)

  const packageManifestFile = path.join(packageDir, 'MANIFEST.json')
  const checksumsFile = path.join(packageDir, 'CHECKSUMS.json')
  const resolutionsFile = path.join(packageDir, '_reports', 'v0.6-resolutions.jsonl')
  const guardFile = path.join(packageDir, '_reports', 'v0.6-publication-guard.jsonl')
  for (const file of [packageManifestFile, checksumsFile, resolutionsFile, guardFile]) {
    if (!fs.existsSync(file)) throw new Error(`Required package file missing: ${file}`)
  }

  const packageManifest = readJson(packageManifestFile)
  const checksums = readJson(checksumsFile)
  const catalogManifest = readJson(catalogManifestFile)
  const globalBlockers = [
    ...validatePackageManifest(packageManifest),
    ...verifyPackageChecksums(packageDir, checksums),
  ]

  const validationFiles = listFiles(packageDir, (file) => /[\\/]validation[\\/].+\.validation\.json$/u.test(file))
  if (validationFiles.length !== Number(packageManifest?.summary?.validationFiles)) globalBlockers.push('validation_file_count_mismatch')
  for (const file of validationFiles) {
    const validation = readJson(file)
    if (validation?.complete !== true || validation?.validJsonl !== true) globalBlockers.push(`validation_not_complete:${path.relative(packageDir, file)}`)
    if (Number(validation?.unknownRuleCodes || 0) !== 0 || Number(validation?.mixedGradeRows || 0) !== 0) globalBlockers.push(`validation_semantic_error:${path.relative(packageDir, file)}`)
    if (Number(validation?.payloadWrite || 0) !== 0 || Number(validation?.postgresqlWrite || 0) !== 0) globalBlockers.push(`validation_write_safety_error:${path.relative(packageDir, file)}`)
  }

  const readyEntries = (catalogManifest?.batches || []).filter((entry) => val(entry?.queue) === 'ready_for_ai_assessment')
  if (readyEntries.length !== 44) globalBlockers.push(`catalog_ready_batch_count_expected_44_received_${readyEntries.length}`)
  const canonicalRows = []
  const canonicalBatchByWorkId = new Map()
  for (const entry of readyEntries) {
    const file = val(entry?.file)
    if (!file || !fs.existsSync(file)) {
      globalBlockers.push(`catalog_batch_file_missing:${val(entry?.batchId)}`)
      continue
    }
    if (sha256File(file) !== val(entry?.sha256)) globalBlockers.push(`catalog_batch_sha256_mismatch:${val(entry?.batchId)}`)
    const rows = readJsonl(file)
    if (rows.length !== Number(entry?.rowCount)) globalBlockers.push(`catalog_batch_row_count_mismatch:${val(entry?.batchId)}`)
    for (const row of rows) {
      canonicalRows.push(row)
      canonicalBatchByWorkId.set(val(row?.workId), val(entry?.batchId))
    }
  }

  const responseFiles = listFiles(packageDir, (file) => /[\\/]responses[\\/].+\.output\.jsonl$/u.test(file))
  if (responseFiles.length !== Number(packageManifest?.summary?.responseFiles)) globalBlockers.push('response_file_count_mismatch')
  const responseRows = responseFiles.flatMap(readJsonl)
  const resolutionRows = readJsonl(resolutionsFile)
  const guardRows = readJsonl(guardFile)

  const canonicalIndex = indexUnique(canonicalRows, 'canonical')
  const responseIndex = indexUnique(responseRows, 'response')
  const resolutionIndex = indexUnique(resolutionRows, 'resolution')
  const guardIndex = indexUnique(guardRows, 'guard')
  globalBlockers.push(...canonicalIndex.blockers, ...responseIndex.blockers, ...resolutionIndex.blockers, ...guardIndex.blockers)

  const expectedRows = Number(packageManifest?.summary?.rows)
  for (const [label, map] of [['canonical', canonicalIndex.map], ['response', responseIndex.map], ['resolution', resolutionIndex.map]]) {
    if (map.size !== expectedRows) globalBlockers.push(`${label}_identity_count_expected_${expectedRows}_received_${map.size}`)
  }
  for (const workId of canonicalIndex.map.keys()) {
    if (!responseIndex.map.has(workId)) globalBlockers.push(`response_missing_for_canonical:${workId}`)
    if (!resolutionIndex.map.has(workId)) globalBlockers.push(`resolution_missing_for_canonical:${workId}`)
  }
  for (const workId of responseIndex.map.keys()) if (!canonicalIndex.map.has(workId)) globalBlockers.push(`response_unknown_to_catalog:${workId}`)
  for (const workId of resolutionIndex.map.keys()) if (!canonicalIndex.map.has(workId)) globalBlockers.push(`resolution_unknown_to_catalog:${workId}`)

  const normalizedGlobalBlockers = unique(globalBlockers)
  if (normalizedGlobalBlockers.length) {
    const summary = {
      generatedAt: new Date().toISOString(),
      version: V06_IMPORT_VERSION,
      complete: false,
      packageDir,
      catalogManifestFile,
      blockers: normalizedGlobalBlockers,
      safety: { payloadRead: false, payloadWrite: false, payloadPatchRequests: 0, directPostgresqlWrite: false },
    }
    writeJson(path.join(outDir, 'ai-radar-v06-package-import-v01-summary.json'), summary)
    console.log(JSON.stringify({ ok: false, summary }, null, 2))
    process.exitCode = 2
    return
  }

  const rows = canonicalRows.map((canonicalRow) => {
    const workId = val(canonicalRow?.workId)
    return buildCanonicalV06Assessment({
      canonicalRow,
      response: responseIndex.map.get(workId),
      resolution: resolutionIndex.map.get(workId),
      guard: guardIndex.map.get(workId),
      packageManifest,
    })
  })

  for (const row of rows) {
    if (val(row?.assessmentBatch) !== canonicalBatchByWorkId.get(val(row?.workId))) row.blockers = unique([...row.blockers, 'resolution_batch_id_mismatch'])
  }

  const ready = rows.filter((row) => row.blockers.length === 0)
  const blocked = rows.filter((row) => row.blockers.length > 0)
  const guarded = rows.filter((row) => row.needsPublicationGuard)
  const batchesRoot = path.join(outDir, 'batches')
  fs.rmSync(batchesRoot, { recursive: true, force: true })
  const byBatch = new Map()
  for (const row of rows) {
    if (!byBatch.has(row.assessmentBatch)) byBatch.set(row.assessmentBatch, [])
    byBatch.get(row.assessmentBatch).push(row)
  }
  for (const [batchId, batchRows] of [...byBatch.entries()].sort()) {
    writeJsonl(path.join(batchesRoot, `${batchId.toLowerCase()}.jsonl`), batchRows)
  }

  const outputs = {
    all: path.join(outDir, 'ai-radar-v06-package-import-v01.jsonl'),
    ready: path.join(outDir, 'ai-radar-v06-package-import-v01-ready.jsonl'),
    blocked: path.join(outDir, 'ai-radar-v06-package-import-v01-blocked.jsonl'),
    publicationGuard: path.join(outDir, 'ai-radar-v06-package-import-v01-publication-guard.jsonl'),
    batchesRoot,
    summary: path.join(outDir, 'ai-radar-v06-package-import-v01-summary.json'),
  }
  writeJsonl(outputs.all, rows)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.blocked, blocked)
  writeJsonl(outputs.publicationGuard, guarded)

  const countBy = (items, getter) => {
    const counts = {}
    for (const item of items) {
      const key = val(getter(item)) || 'missing'
      counts[key] = (counts[key] || 0) + 1
    }
    return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: V06_IMPORT_VERSION,
    complete: true,
    policyVersion: val(packageManifest?.summary?.policyVersion),
    packageDir,
    packageManifestSha256: sha256File(packageManifestFile),
    checksumsSha256: sha256File(checksumsFile),
    catalogManifestFile,
    catalogManifestSha256: sha256File(catalogManifestFile),
    rowsRead: rows.length,
    readyForPayloadPlanning: ready.length,
    blockedBeforePayloadPlanning: blocked.length,
    publicationGuardRows: guarded.length,
    byGrade: countBy(rows, (row) => row.currentGradeSuggestion),
    byBatch: countBy(rows, (row) => row.assessmentBatch),
    byBlocker: countBy(blocked.flatMap((row) => row.blockers), (item) => item),
    byWarning: countBy(rows.flatMap((row) => row.warnings), (item) => item),
    outputs,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      packageChecksumsVerified: true,
      catalogBatchHashesVerified: true,
      exactIdentitySetVerified: true,
      canonicalIdentityAndProtectionFromCatalogOnly: true,
      publicationGuardPreserved: true,
    },
    nextStep: `pnpm radar:plan-v06-payload -- --input "${outputs.all}" --expected-rows ${rows.length}`,
  }
  writeJson(outputs.summary, summary)
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

try { main() } catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
}
