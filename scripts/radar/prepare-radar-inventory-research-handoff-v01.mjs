#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const VERSION = 'radar-inventory-research-handoff-v0.1'
export const RESEARCH_HANDOFF_VERSION = 'ai-radar-research-handoff-v0.1'
export const DEFAULT_PACKAGE_ID = 'RADAR-REMAINING-CANONICAL-RESEARCH-0001-input-v01'
export const DEFAULT_BATCH_PREFIX = 'RADAR-REMAINING-CANONICAL-RESEARCH-0001-WAVE'

const WRITE_LIKE_FLAGS = new Set([
  'execute', 'apply', 'write', 'patch', 'delete', 'update', 'create',
  'migration', 'migrate', 'schema-push', 'deploy', 'rollback', 'gate',
  'confirm', 'approval-token',
])

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }

export function parseArgs(argv) {
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

export function assertReadOnlyArgs(args) {
  for (const key of Object.keys(args)) {
    if (WRITE_LIKE_FLAGS.has(key)) throw new Error(`Write-like flag rejected: --${key}`)
  }
}

function integerArg(value, fallback, name) {
  const number = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`)
  return number
}

function safeSlug(value) {
  const slug = val(value).toLowerCase().replace(/[^a-z0-9_-]+/gu, '-')
  if (!slug) throw new Error('Identifier could not be converted to a safe directory name')
  return slug
}

function normalizeText(text) { return String(text ?? '').replace(/^\uFEFF/u, '') }
function readJson(file) { return JSON.parse(normalizeText(fs.readFileSync(file, 'utf8'))) }
function readJsonl(file) {
  return normalizeText(fs.readFileSync(file, 'utf8'))
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}
function jsonlText(rows) { return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '') }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, value, 'utf8')
}
function sha256Text(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function sha256File(file) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(file))
  return hash.digest('hex')
}
function fileEntry(root, file) {
  const absolute = path.resolve(root, file)
  return {
    file: path.relative(root, absolute).replaceAll('\\', '/'),
    bytes: fs.statSync(absolute).size,
    sha256: sha256File(absolute),
  }
}

export function assertOutputUnderDataLocal(outputDir, cwd = process.cwd()) {
  const root = path.resolve(cwd, 'data_local')
  const resolved = path.resolve(cwd, outputDir)
  const prefix = `${root}${path.sep}`
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error(`Output path must remain under data_local: ${resolved}`)
  }
  return resolved
}

function verifyReviewManifest(reviewDir) {
  const manifestFile = path.join(reviewDir, 'review-manifest.json')
  if (!fs.existsSync(manifestFile)) throw new Error(`Review manifest missing: ${manifestFile}`)
  const entries = readJson(manifestFile)
  if (!Array.isArray(entries) || !entries.length) throw new Error('Review manifest must contain file entries')
  const listed = new Set()
  for (const entry of entries) {
    const relative = val(entry?.file).replaceAll('/', path.sep)
    if (!relative) throw new Error('Review manifest entry missing file')
    const absolute = path.resolve(reviewDir, relative)
    const prefix = `${path.resolve(reviewDir)}${path.sep}`
    if (!absolute.startsWith(prefix)) throw new Error(`Review manifest path escape: ${relative}`)
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Review manifest file missing: ${relative}`)
    const bytes = fs.statSync(absolute).size
    const actualSha = sha256File(absolute)
    if (bytes !== Number(entry.bytes) || actualSha !== val(entry.sha256).toLowerCase()) {
      throw new Error(`Review manifest mismatch: ${relative}`)
    }
    listed.add(path.relative(reviewDir, absolute).replaceAll('\\', '/'))
  }
  const actual = fs.readdirSync(reviewDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(reviewDir, path.join(entry.parentPath || entry.path, entry.name)).replaceAll('\\', '/'))
    .filter((file) => file !== 'review-manifest.json')
  const unlisted = actual.filter((file) => !listed.has(file))
  if (unlisted.length) throw new Error(`Review package contains unlisted files: ${unlisted.join(', ')}`)
  return entries
}

