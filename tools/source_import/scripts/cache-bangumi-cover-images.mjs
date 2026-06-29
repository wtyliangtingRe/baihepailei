#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseJsonl, writeJsonFile } from '../lib/jsonl.mjs'

const DEFAULT_INPUTS = [
  path.join('data_local', 'payload', 'bangumi-work-entity-link-preview.json'),
  path.join('data_local', 'payload', 'bangumi-work-entity-link-patch-plan.json'),
  path.join('data_local', 'import_ready', 'bangumi-yuri-tagged.payload.json'),
  path.join('data_local', 'raw', 'bangumi-yuri-tagged.jsonl'),
]
const DEFAULT_MANIFEST = path.join('data_local', 'media', 'bangumi-covers', 'manifest.json')
const DEFAULT_OUTPUT_DIR = path.join('data_local', 'media', 'bangumi-covers', 'files')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-cover-cache.md')
const DEFAULT_TOP_LIMIT = 100
const DEFAULT_DELAY_MS = 300
const DEFAULT_USER_AGENT = 'BaihepaileiCoverCache/0.1 (https://github.com/wtyliangtingRe/baihepailei)'
const REPORT_UTF8_BOM = '\uFEFF'
const IMAGE_PRIORITY = ['large', 'common', 'medium', 'grid', 'small']

function parseArgs(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : 'true'
    args.set(key, value)
    if (value !== 'true') index += 1
  }
  return args
}

function cleanText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\r?\n/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function rows(value) {
  return Array.isArray(value) ? value : []
}

