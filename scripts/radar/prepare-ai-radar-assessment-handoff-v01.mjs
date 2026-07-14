#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import {
  ASSESSMENT_HANDOFF_VERSION,
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
const DEFAULT_OUTPUT_ROOT = 'data_local/staging/ai-radar/assessment-handoffs-v01'

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

function instructions(batchId, manifestFile, handoffManifestFile) {
  const batchSlug = batchId.toLowerCase()
  return [
    `# ${batchId} AI 排雷评估交接包`,
    '',
    '本目录是只读评估交接包，不会写入 Payload 或 PostgreSQL。',
    '',
    '## 处理顺序',
    '',
    '按照 handoff-manifest.json 中的顺序，逐个上传 chunks 目录下的 input.jsonl。',
    '每个输入块都必须生成一个同名的 output.jsonl，并放入 responses 目录。',
    '',
    '示例：',
    '',
    '```text',
    `chunks/${batchSlug}-chunk-0001.input.jsonl`,
    `responses/${batchSlug}-chunk-0001.output.jsonl`,
    '```',
    '',
    '## 给 ChatGPT 的任务说明',
    '',
    '对输入中的每部作品按照 radar-rating-policy-v0.4-draft 进行排雷评估。',
    '',
    '要求：',
    '',
    '- 内部检查全部当前规则，但输出所有实际命中规则和重要冲突，不需要生成 55 条冗长的否定记录；',
    '- 同一作品可以命中多条规则；',
    '- 不把现有 rank 当作真值；',
    '- 不覆盖或弱化人工保护信息；',
    '- 不伪造来源、剧情、结局或角色关系；',
    '- 资料不足时诚实使用 insufficient_evidence 或 unknown；',
    '- 页面语义始终是“AI 综合，待复核”，不要使用“最终评级”；',
    '- 每个输入行必须对应且只对应一个输出行；',
    '- workId 和 siteId 必须原样保留；',
    '- 输出必须是纯 JSONL，不添加 Markdown 围栏或解释文字。',
    '',
    '## 每行输出格式',
    '',
    '```json',
    '{"workId":"123","siteId":"work:example","title":"作品名","evidenceCoverage":0.65,"evidenceStatus":"single_secondary_supported","sourceSummary":"基于现有简介与一个可追溯来源，结局覆盖仍不足。","ruleAssessments":[{"code":"A-NEAR-CONFIRMED","matched":true,"confidence":0.82,"reason":"两名女性主要角色之间存在明确恋爱指向。","evidenceStatus":"single_secondary_supported","sources":[{"label":"来源名称","url":"https://example.invalid/source","sourceType":"secondary"}],"supportingEvidence":["证据摘要"],"contradictingEvidence":[]}],"contradictions":[],"assessmentNotes":[]}',
    '```',
    '',
    '允许的 evidenceStatus：',
    '',
    '```text',
    'official_confirmed',
    'primary_material_confirmed',
    'multiple_secondary_supported',
    'single_secondary_supported',
    'community_consensus',
    'inferred_from_metadata',
    'conflicting_evidence',
    'insufficient_evidence',
    'unknown',
    '```',
    '',
    'confidence 和 evidenceCoverage 可以使用 0–1 或 0–100。',
    '无规则达到可靠命中时，ruleAssessments 可以是空数组，后续解析器会保守回退到 D-UNCLEAR。',
    '',
    '## 完成后组装',
    '',
    '```powershell',
    `pnpm radar:assemble-assessment-handoff -- --batch-id ${batchId}`,
    '```',
    '',
    '组装器会验证：',
    '',
    '- 来源批次 SHA-256；',
    '- 每个 workId 恰好出现一次；',
    '- siteId 完全一致；',
    '- 所有块均已返回；',
    '- 证据覆盖、证据状态、来源摘要和规则格式完整；',
    '- existingState 与 writeProtection 只能取自原始输入，不接受模型改写。',
    '',
    `来源目录清单：${manifestFile}`,
    `本交接包清单：${handoffManifestFile}`,
    '',
  ].join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.write || args.patch || args.confirm || args.gate || args['approval-token']) {
    throw new Error('Assessment handoff preparation is local-only. Execute/apply/write/gate flags are rejected.')
  }

  const batchId = val(args['batch-id'])
  if (!batchId) throw new Error('--batch-id is required')
  const catalogManifestFile = val(args.manifest) || DEFAULT_CATALOG_MANIFEST
  const outputRoot = val(args['out-dir']) || DEFAULT_OUTPUT_ROOT
  const chunkSize = parseChunkSize(args['chunk-size'] ?? DEFAULT_CHUNK_SIZE)
  assertUnderDataLocal(catalogManifestFile)
  assertUnderDataLocal(outputRoot)
  if (!fs.existsSync(catalogManifestFile)) throw new Error(`Catalog batch manifest not found: ${catalogManifestFile}`)

  const catalogManifest = readJson(catalogManifestFile)
  const entry = selectAssessmentBatch(catalogManifest, batchId)
  const validation = validateBatchSource(entry)
  if (validation.blockers.length) throw new Error(`Assessment batch validation failed: ${validation.blockers.join(', ')}`)

  const outputDir = path.join(outputRoot, safeSlug(batchId))
  assertUnderDataLocal(outputDir)
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(path.join(outputDir, 'chunks'), { recursive: true })
  fs.mkdirSync(path.join(outputDir, 'responses'), { recursive: true })

  const sourceText = jsonlText(validation.rows)
  const sourceCopy = path.join(outputDir, `${safeSlug(batchId)}.source.jsonl`)
  writeText(sourceCopy, sourceText)

  const chunks = chunkRows(validation.rows, chunkSize)
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
      expectedRows: chunk.map((row) => ({
        workId: val(row?.workId),
        siteId: val(row?.siteId),
        title: val(row?.title),
      })),
    })
  }

  const handoffManifestFile = path.join(outputDir, 'handoff-manifest.json')
  const handoffManifest = {
    generatedAt: new Date().toISOString(),
    version: ASSESSMENT_HANDOFF_VERSION,
    policyVersion: 'radar-rating-policy-v0.4-draft',
    batchId,
    queue: val(entry.queue),
    sourceCatalogManifest: catalogManifestFile,
    sourceCatalogInputSha256: val(catalogManifest?.inputSha256),
    sourceBatchFile: val(entry.file),
    sourceBatchSha256: val(entry.sha256),
    copiedSourceFile: sourceCopy,
    copiedSourceSha256: sha256Text(sourceText),
    rowCount: validation.rows.length,
    chunkSize,
    chunkCount: chunkEntries.length,
    chunks: chunkEntries,
    outputs: {
      instructions: path.join(outputDir, 'ASSESSMENT_INSTRUCTIONS.md'),
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
    },
  }

  writeJson(handoffManifestFile, handoffManifest)
  writeText(handoffManifest.outputs.instructions, instructions(batchId, catalogManifestFile, handoffManifestFile))
  const summary = {
    generatedAt: handoffManifest.generatedAt,
    version: ASSESSMENT_HANDOFF_VERSION,
    batchId,
    rowCount: validation.rows.length,
    chunkSize,
    chunkCount: chunkEntries.length,
    outputDirectory: outputDir,
    handoffManifest: handoffManifestFile,
    firstUploadFile: chunkEntries[0]?.inputFile || null,
    safety: handoffManifest.safety,
    nextStep: 'Upload chunk input files in manifest order and save each JSONL response at its exact responseFile path.',
  }
  writeJson(handoffManifest.outputs.summary, summary)
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
}