function assertIdentityRow(row, index, expectedBatchSize) {
  const workId = val(row?.workId)
  const siteId = val(row?.siteId)
  const title = val(row?.title)
  const slug = val(row?.slug)
  if (!workId || !siteId || !title || !slug) throw new Error(`Research row ${index + 1} has incomplete identity`)
  if (val(row?.publicationKey) !== `work:${workId}`) throw new Error(`Publication key mismatch for Work ${workId}`)
  if (val(row?.inventoryStatus) !== 'missing_current') throw new Error(`Inventory status mismatch for Work ${workId}`)
  if (Number(row?.currentPublicConclusionCount) !== 0) throw new Error(`Current public conclusion count is not zero for Work ${workId}`)
  if (val(row?.catalogStatus) !== 'active') throw new Error(`Catalog status is not active for Work ${workId}`)
  if (val(row?.payloadStatus) !== 'published') throw new Error(`Payload status is not published for Work ${workId}`)
  if (Number(row?.batchOrdinal) !== index + 1 || Number(row?.batchOrdinal) > expectedBatchSize) {
    throw new Error(`Batch ordinal mismatch for Work ${workId}`)
  }
}

export function transformInventoryRow(row, context) {
  return {
    ...row,
    researchSource: {
      version: VERSION,
      sourceInventoryVersion: context.inventoryVersion,
      sourceBranchHead: context.sourceBranchHead,
      sourceBundleSha256: context.sourceBundleSha256,
      sourceReviewBundleSha256: context.sourceReviewBundleSha256 || undefined,
    },
    existingState: {
      publicConclusionCount: 0,
      inventoryStatus: 'missing_current',
    },
    writeProtection: {
      protected: false,
      reasons: [],
    },
    inputAudit: {
      assessmentReadiness: 'external_research_required',
      researchReason: 'missing_current_public_conclusion',
      inventoryBatchId: val(row?.batchId),
      inventoryBatchOrdinal: Number(row?.batchOrdinal),
      inventoryWaveId: val(row?.waveId),
      inventoryWaveOrdinal: Number(row?.waveOrdinal),
      sourceBranchHead: context.sourceBranchHead,
      sourceBundleSha256: context.sourceBundleSha256,
    },
    catalogQueue: {
      version: VERSION,
      queue: 'external_research',
      reasons: ['missing_current_public_conclusion'],
      actionable: true,
    },
  }
}

function researchInstructions(packageId, batchId, waveId) {
  return [
    `# ${batchId} external research handoff`,
    '',
    `Parent package: ${packageId}`,
    `Inventory wave: ${waveId}`,
    '',
    'Process chunk input files in manifest order. Save each response as the exact matching output JSONL path.',
    '',
    'Research identity, aliases, plot, female relationships, male romantic/sexual involvement, NTR risk, ending or serialization status, adult content, and TS/futa/ABO/otokonoko settings.',
    '',
    'Do not assign Radar grades. Do not fabricate sources or unresolved facts. Use identity_review or needs_more_research when evidence is insufficient.',
    '',
    'Every output row must preserve workId and siteId exactly and follow the existing ai-radar-research-handoff-v0.1 response schema.',
    '',
  ].join('\n')
}

function topInstructions(packageId, batches) {
  return [
    `# ${packageId}`,
    '',
    'This package contains 2,500 read-only external-research tasks split into ten independently recoverable 250-row waves and 500 five-row chunks.',
    '',
    'Use each wave handoff independently. Complete all response files for one wave, then run the existing research assembler for that batch ID before proceeding or checkpointing.',
    '',
    ...batches.flatMap((batch) => [
      `- ${batch.batchId}: ${batch.rowCount} rows, ${batch.chunkCount} chunks, Work ${batch.firstWorkId} → ${batch.lastWorkId}`,
    ]),
    '',
    'Safety: local files only; no Payload writes; no PostgreSQL writes; no ratings published.',
    '',
  ].join('\n')
}

