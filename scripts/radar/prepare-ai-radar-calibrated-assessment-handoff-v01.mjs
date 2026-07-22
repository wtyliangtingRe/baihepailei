#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import {
  DEFAULT_CALIBRATION_REGISTRY,
  CALIBRATED_HANDOFF_VERSION,
  applyCalibrationProfile,
  loadCalibrationProfile,
} from './lib/calibration-profile-v01.mjs'
import {
  DEFAULT_CHUNK_SIZE,
  assertUnderDataLocal,
  chunkRows,
  jsonlText,
  parseChunkSize,
  selectAssessmentBatch,
  sha256Text,
  val,
  validateBatchSource,
} from './lib/assessment-handoff-v01.mjs'

const DEFAULT_CATALOG_MANIFEST = 'data_local/staging/ai-radar/catalog-v01/queue/catalog-batch-manifest-v01.json'
const DEFAULT_OUTPUT_ROOT = 'data_local/staging/ai-radar/calibrated-assessment-handoffs-v01'

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, value, 'utf8')
}

function safeSlug(value) {
  const slug = val(value).toLowerCase().replace(/[^a-z0-9_-]+/gu, '-')
  if (!slug) throw new Error('Batch id could not be converted to a safe directory name')
  return slug
}

function instructions(batchId, manifestFile, profile) {
  const batchSlug = batchId.toLowerCase()
  return [
    `# ${batchId} AI 排雷评估交接包（含站长校准）`,
    '',
    '本目录只在本地生成评估交接文件，不会写入 Payload 或 PostgreSQL。',
    '',
    '## 判断顺序',
    '',
    '1. 读取事实证据与可追溯来源。',
    '2. 按 radar-rating-policy-v0.4-draft 检查所有可能命中的规则。',
    `3. 读取校准档案 ${profile.profileId}，只把它作为模糊边界与严重度参考。`,
    '4. 输出全部实际命中规则和采用的校准信号。',
    '5. 结果仍为“AI 综合，待复核”，必须进入人工复核。',
    '',
    '## 校准安全边界',
    '',
    '- 事实证据优先；不得用个人倾向创造剧情、关系、性别、结局或来源。',
    '- pending、partial 和 tentative 样本不会进入 activePrinciples / relevantAnchors。',
    '- 校准只能解释规则边界，不能隐藏已确认的雷点。',
    '- X 级只能作为待人工裁决建议，不能自动发布。',
    '- 没有适用校准信号时，calibrationSignals 必须输出空数组。',
    '',
    '## 文件顺序',
    '',
    `上传 chunks/${batchSlug}-chunk-0001.input.jsonl，依次处理全部块。`,
    `结果保存为 responses/${batchSlug}-chunk-0001.output.jsonl。`,
    '',
    '## 每行输出格式',
    '',
    '```json',
    '{"workId":"123","siteId":"work:example","title":"作品名","evidenceCoverage":0.8,"evidenceStatus":"multiple_secondary_supported","sourceSummary":"证据摘要","ruleAssessments":[{"code":"B-LIGHT","matched":true,"confidence":0.82,"reason":"女性关系强度明确但恋爱尚未确立。","evidenceStatus":"multiple_secondary_supported","sources":[{"label":"来源","url":"https://example.invalid","sourceType":"secondary"}],"supportingEvidence":["证据"],"contradictingEvidence":[]}],"contradictions":[],"assessmentNotes":[],"calibrationProfileId":"site-owner-primary-v0.1","calibrationSignals":[{"type":"principle","id":"strong-female-bond-can-support-b-light","weight":1,"effect":"supported B-LIGHT","reason":"本作证据符合持续高强度女性关系。"}],"calibrationNotes":[]}',
    '```',
    '',
    '每个 workId 必须恰好输出一次；workId 和 siteId 必须原样保留。',
    '输出必须是纯 JSONL，不添加 Markdown 围栏或解释文字。',
    '',
    `交接清单：${manifestFile}`,
    `校准档案：${profile.profileFile}`,
    '',
  ].join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.write || args.patch || args.confirm || args.gate || args['approval-token']) {
    throw new Error('Calibrated assessment handoff preparation is local-only. Execute/apply/write/gate flags are rejected.')
  }

  const batchId = val(args['batch-id'])
  if (!batchId) throw new Error('--batch-id is required')
  const catalogManifestFile = val(args.manifest) || DEFAULT_CATALOG_MANIFEST
  const outputRoot = val(args['out-dir']) || DEFAULT_OUTPUT_ROOT
  const chunkSize = parseChunkSize(args['chunk-size'] ?? DEFAULT_CHUNK_SIZE)
  const registryFile = val(args['calibration-registry']) || DEFAULT_CALIBRATION_REGISTRY
  const requestedProfileId = val(args['calibration-profile-id'])
  assertUnderDataLocal(catalogManifestFile)
  assertUnderDataLocal(outputRoot)
  if (!fs.existsSync(catalogManifestFile)) throw new Error(`Catalog batch manifest not found: ${catalogManifestFile}`)

  const catalogManifest = readJson(catalogManifestFile)
  const entry = selectAssessmentBatch(catalogManifest, batchId)
  const validation = validateBatchSource(entry)
  if (validation.blockers.length) throw new Error(`Assessment batch validation failed: ${validation.blockers.join(', ')}`)

  const loadedProfile = loadCalibrationProfile(registryFile, requestedProfileId)
  const calibratedRows = applyCalibrationProfile(validation.rows, loadedProfile)
  const outputDir = path.join(outputRoot, safeSlug(batchId))
  assertUnderDataLocal(outputDir)
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(path.join(outputDir, 'chunks'), { recursive: true })
  fs.mkdirSync(path.join(outputDir, 'responses'), { recursive: true })

  const sourceText = jsonlText(calibratedRows)
  const sourceCopy = path.join(outputDir, `${safeSlug(batchId)}.calibrated-source.jsonl`)
  writeText(sourceCopy, sourceText)

  const chunks = chunkRows(calibratedRows, chunkSize)
  const chunkEntries = []
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    const chunkNumber = String(index + 1).padStart(4, '0')
    const chunkId = `${safeSlug(batchId)}-chunk-${chunkNumber}`
    const inputFile = path.join(outputDir, 'chunks', `${chunkId}.input.jsonl`)
    const responseFile = path.join(outputDir, 'responses', `${chunkId}.output.jsonl`)
    const text = jsonlText(chunk)
    writeText(inputFile, text)
    chunkEntries.push({
      chunkId,
      index: index + 1,
      rowCount: chunk.length,
      firstWorkId: val(chunk[0]?.workId),
      lastWorkId: val(chunk.at(-1)?.workId),
      inputFile,
      inputSha256: sha256Text(text),
      responseFile,
      expectedRows: chunk.map((row) => ({ workId: val(row?.workId), siteId: val(row?.siteId), title: val(row?.title) })),
    })
  }

  const handoffManifestFile = path.join(outputDir, 'handoff-manifest.json')
  const handoffManifest = {
    generatedAt: new Date().toISOString(),
    version: CALIBRATED_HANDOFF_VERSION,
    policyVersion: 'radar-rating-policy-v0.4-draft',
    batchId,
    queue: val(entry.queue),
    sourceCatalogManifest: catalogManifestFile,
    sourceCatalogInputSha256: val(catalogManifest?.inputSha256),
    sourceBatchFile: val(entry.file),
    sourceBatchSha256: val(entry.sha256),
    copiedSourceFile: sourceCopy,
    copiedSourceSha256: sha256Text(sourceText),
    rowCount: calibratedRows.length,
    chunkSize,
    chunkCount: chunkEntries.length,
    chunks: chunkEntries,
    calibration: {
      profileId: loadedProfile.profileId,
      profileWeight: loadedProfile.profileWeight,
      registryFile: loadedProfile.registryFile,
      registrySha256: loadedProfile.registrySha256,
      profileFile: loadedProfile.profileFile,
      profileSha256: loadedProfile.profileSha256,
      activePrinciples: loadedProfile.activePrinciples.length,
      activeAnchors: loadedProfile.activeAnchors.length,
      mode: 'advisory',
    },
    outputs: {
      instructions: path.join(outputDir, 'CALIBRATED_ASSESSMENT_INSTRUCTIONS.md'),
      assembledRoot: path.join(outputDir, 'assembled'),
      summary: path.join(outputDir, 'handoff-summary.json'),
    },
    safety: {
      payloadRead: false,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      onlyWritesUnderDataLocal: true,
      calibrationIsAdvisory: true,
      factsOverrideCalibration: true,
      publishesRatings: false,
    },
  }

  writeJson(handoffManifestFile, handoffManifest)
  writeText(handoffManifest.outputs.instructions, instructions(batchId, handoffManifestFile, {
    profileId: loadedProfile.profileId,
    profileFile: loadedProfile.profileFile,
  }))
  const summary = {
    generatedAt: handoffManifest.generatedAt,
    version: CALIBRATED_HANDOFF_VERSION,
    batchId,
    rowCount: calibratedRows.length,
    chunkSize,
    chunkCount: chunkEntries.length,
    outputDirectory: outputDir,
    handoffManifest: handoffManifestFile,
    firstUploadFile: chunkEntries[0]?.inputFile || null,
    calibration: handoffManifest.calibration,
    safety: handoffManifest.safety,
    nextStep: 'Upload calibrated chunk input files in manifest order and save each JSONL response at its exact responseFile path.',
  }
  writeJson(handoffManifest.outputs.summary, summary)
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

try { main() } catch (error) { console.error(error?.stack || error); process.exitCode = 1 }
