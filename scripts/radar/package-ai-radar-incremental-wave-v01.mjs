#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  INCREMENTAL_SUBWAVE_HANDOFF_VERSION,
  INCREMENTAL_WAVE_PACKAGE_VERSION,
  buildIncrementalWavePlan,
  jsonlText,
  sha256Text,
} from './lib/incremental-wave-package-v01.mjs'

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }

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

function assertUnderDataLocal(target) {
  const root = path.resolve('data_local')
  const resolved = path.resolve(target)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Incremental wave path must remain under data_local: ${target}`)
  }
  return resolved
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

function readJsonl(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  if (!text) return []
  return text.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) } catch (error) { throw new Error(`Invalid JSONL at ${file}:${index + 1}: ${error.message}`) }
  })
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, value, 'utf8')
}

function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`)
}

function relative(root, file) {
  return path.relative(root, file).replace(/\\/gu, '/')
}

function listFiles(root) {
  const output = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else output.push(file)
    }
  }
  visit(root)
  return output.sort((a, b) => a.localeCompare(b))
}

function packageInstructions(waveId, plan) {
  return [
    `# ${waveId}｜2500 条增量研究包`,
    '',
    `本包包含 ${plan.subwaveCount} 个可独立恢复子波次，每个最多 ${plan.subwaveSize} 条；每个研究块最多 ${plan.chunkSize} 条。`,
    '',
    '## 处理规则',
    '',
    '- 先验证 SHA256SUMS.txt 和 package-manifest.json；',
    '- 按 subwaves/subwave-XXXX/handoff-manifest.json 处理；',
    '- 每完成一个子波次立即生成该子波次结果与检查点；',
    '- 已完成且哈希匹配的子波次在重复执行时必须跳过；',
    '- 某个子波次失败时只重跑该子波次，不使其他子波次失效；',
    '- 最终允许输出 partial 包，但不得把缺失子波次标记为完成；',
    '- workId 和 siteId 必须原样保留；',
    '- 不写 Payload、PostgreSQL、Works 或人工审核线；',
    '- reassessments 不占 2500 条联网研究容量，复用已有研究证据。',
    '',
    '## 返回结果',
    '',
    `返回一个 ${waveId}-complete-results-v01.zip，包含各子波次结果、重试请求、重新评级结果、聚合摘要和 SHA-256 清单。`,
    '',
  ].join('\n')
}