export function buildInventoryResearchHandoff(options) {
  const reviewDir = path.resolve(options.reviewDir)
  const outputDir = assertOutputUnderDataLocal(options.outputDir, options.cwd || process.cwd())
  const batchSize = integerArg(options.batchSize, 2500, 'batch-size')
  const waveSize = integerArg(options.waveSize, 250, 'wave-size')
  const chunkSize = integerArg(options.chunkSize, 5, 'chunk-size')
  if (batchSize % waveSize !== 0 || waveSize % chunkSize !== 0) {
    throw new Error('batch-size must divide into wave-size, and wave-size must divide into chunk-size')
  }
  const expectedWaveCount = batchSize / waveSize
  const packageId = val(options.packageId) || DEFAULT_PACKAGE_ID
  const batchPrefix = val(options.batchPrefix) || DEFAULT_BATCH_PREFIX
  const expectedSourceBundleSha256 = val(options.expectedSourceBundleSha256).toUpperCase()
  const expectedReviewBundleSha256 = val(options.expectedReviewBundleSha256).toUpperCase()
  if (!expectedSourceBundleSha256) throw new Error('expected source bundle SHA-256 is required')

  verifyReviewManifest(reviewDir)
  const metadata = readJson(path.join(reviewDir, 'review-package-metadata.json'))
  const summary = readJson(path.join(reviewDir, 'inventory-summary.json'))
  const audit = readJson(path.join(reviewDir, 'independent-audit.json'))
  if (val(metadata?.sourceBundleSha256).toUpperCase() !== expectedSourceBundleSha256) {
    throw new Error('Source bundle SHA-256 does not match accepted inventory evidence')
  }
  if (expectedReviewBundleSha256 && val(options.actualReviewBundleSha256).toUpperCase() !== expectedReviewBundleSha256) {
    throw new Error('Review bundle SHA-256 does not match accepted review evidence')
  }
  if (Number(summary?.counts?.researchBatchRows) !== batchSize ||
      Number(summary?.counts?.researchWaveCount) !== expectedWaveCount ||
      Number(summary?.counts?.supersedeCandidate) !== 0 ||
      list(summary?.globalBlockers).length !== 0 ||
      summary?.readyForResearchPackaging !== true) {
    throw new Error('Inventory summary does not satisfy research packaging gates')
  }
  if (audit?.checks?.researchBatchDeterministicOrder !== true ||
      audit?.checks?.wavesMatchResearchBatchExactly !== true ||
      audit?.checks?.waveHashesAccepted !== true ||
      audit?.checks?.productionWriteAuthorized !== false) {
    throw new Error('Independent audit does not satisfy research packaging gates')
  }

  const researchBatch = readJsonl(path.join(reviewDir, 'research-batch-0001.jsonl'))
  if (researchBatch.length !== batchSize) throw new Error(`Research batch row count mismatch: ${researchBatch.length}`)
  const identities = new Set()
  researchBatch.forEach((row, index) => {
    assertIdentityRow(row, index, batchSize)
    const key = `${val(row.workId)}|${val(row.siteId)}`
    if (identities.has(key)) throw new Error(`Duplicate research identity: ${key}`)
    identities.add(key)
  })

  const context = {
    inventoryVersion: val(summary?.version),
    sourceBranchHead: val(summary?.branchHead),
    sourceBundleSha256: expectedSourceBundleSha256,
    sourceReviewBundleSha256: expectedReviewBundleSha256,
  }

  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  const handoffRoot = path.join(outputDir, 'handoffs')
  const sourceRoot = path.join(outputDir, 'source')
  fs.mkdirSync(handoffRoot, { recursive: true })
  fs.mkdirSync(sourceRoot, { recursive: true })

  const batches = []
  const concatenated = []
  for (let waveIndex = 1; waveIndex <= expectedWaveCount; waveIndex += 1) {
    const waveId = `wave-${String(waveIndex).padStart(2, '0')}`
    const waveFile = path.join(reviewDir, 'waves', `${waveId}.jsonl`)
    const waveManifestFile = path.join(reviewDir, 'waves', `${waveId}.manifest.json`)
    const waveRows = readJsonl(waveFile)
    const waveManifest = readJson(waveManifestFile)
    if (waveRows.length !== waveSize || Number(waveManifest?.rows) !== waveSize || waveManifest?.independentlyRecoverable !== true) {
      throw new Error(`Wave recovery gate failed: ${waveId}`)
    }
    if (sha256File(waveFile) !== val(waveManifest?.payload?.sha256) || fs.statSync(waveFile).size !== Number(waveManifest?.payload?.bytes)) {
      throw new Error(`Wave hash gate failed: ${waveId}`)
    }
    const offset = (waveIndex - 1) * waveSize
    for (let rowIndex = 0; rowIndex < waveSize; rowIndex += 1) {
      if (val(waveRows[rowIndex]?.workId) !== val(researchBatch[offset + rowIndex]?.workId)) {
        throw new Error(`Wave does not match research batch: ${waveId} row ${rowIndex + 1}`)
      }
    }
    concatenated.push(...waveRows.map((row) => val(row.workId)))

    const transformed = waveRows.map((row) => transformInventoryRow(row, context))
    const batchId = `${batchPrefix}-${String(waveIndex).padStart(2, '0')}`
    const slug = safeSlug(batchId)
    const handoffDir = path.join(handoffRoot, slug)
    const chunksDir = path.join(handoffDir, 'chunks')
    const responsesDir = path.join(handoffDir, 'responses')
    fs.mkdirSync(chunksDir, { recursive: true })
    fs.mkdirSync(responsesDir, { recursive: true })

    const sourceWaveFile = path.join(sourceRoot, `${waveId}.external-research.jsonl`)
    const sourceText = jsonlText(transformed)
    writeText(sourceWaveFile, sourceText)
    const copiedSourceFile = path.join(handoffDir, `${slug}.source.jsonl`)
    writeText(copiedSourceFile, sourceText)

    const chunks = []
    for (let index = 0; index < transformed.length; index += chunkSize) {
      const rows = transformed.slice(index, index + chunkSize)
      const chunkNumber = String(chunks.length + 1).padStart(4, '0')
      const chunkId = `${slug}-chunk-${chunkNumber}`
      const inputFile = path.join(chunksDir, `${chunkId}.input.jsonl`)
      const responseFile = path.join(responsesDir, `${chunkId}.output.jsonl`)
      const text = jsonlText(rows)
      writeText(inputFile, text)
      chunks.push({
        chunkId,
        index: chunks.length + 1,
        rowCount: rows.length,
        firstWorkId: val(rows[0]?.workId),
        lastWorkId: val(rows.at(-1)?.workId),
        inputFile,
        inputSha256: sha256Text(text),
        responseFile,
        expectedRows: rows.map((row) => ({ workId: val(row.workId), siteId: val(row.siteId), title: val(row.title) })),
      })
    }

    const instructionsFile = path.join(handoffDir, 'RESEARCH_INSTRUCTIONS.md')
    const handoffManifestFile = path.join(handoffDir, 'handoff-manifest.json')
    const handoffManifest = {
      generatedAt: new Date().toISOString(),
      version: RESEARCH_HANDOFF_VERSION,
      adapterVersion: VERSION,
      policyVersion: 'radar-rating-policy-v0.4-draft',
      packageId,
      batchId,
      inventoryWaveId: waveId,
      queue: 'external_research',
      sourceCatalogManifest: path.join(outputDir, 'catalog-batch-manifest-v01.json'),
      sourceCatalogInputSha256: expectedSourceBundleSha256,
      sourceBatchFile: sourceWaveFile,
      sourceBatchSha256: sha256Text(sourceText),
      copiedSourceFile,
      copiedSourceSha256: sha256Text(sourceText),
      rowCount: transformed.length,
      chunkSize,
      chunkCount: chunks.length,
      chunks,
      outputs: {
        instructions: instructionsFile,
        assembledRoot: path.join(handoffDir, 'assembled'),
        summary: path.join(handoffDir, 'handoff-summary.json'),
      },
      safety: {
        payloadRead: false,
        payloadWrite: false,
        payloadPatchRequests: 0,
        directPostgresqlWrite: false,
        modifiesWorks: false,
        publishesRatings: false,
        onlyWritesUnderDataLocal: true,
      },
    }
    writeJson(handoffManifestFile, handoffManifest)
    writeText(instructionsFile, researchInstructions(packageId, batchId, waveId))
    writeJson(handoffManifest.outputs.summary, {
      generatedAt: handoffManifest.generatedAt,
      version: RESEARCH_HANDOFF_VERSION,
      adapterVersion: VERSION,
      packageId,
      batchId,
      inventoryWaveId: waveId,
      rowCount: transformed.length,
      chunkSize,
      chunkCount: chunks.length,
      firstWorkId: val(transformed[0]?.workId),
      lastWorkId: val(transformed.at(-1)?.workId),
      outputDirectory: handoffDir,
      handoffManifest: handoffManifestFile,
      firstUploadFile: chunks[0]?.inputFile || null,
      safety: handoffManifest.safety,
    })

    batches.push({
      batchId,
      inventoryWaveId: waveId,
      queue: 'external_research',
      index: waveIndex,
      rowCount: transformed.length,
      chunkCount: chunks.length,
      firstWorkId: val(transformed[0]?.workId),
      lastWorkId: val(transformed.at(-1)?.workId),
      file: sourceWaveFile,
      sha256: sha256Text(sourceText),
      handoffDirectory: handoffDir,
      handoffManifest: handoffManifestFile,
      independentlyRecoverable: true,
    })
  }

  const expectedIds = researchBatch.map((row) => val(row.workId))
  if (JSON.stringify(concatenated) !== JSON.stringify(expectedIds)) throw new Error('All waves do not concatenate to the accepted research batch')

  const catalogManifest = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    inputSha256: expectedSourceBundleSha256,
    sourceReviewBundleSha256: expectedReviewBundleSha256 || undefined,
    packageId,
    queue: 'external_research',
    rowCount: batchSize,
    batches,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      publishesRatings: false,
      productionApplyPackageGenerated: false,
    },
  }
  const catalogManifestFile = path.join(outputDir, 'catalog-batch-manifest-v01.json')
  writeJson(catalogManifestFile, catalogManifest)
  writeText(path.join(outputDir, 'RESEARCH_INSTRUCTIONS.md'), topInstructions(packageId, batches))

  const packageManifestFile = path.join(outputDir, 'package-manifest.json')
  const packageManifest = {
    generatedAt: catalogManifest.generatedAt,
    version: VERSION,
    packageId,
    source: {
      reviewDirectory: reviewDir,
      sourceBundleSha256: expectedSourceBundleSha256,
      reviewBundleSha256: expectedReviewBundleSha256 || undefined,
      inventoryVersion: context.inventoryVersion,
      inventoryBranchHead: context.sourceBranchHead,
    },
    counts: {
      researchRows: batchSize,
      subwaves: expectedWaveCount,
      rowsPerSubwave: waveSize,
      chunkSize,
      chunksPerSubwave: waveSize / chunkSize,
      totalChunks: batchSize / chunkSize,
    },
    batches,
    outputs: {
      catalogManifest: catalogManifestFile,
      handoffRoot,
      instructions: path.join(outputDir, 'RESEARCH_INSTRUCTIONS.md'),
    },
    validation: {
      reviewManifestVerified: true,
      inventorySummaryAccepted: true,
      independentAuditAccepted: true,
      researchBatchIdentityComplete: true,
      researchBatchUnique: true,
      wavesMatchResearchBatchExactly: true,
      waveHashesAccepted: true,
      assemblerCompatibilityVersion: RESEARCH_HANDOFF_VERSION,
    },
    safety: catalogManifest.safety,
  }
  writeJson(packageManifestFile, packageManifest)

  const files = fs.readdirSync(outputDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(outputDir, path.join(entry.parentPath || entry.path, entry.name)))
    .filter((file) => !['SHA256SUMS', 'package-manifest.json'].includes(file.replaceAll('\\', '/')))
    .sort()
  packageManifest.files = files.map((file) => fileEntry(outputDir, file))
  writeJson(packageManifestFile, packageManifest)
  const sums = [...packageManifest.files, fileEntry(outputDir, 'package-manifest.json')]
    .map((entry) => `${entry.sha256}  ${entry.file}`)
    .join('\n') + '\n'
  writeText(path.join(outputDir, 'SHA256SUMS'), sums)
  return packageManifest
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  assertReadOnlyArgs(args)
  const reviewDir = val(args['review-dir'])
  const outputDir = val(args['out-dir'])
  if (!reviewDir) throw new Error('--review-dir is required')
  if (!outputDir) throw new Error('--out-dir is required')
  const manifest = buildInventoryResearchHandoff({
    reviewDir,
    outputDir,
    expectedSourceBundleSha256: val(args['expected-source-bundle-sha256']),
    expectedReviewBundleSha256: val(args['expected-review-bundle-sha256']),
    actualReviewBundleSha256: val(args['actual-review-bundle-sha256']),
    packageId: val(args['package-id']) || DEFAULT_PACKAGE_ID,
    batchPrefix: val(args['batch-prefix']) || DEFAULT_BATCH_PREFIX,
    batchSize: integerArg(args['batch-size'], 2500, 'batch-size'),
    waveSize: integerArg(args['wave-size'], 250, 'wave-size'),
    chunkSize: integerArg(args['chunk-size'], 5, 'chunk-size'),
  })
  console.log('Radar inventory research handoff complete')
  console.log(`PackageId: ${manifest.packageId}`)
  console.log(`ResearchRows: ${manifest.counts.researchRows}`)
  console.log(`Subwaves: ${manifest.counts.subwaves}`)
  console.log(`Chunks: ${manifest.counts.totalChunks}`)
  console.log('PayloadWrite: False')
  console.log('PostgreSQLWrite: False')
  console.log('RatingsPublished: False')
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === invoked) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
