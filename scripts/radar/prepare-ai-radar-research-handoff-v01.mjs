#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import {
  DEFAULT_RESEARCH_CHUNK_SIZE,
  RESEARCH_HANDOFF_VERSION,
  chunkResearchRows,
  parseResearchChunkSize,
  selectResearchBatch,
  validateResearchBatchSource,
} from './lib/research-handoff-v01.mjs'
import {
  assertUnderDataLocal,
  jsonlText,
  sha256Text,
  val,
} from './lib/assessment-handoff-v01.mjs'

const DEFAULT_CATALOG_MANIFEST = 'data_local/staging/ai-radar/catalog-v01/queue/catalog-batch-manifest-v01.json'
const DEFAULT_OUTPUT_ROOT = 'data_local/staging/ai-radar/research-handoffs-v01'

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
  const slug = safeSlug(batchId)
  return [
    `# ${batchId} 外部研究交接包`,
    '',
    '本目录只处理本地 JSONL，不会写入 Payload 或 PostgreSQL。',
    '',
    '## 处理顺序',
    '',
    '按照 handoff-manifest.json 的顺序，逐个上传 chunks 目录下的 input.jsonl。',
    '每个输入块都要生成一个同名 output.jsonl，并放入 responses 目录。',
    '',
    '示例：',
    '',
    '```text',
    `chunks/${slug}-chunk-0001.input.jsonl`,
    `responses/${slug}-chunk-0001.output.jsonl`,
    '```',
    '',
    '## 给 ChatGPT 的研究任务',
    '',
    '对每部作品联网核对身份、剧情、女性关系、男性介入、NTR、结局、成人内容和特殊设定。',
    '',
    '要求：',
    '',
    '- 优先官方页面、出版社、开发商、原作材料和可靠数据库；社区来源只能作为补充；',
    '- 不把标题相似当作同一作品，身份不确定时进入 identity_review；',
    '- 不伪造剧情、结局、角色关系、来源或访问结果；',
    '- 找不到充分资料时使用 needs_more_research，不要硬判可评级；',
    '- 不直接给 S/A/B/C/D/E/F 等级，这一步只补充事实证据；',
    '- 每个输入行必须对应且只对应一个输出行；',
    '- workId 和 siteId 必须原样保留；',
    '- 输出必须是纯 JSONL，不添加 Markdown 围栏或说明文字。',
    '',
    '## 每行输出格式',
    '',
    '```json',
    '{"workId":"123","siteId":"work:example","title":"作品名","identityStatus":"confirmed","researchStatus":"ready_for_ai_assessment","evidenceCoverage":0.7,"evidenceStatus":"multiple_secondary_supported","sourceSummary":"身份与主要关系由多个来源支持，结局仍有少量缺口。","contentSummary":"包含剧透的剧情摘要。","relationshipSummary":"女性角色关系、恋爱进展与主要冲突。","endingSummary":"结局或当前连载状态。","riskFindings":{"femaleFemaleRelationship":"confirmed","maleInvolvement":"none_found","ntrRisk":"none_found","endingStatus":"positive","adultContent":"none_found","settingProfiles":[]},"sources":[{"label":"来源名称","url":"https://example.invalid/source","sourceType":"secondary","supports":["identity","relationship","ending"]}],"contradictions":[],"unresolvedQuestions":[],"researchNotes":[]}',
    '```',
    '',
    'identityStatus：confirmed / ambiguous / not_found / conflicting',
    '',
    'researchStatus：ready_for_ai_assessment / needs_more_research / identity_review',
    '',
    'evidenceStatus 沿用评估证据状态：',
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
    '只有身份 confirmed、证据状态足够、覆盖率至少 0.35 且含可追溯来源时，才能使用 ready_for_ai_assessment。',
    '',
    '## 完成后组装',
    '',
    '```powershell',
    `node scripts/radar/assemble-ai-radar-research-handoff-v01.mjs --batch-id ${batchId} --out-dir <本交接根目录>`,
    '```',
    '',
    '组装器会验证来源批次 SHA-256、全部身份、响应完整性、来源 URL 和研究状态，并为可评级行生成兼容现有评估器的 manifest。',
    '',
    `来源目录清单：${manifestFile}`,
    `本交接包清单：${handoffManifestFile}`,
    '',
  ].join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.write || args.patch || args.confirm || args.gate || args['approval-token']) {
    throw new Error('Research handoff preparation is local-only. Execute/apply/write/gate flags are rejected.')
  }

  const batchId = val(args['batch-id'])
  if (!batchId) throw new Error('--batch-id is required')
  const catalogManifestFile = val(args.manifest) || DEFAULT_CATALOG_MANIFEST
  const outputRoot = val(args['out-dir']) || DEFAULT_OUTPUT_ROOT
  const chunkSize = parseResearchChunkSize(args['chunk-size'] ?? DEFAULT_RESEARCH_CHUNK_SIZE)
  assertUnderDataLocal(catalogManifestFile)
  assertUnderDataLocal(outputRoot)
  if (!fs.existsSync(catalogManifestFile)) throw new Error(`Catalog batch manifest not found: ${catalogManifestFile}`)

  const catalogManifest = readJson(catalogManifestFile)
  const entry = selectResearchBatch(catalogManifest, batchId)
  const validation = validateResearchBatchSource(entry)
  if (validation.blockers.length) throw new Error(`Research batch validation failed: ${validation.blockers.join(', ')}`)

  const outputDir = path.join(outputRoot, safeSlug(batchId))
  assertUnderDataLocal(outputDir)
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(path.join(outputDir, 'chunks'), { recursive: true })
  fs.mkdirSync(path.join(outputDir, 'responses'), { recursive: true })

  const sourceText = jsonlText(validation.rows)
  const sourceCopy = path.join(outputDir, `${safeSlug(batchId)}.source.jsonl`)
  writeText(sourceCopy, sourceText)

  const chunks = chunkResearchRows(validation.rows, chunkSize)
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
    version: RESEARCH_HANDOFF_VERSION,
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
      instructions: path.join(outputDir, 'RESEARCH_INSTRUCTIONS.md'),
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
    version: RESEARCH_HANDOFF_VERSION,
    batchId,
    rowCount: validation.rows.length,
    chunkSize,
    chunkCount: chunkEntries.length,
    outputDirectory: outputDir,
    handoffManifest: handoffManifestFile,
    firstUploadFile: chunkEntries[0]?.inputFile || null,
    safety: handoffManifest.safety,
    nextStep: 'Upload research chunk input files in manifest order and save each JSONL response at its exact responseFile path.',
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