function parseCsv(value, fallback = []) {
  if (!value) return fallback
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function numberArg(args, key, fallback) {
  const value = Number(args.get(key) ?? fallback)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

function boolArg(args, key, fallback = false) {
  if (!args.has(key)) return fallback
  const value = String(args.get(key)).trim().toLowerCase()
  return ['1', 'true', 'yes', 'y', 'on'].includes(value)
}

function escapeMarkdownCell(value) {
  return cleanText(value).replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function fileExists(filePath) {
  return access(filePath).then(() => true).catch(() => false)
}

function subjectId(value) {
  const id = value?.bangumiSubjectId
    ?? value?.externalIds?.bangumiSubjectId
    ?? value?.sourceRecordId
    ?? value?.id
    ?? value?.subject_id
    ?? value?.raw?.id
    ?? value?.raw?.subject_id
  return id === undefined || id === null || id === '' ? '' : String(id)
}

function subjectTitle(value) {
  return cleanText(
    value?.title
    || value?.name_cn
    || value?.name
    || value?.raw?.name_cn
    || value?.raw?.name
    || value?.work?.title,
  )
}

function subjectType(value) {
  const type = value?.type ?? value?.raw?.type ?? value?.mediaType ?? value?.work?.mediaType
  return type === undefined || type === null ? '' : String(type)
}

function imageCandidatesFromImages(images) {
  const candidates = []
  if (!images || typeof images !== 'object') return candidates
  for (const key of IMAGE_PRIORITY) {
    const url = cleanText(images[key])
    if (url) candidates.push({ kind: key, url })
  }
  return candidates
}

function imageCandidatesFromSourceLinks(sourceLinks) {
  return rows(sourceLinks)
    .map((source) => ({ kind: cleanText(source?.label || source?.source || 'source'), url: cleanText(source?.url) }))
    .filter((item) => /\.(?:jpg|jpeg|png|webp)(?:$|[?#])/iu.test(item.url))
}

function imageCandidates(value) {
  return [
    ...imageCandidatesFromImages(value?.images),
    ...imageCandidatesFromImages(value?.image),
    ...imageCandidatesFromImages(value?.raw?.images),
    ...imageCandidatesFromImages(value?.raw?.image),
    ...imageCandidatesFromSourceLinks(value?.sourceLinks),
    ...imageCandidatesFromSourceLinks(value?.candidateSources),
  ]
}

function extFromUrl(url) {
  try {
    const pathname = new URL(url).pathname
    const ext = path.extname(pathname).toLowerCase().replace(/[^.a-z0-9]/giu, '')
    return ext || '.jpg'
  } catch {
    return '.jpg'
  }
}

function safeFileStem({ id, title, url }) {
  const hash = createHash('sha1').update(`${id}|${title}|${url}`).digest('hex').slice(0, 12)
  const normalizedTitle = cleanText(title)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60)
  return [id ? `bgm-${id}` : 'bgm-unknown', normalizedTitle, hash].filter(Boolean).join('-')
}

function normalizeUrl(url) {
  const trimmed = cleanText(url)
  if (!trimmed) return ''
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  return trimmed
}

function coverEntryFromSubject(value, { sourcePath = '' } = {}) {
  const id = subjectId(value)
  const title = subjectTitle(value)
  const type = subjectType(value)
  const candidates = imageCandidates(value).map((item) => ({ ...item, url: normalizeUrl(item.url) })).filter((item) => item.url)
  const selected = candidates[0] || null
  if (!selected) return null
  const ext = extFromUrl(selected.url)
  return {
    bangumiSubjectId: id,
    title,
    type,
    selectedImageKind: selected.kind,
    imageUrl: selected.url,
    candidateImages: candidates,
    relativePath: path.join('files', `${safeFileStem({ id, title, url: selected.url })}${ext}`).replace(/\\/gu, '/'),
    sourcePath,
  }
}

function collectObjects(value, output = []) {
  if (!value || typeof value !== 'object') return output
  if (!Array.isArray(value)) output.push(value)
  for (const item of Object.values(value)) {
    if (!item || typeof item !== 'object') continue
    if (Array.isArray(item)) item.forEach((row) => collectObjects(row, output))
    else collectObjects(item, output)
  }
  return output
}

export function buildBangumiCoverManifestFromRecords(records, { sourcePath = '' } = {}) {
  const byKey = new Map()
  for (const record of rows(records)) {
    const objects = collectObjects(record, [])
    for (const object of objects) {
      const entry = coverEntryFromSubject(object, { sourcePath })
      if (!entry) continue
      const key = entry.bangumiSubjectId || entry.imageUrl
      if (!key || byKey.has(key)) continue
      byKey.set(key, entry)
    }
  }
  return [...byKey.values()].sort((a, b) => Number(a.bangumiSubjectId || 0) - Number(b.bangumiSubjectId || 0))
}

async function readRecords(filePath) {
  const resolved = path.resolve(filePath)
  const text = await readFile(resolved, 'utf8')
  if (filePath.endsWith('.jsonl')) return parseJsonl(text, { sourcePath: resolved })
  const json = JSON.parse(text.replace(/^\uFEFF/u, ''))
  if (Array.isArray(json)) return json
  if (Array.isArray(json.records)) return json.records
  if (Array.isArray(json.subjects)) return json.subjects
  if (Array.isArray(json.works)) return json.works
  return [json]
}

export async function buildBangumiCoverManifest({ inputs = DEFAULT_INPUTS } = {}) {
  const manifests = []
  const missingInputs = []

  for (const input of inputs) {
    const resolved = path.resolve(input)
    if (!(await fileExists(resolved))) {
      missingInputs.push(resolved)
      continue
    }
    const records = await readRecords(resolved)
    manifests.push(...buildBangumiCoverManifestFromRecords(records, { sourcePath: resolved }))
  }

  const byKey = new Map()
  for (const entry of manifests) {
    const key = entry.bangumiSubjectId || entry.imageUrl
    if (!key || byKey.has(key)) continue
    byKey.set(key, entry)
  }

  return {
    meta: {
      source: 'bangumi-cover-cache-manifest',
      mode: 'manifest-only-no-payload-write',
      generatedAt: new Date().toISOString(),
      inputs: inputs.map((input) => path.resolve(input)),
      missingInputs,
      coversTotal: byKey.size,
    },
    covers: [...byKey.values()],
  }
}

async function downloadOne(entry, { outputDir, userAgent = DEFAULT_USER_AGENT, overwrite = false } = {}) {
  const outputPath = path.resolve(outputDir, entry.relativePath.replace(/^files\//u, ''))
  if (!overwrite && await fileExists(outputPath)) {
    return { ...entry, outputPath, status: 'skipped-existing', bytes: 0 }
  }

  const response = await fetch(entry.imageUrl, {
    headers: {
      'User-Agent': userAgent,
      Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
    },
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }

  const contentType = response.headers.get('content-type') || ''
  const buffer = Buffer.from(await response.arrayBuffer())
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, buffer)
  return { ...entry, outputPath, status: 'downloaded', bytes: buffer.length, contentType }
}

export async function cacheBangumiCovers(manifest, {
  outputDir = DEFAULT_OUTPUT_DIR,
  limit = 0,
  delayMs = DEFAULT_DELAY_MS,
  overwrite = false,
  userAgent = DEFAULT_USER_AGENT,
} = {}) {
  const covers = limit > 0 ? rows(manifest?.covers).slice(0, limit) : rows(manifest?.covers)
  const results = []

  for (const entry of covers) {
    try {
      results.push(await downloadOne(entry, { outputDir, userAgent, overwrite }))
    } catch (error) {
      results.push({ ...entry, status: 'error', error: String(error?.message || error) })
    }
    if (delayMs > 0) await sleep(delayMs)
  }

  const downloaded = results.filter((row) => row.status === 'downloaded').length
  const skipped = results.filter((row) => row.status === 'skipped-existing').length
  const errors = results.filter((row) => row.status === 'error').length
  const bytes = results.reduce((sum, row) => sum + Number(row.bytes || 0), 0)

  return {
    meta: {
      source: 'bangumi-cover-cache',
      mode: 'download-local-files-no-payload-write',
      generatedAt: new Date().toISOString(),
      outputDir: path.resolve(outputDir),
      coversTotal: covers.length,
      downloaded,
      skipped,
      errors,
      bytes,
    },
    results,
  }
}

function reportTable(rowsToShow) {
  const rows = rowsToShow.length === 0 ? ['暂无。'] : [
    '| # | Subject | Title | Type | Image | Local path | Status |',
    '| ---: | --- | --- | --- | --- | --- | --- |',
    ...rowsToShow.map((row, index) => `| ${index + 1} | ${escapeMarkdownCell(row.bangumiSubjectId)} | ${escapeMarkdownCell(row.title)} | ${escapeMarkdownCell(row.type)} | ${escapeMarkdownCell(row.selectedImageKind || '')} | ${escapeMarkdownCell(row.relativePath || row.outputPath || '')} | ${escapeMarkdownCell(row.status || 'planned')} |`),
  ]
  return rows.join('\n')
}

export function createBangumiCoverCacheReport(result, { topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const meta = result.meta || {}
  const rowsToShow = rows(result.covers || result.results).slice(0, topLimit)
  return [
    '# Bangumi cover cache',
    '',
    `生成时间：${meta.generatedAt}`,
    '',
    '## 总览',
    '',
    `- 模式：${meta.mode}`,
    `- covers：${meta.coversTotal}`,
    meta.downloaded !== undefined ? `- downloaded：${meta.downloaded}` : '',
    meta.skipped !== undefined ? `- skipped existing：${meta.skipped}` : '',
    meta.errors !== undefined ? `- errors：${meta.errors}` : '',
    meta.bytes !== undefined ? `- bytes：${meta.bytes}` : '',
    meta.outputDir ? `- outputDir：\`${meta.outputDir}\`` : '',
    '',
    '## Sample',
    '',
    reportTable(rowsToShow),
    '',
    '## 安全说明',
    '',
    '- 本脚本只读取本地 Bangumi / Payload 预览 JSON。',
    '- 默认只生成 manifest，不下载。',
    '- 传入 `--download` 时只写入 `data_local/media/bangumi-covers`。',
    '- 不上传 Payload，不创建 media，不修改 works。',
    '- `data_local` 输出不要提交。',
    '',
  ].filter((line) => line !== '').join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputs = parseCsv(args.get('in'), DEFAULT_INPUTS)
  const manifestOut = args.get('manifest') || DEFAULT_MANIFEST
  const reportOut = args.get('report') || DEFAULT_REPORT
  const outputDir = args.get('dir') || DEFAULT_OUTPUT_DIR
  const topLimit = numberArg(args, 'top', DEFAULT_TOP_LIMIT)
  const limit = numberArg(args, 'limit', 0)
  const delayMs = numberArg(args, 'delay-ms', DEFAULT_DELAY_MS)
  const download = boolArg(args, 'download', false)
  const overwrite = boolArg(args, 'overwrite', false)
  const userAgent = args.get('user-agent') || DEFAULT_USER_AGENT

  const manifest = await buildBangumiCoverManifest({ inputs })
  await writeJsonFile(path.resolve(manifestOut), manifest)

  let result = manifest
  if (download) {
    result = await cacheBangumiCovers(manifest, { outputDir, limit, delayMs, overwrite, userAgent })
  }

  await mkdir(path.dirname(path.resolve(reportOut)), { recursive: true })
  await writeFile(path.resolve(reportOut), `${REPORT_UTF8_BOM}${createBangumiCoverCacheReport(result, { topLimit })}\n`, 'utf8')

  console.log(`Wrote Bangumi cover manifest -> ${path.resolve(manifestOut)}`)
  console.log(`Wrote Bangumi cover report -> ${path.resolve(reportOut)}`)
  if (download) console.log(`Cached Bangumi covers -> ${path.resolve(outputDir)}`)
  if (result.meta?.errors > 0) process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