export function packageIncrementalWave(options) {
  const selectionFile = assertUnderDataLocal(options.selectionFile)
  const selectionSummaryFile = assertUnderDataLocal(options.selectionSummaryFile)
  const reassessmentFile = options.reassessmentFile ? assertUnderDataLocal(options.reassessmentFile) : null
  const ledgerFile = options.ledgerFile ? assertUnderDataLocal(options.ledgerFile) : null
  const testOutputFile = options.testOutputFile ? assertUnderDataLocal(options.testOutputFile) : null
  const outputDir = assertUnderDataLocal(options.outputDir)
  for (const required of [selectionFile, selectionSummaryFile]) {
    if (!fs.existsSync(required)) throw new Error(`Required incremental input missing: ${required}`)
  }
  for (const optional of [reassessmentFile, ledgerFile, testOutputFile]) {
    if (optional && !fs.existsSync(optional)) throw new Error(`Optional incremental input was specified but missing: ${optional}`)
  }

  const rows = readJsonl(selectionFile)
  const selectionSummary = readJson(selectionSummaryFile)
  const reassessmentRows = reassessmentFile ? readJsonl(reassessmentFile) : []
  const plan = buildIncrementalWavePlan(rows, options)
  if (Number(selectionSummary?.selectedResearchRows) !== rows.length) {
    throw new Error('Selection summary research count does not match selection JSONL')
  }
  if (list(selectionSummary?.safety).length) throw new Error('Selection safety must be an object, not an array')
  if (selectionSummary?.safety?.payloadWrite !== false || selectionSummary?.safety?.directPostgresqlWrite !== false || Number(selectionSummary?.safety?.humanTrackMutations) !== 0) {
    throw new Error('Selection safety declaration is not read-only')
  }

  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  const selectionDir = path.join(outputDir, 'selection')
  const reassessmentDir = path.join(outputDir, 'reassessments')
  const retriesDir = path.join(outputDir, 'retries')
  writeText(path.join(selectionDir, 'incremental-research-selection-v01.jsonl'), jsonlText(rows))
  writeText(path.join(selectionDir, 'incremental-new-research-v01.jsonl'), jsonlText(rows.filter((row) => val(row?.incrementalSelection?.action) === 'research_new')))
  writeText(path.join(retriesDir, 'incremental-retry-research-v01.jsonl'), jsonlText(rows.filter((row) => val(row?.incrementalSelection?.action) !== 'research_new')))
  writeJson(path.join(selectionDir, 'incremental-selection-summary-v01.json'), selectionSummary)
  writeText(path.join(reassessmentDir, 'incremental-reassessment-selection-v01.jsonl'), jsonlText(reassessmentRows))
  if (ledgerFile) fs.copyFileSync(ledgerFile, path.join(selectionDir, 'processing-ledger-snapshot-v01.jsonl'))
  if (testOutputFile) fs.copyFileSync(testOutputFile, path.join(outputDir, 'test-output.txt'))
  writeText(path.join(outputDir, 'RESEARCH_INSTRUCTIONS.md'), packageInstructions(plan.waveId, plan))

  const subwaveEntries = []
  for (const subwave of plan.subwaves) {
    const slug = `subwave-${String(subwave.index).padStart(4, '0')}`
    const subwaveDir = path.join(outputDir, 'subwaves', slug)
    const sourceFile = path.join(subwaveDir, `${slug}.source.jsonl`)
    const sourceText = jsonlText(subwave.rows)
    writeText(sourceFile, sourceText)
    const chunkEntries = []
    for (const chunk of subwave.chunks) {
      const chunkSlug = `${slug}-chunk-${String(chunk.index).padStart(4, '0')}`
      const inputFile = path.join(subwaveDir, 'chunks', `${chunkSlug}.input.jsonl`)
      const chunkText = jsonlText(chunk.rows)
      writeText(inputFile, chunkText)
      chunkEntries.push({
        chunkId: chunk.chunkId,
        index: chunk.index,
        rowCount: chunk.rowCount,
        firstWorkId: chunk.firstWorkId,
        lastWorkId: chunk.lastWorkId,
        inputFile: relative(outputDir, inputFile),
        inputSha256: sha256Text(chunkText),
        responseFile: `subwave-results/${slug}/responses/${chunkSlug}.output.jsonl`,
        expectedRows: chunk.rows.map((row) => ({ workId: val(row?.workId), siteId: val(row?.siteId), title: val(row?.title) })),
      })
    }
    const checkpointSeedFile = path.join(subwaveDir, 'checkpoint-seed.json')
    writeJson(checkpointSeedFile, {
      generatedAt: new Date().toISOString(),
      version: 'ai-radar-incremental-subwave-checkpoint-seed-v0.1',
      waveId: plan.waveId,
      subwaveId: subwave.subwaveId,
      subwaveIndex: subwave.index,
      state: 'pending',
      expectedRows: subwave.rowCount,
      completedRows: 0,
      completedChunkIds: [],
      retryChunkIds: [],
      sourceSha256: sha256Text(sourceText),
      safety: { payloadWrite: false, directPostgresqlWrite: false, modifiesWorks: false, humanTrackMutations: 0 },
    })
    const manifestFile = path.join(subwaveDir, 'handoff-manifest.json')
    const manifest = {
      generatedAt: new Date().toISOString(),
      version: INCREMENTAL_SUBWAVE_HANDOFF_VERSION,
      waveId: plan.waveId,
      subwaveId: subwave.subwaveId,
      subwaveIndex: subwave.index,
      queue: 'incremental_external_research',
      state: 'pending',
      rowCount: subwave.rowCount,
      chunkSize: plan.chunkSize,
      chunkCount: subwave.chunkCount,
      firstWorkId: subwave.firstWorkId,
      lastWorkId: subwave.lastWorkId,
      byAction: subwave.byAction,
      sourceFile: relative(outputDir, sourceFile),
      sourceSha256: sha256Text(sourceText),
      checkpointSeedFile: relative(outputDir, checkpointSeedFile),
      chunks: chunkEntries,
      recovery: {
        identity: `${plan.waveId}|${subwave.subwaveId}|${sha256Text(sourceText)}`,
        completedState: 'complete',
        partialState: 'partial',
        failedState: 'failed',
        rerunRule: 'skip_only_when_subwave_result_manifest_and_all_declared_hashes_match',
      },
      safety: { payloadRead: false, payloadWrite: false, directPostgresqlWrite: false, modifiesWorks: false, publishesRatings: false, humanTrackMutations: 0, onlyLocalArtifacts: true },
    }
    writeJson(manifestFile, manifest)
    subwaveEntries.push({
      subwaveId: subwave.subwaveId,
      subwaveIndex: subwave.index,
      state: 'pending',
      rowCount: subwave.rowCount,
      chunkCount: subwave.chunkCount,
      firstWorkId: subwave.firstWorkId,
      lastWorkId: subwave.lastWorkId,
      byAction: subwave.byAction,
      manifestFile: relative(outputDir, manifestFile),
      manifestSha256: sha256Text(`${JSON.stringify(manifest, null, 2)}\n`),
      sourceFile: relative(outputDir, sourceFile),
      sourceSha256: sha256Text(sourceText),
    })
  }

  const recoveryPlanFile = path.join(outputDir, 'recovery-plan.json')
  writeJson(recoveryPlanFile, {
    generatedAt: new Date().toISOString(),
    version: 'ai-radar-incremental-wave-recovery-plan-v0.1',
    waveId: plan.waveId,
    aggregateState: 'pending',
    allowedSubwaveStates: ['pending', 'partial', 'complete', 'failed'],
    subwaves: subwaveEntries.map((item) => ({ subwaveId: item.subwaveId, subwaveIndex: item.subwaveIndex, state: 'pending', manifestSha256: item.manifestSha256 })),
    rules: {
      persistAfterEachSubwave: true,
      skipCompletedSubwavesOnRerun: true,
      retryOnlyFailedOrPartialSubwaves: true,
      requireExactIdentitySetBeforeAggregateComplete: true,
      allowPartialAggregatePackage: true,
      partialPackageMustDeclareMissingSubwaves: true,
    },
  })

  const payloadFiles = listFiles(outputDir).filter((file) => !['package-manifest.json', 'SHA256SUMS.txt'].includes(path.basename(file)))
  const packageId = val(options.packageId) || `${plan.waveId}-input-v01`
  const packageManifestFile = path.join(outputDir, 'package-manifest.json')
  const packageManifest = {
    generatedAt: new Date().toISOString(),
    version: INCREMENTAL_WAVE_PACKAGE_VERSION,
    packageId,
    waveId: plan.waveId,
    mode: 'incremental_subwave_recoverable',
    targetRows: plan.targetRows,
    selectedResearchRows: plan.selectedRows,
    selectedNewRows: plan.newRows,
    selectedRetryRows: plan.retryRows,
    reassessmentRows: reassessmentRows.length,
    subwaveSize: plan.subwaveSize,
    subwaveCount: plan.subwaveCount,
    chunkSize: plan.chunkSize,
    totalChunkCount: plan.subwaves.reduce((sum, item) => sum + item.chunkCount, 0),
    byAction: plan.byAction,
    source: {
      selectionFile: relative(outputDir, path.join(selectionDir, 'incremental-research-selection-v01.jsonl')),
      selectionSha256: sha256Text(jsonlText(rows)),
      selectionSummaryFile: relative(outputDir, path.join(selectionDir, 'incremental-selection-summary-v01.json')),
      ledgerSnapshotFile: ledgerFile ? relative(outputDir, path.join(selectionDir, 'processing-ledger-snapshot-v01.jsonl')) : null,
    },
    subwaves: subwaveEntries,
    reassessments: {
      file: relative(outputDir, path.join(reassessmentDir, 'incremental-reassessment-selection-v01.jsonl')),
      rowCount: reassessmentRows.length,
      consumesResearchCapacity: false,
    },
    recoveryPlanFile: relative(outputDir, recoveryPlanFile),
    files: payloadFiles.map((file) => ({ path: relative(outputDir, file), sha256: sha256Text(fs.readFileSync(file)), bytes: fs.statSync(file).size })),
    requestedCompletion: {
      mode: 'ten_independent_subwaves_then_one_aggregate_result',
      returnPackage: `${plan.waveId}-complete-results-v01.zip`,
      persistAfterEachSubwave: true,
      partialPackageAllowed: true,
      completedSubwavesMustBeSkippedOnRerun: true,
      stages: ['external_research', 'research_assembly', 'calibrated_ai_assessment', 'ai_qa', 'targeted_defer_partition', 'ledger_checkpoint'],
    },
    safety: { payloadRead: false, payloadWrite: false, directPostgresqlWrite: false, modifiesWorks: false, publishesRatings: false, humanTrackMutations: 0, onlyLocalArtifacts: true },
    nextStep: 'Upload this single ZIP. Do not upload the 500 individual research chunks.',
  }
  writeJson(packageManifestFile, packageManifest)

  const hashFiles = listFiles(outputDir).filter((file) => path.basename(file) !== 'SHA256SUMS.txt')
  const hashText = hashFiles.map((file) => `${sha256Text(fs.readFileSync(file))}  ${relative(outputDir, file)}`).join('\n') + '\n'
  writeText(path.join(outputDir, 'SHA256SUMS.txt'), hashText)

  return {
    generatedAt: packageManifest.generatedAt,
    version: packageManifest.version,
    packageId,
    waveId: plan.waveId,
    outputDir,
    selectedResearchRows: plan.selectedRows,
    selectedNewRows: plan.newRows,
    selectedRetryRows: plan.retryRows,
    reassessmentRows: reassessmentRows.length,
    subwaveCount: plan.subwaveCount,
    totalChunkCount: packageManifest.totalChunkCount,
    byAction: plan.byAction,
    packageManifest: packageManifestFile,
    safety: packageManifest.safety,
  }
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.execute || args.publish || args.patch || args.gate || args['approval-token']) {
    throw new Error('Incremental wave packaging is local-only. Publish/patch/gate flags are rejected.')
  }
  const selectionFile = val(args.selection)
  const selectionSummaryFile = val(args['selection-summary'])
  const outputDir = val(args['out-dir'])
  const waveId = val(args['wave-id'])
  if (!selectionFile || !selectionSummaryFile || !outputDir || !waveId) {
    throw new Error('--selection, --selection-summary, --out-dir and --wave-id are required')
  }
  const summary = packageIncrementalWave({
    selectionFile,
    selectionSummaryFile,
    reassessmentFile: val(args.reassessments) || null,
    ledgerFile: val(args.ledger) || null,
    testOutputFile: val(args['test-output']) || null,
    outputDir,
    waveId,
    packageId: val(args['package-id']) || null,
    targetRows: Number(args['target-rows'] ?? 2500),
    subwaveSize: Number(args['subwave-size'] ?? 250),
    chunkSize: Number(args['chunk-size'] ?? 5),
  })
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

const isDirectInvocation = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isDirectInvocation) {
  try { main() } catch (error) { console.error(error?.stack || error); process.exitCode = 1 }
}
