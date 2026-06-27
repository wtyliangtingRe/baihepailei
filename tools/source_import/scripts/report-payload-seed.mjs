#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

function escapeMarkdownCell(value) {
  return cleanText(value)
    .replace(/\\/gu, '\\\\')
    .replace(/\|/gu, '\\|')
}

function countBy(values) {
  const counts = new Map()

  for (const value of values) {
    const key = cleanText(value || 'unknown') || 'unknown'
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function localizedTitlePreview(work, limit = 3) {
  const titles = Array.isArray(work.localizedTitles) ? work.localizedTitles : []
  return titles
    .map((title) => {
      const value = cleanText(title?.title || title)
      if (!value) return ''
      const language = cleanText(title?.language)
      const kind = cleanText(title?.kind)
      const suffix = [language, kind].filter(Boolean).join('/')
      return suffix ? `${value} (${suffix})` : value
    })
    .filter(Boolean)
    .slice(0, limit)
    .join('；')
}

function sourcePreview(work) {
  const sources = Array.isArray(work.candidateSources) ? work.candidateSources : []
  return sources
    .map((source) => {
      const label = cleanText(source?.label || source?.source || 'source')
      const externalId = cleanText(source?.externalId)
      return externalId ? `${label}:${externalId}` : label
    })
    .filter(Boolean)
    .join('；')
}

function imageMetadataPreview(work) {
  const images = Array.isArray(work.externalCoverImages) ? work.externalCoverImages : []
  if (images.length === 0) return ''

  const first = images[0]
  const label = cleanText(first?.label || first?.size || first?.source || 'image')
  return images.length === 1 ? label : `${label} +${images.length - 1}`
}

function workGroupPreview(work) {
  return cleanText(work?.workGroup?.title || work?.workGroup?.key || '')
}

function hiddenDraftState(work) {
  const flags = []
  flags.push(work.status || 'no-status')
  flags.push(work.isLiteVisible ? 'lite-visible' : 'lite-hidden')
  flags.push(work.isFullVisible ? 'full-visible' : 'full-hidden')
  return flags.join(' / ')
}

function markdownCountTable(title, rows) {
  if (rows.length === 0) return `## ${title}\n\n暂无。\n`

  return [
    `## ${title}`,
    '',
    '| 值 | 数量 |',
    '| --- | ---: |',
    ...rows.map(([label, count]) => `| ${escapeMarkdownCell(label)} | ${count} |`),
    '',
  ].join('\n')
}

function summarizeWorkGroups(works) {
  const groups = new Map()

  for (const work of works) {
    const group = work?.workGroup
    const key = cleanText(group?.key || group?.title)
    const title = cleanText(group?.title || group?.key)
    if (!key || !title) continue

    const existing = groups.get(key) || { key, title, count: 0, works: [] }
    existing.count += 1
    existing.works.push(cleanText(work.title || work.slug || 'untitled'))
    groups.set(key, existing)
  }

  return [...groups.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
}

function markdownWorkGroupTable(groups) {
  const rows = groups.filter((group) => group.count > 1)
  if (rows.length === 0) return '## 候选系列分组\n\n暂无多条目候选分组。\n'

  return [
    '## 候选系列分组',
    '',
    '| 分组 | 数量 | 作品 |',
    '| --- | ---: | --- |',
    ...rows.map((group) => `| ${escapeMarkdownCell(group.title)} | ${group.count} | ${escapeMarkdownCell(group.works.join('；'))} |`),
    '',
  ].join('\n')
}

export function summarizePayloadSeed(seed) {
  const works = Array.isArray(seed?.works) ? seed.works : []
  const sourceCounts = new Map()
  const workGroups = summarizeWorkGroups(works)

  for (const work of works) {
    for (const source of Array.isArray(work.candidateSources) ? work.candidateSources : []) {
      const key = cleanText(source?.source || source?.label || 'unknown') || 'unknown'
      sourceCounts.set(key, (sourceCounts.get(key) || 0) + 1)
    }
  }

  return {
    worksCount: works.length,
    draftCount: works.filter((work) => work.status === 'draft').length,
    hiddenLiteCount: works.filter((work) => work.isLiteVisible === false).length,
    hiddenFullCount: works.filter((work) => work.isFullVisible === false).length,
    localizedTitleCount: works.reduce((sum, work) => sum + (Array.isArray(work.localizedTitles) ? work.localizedTitles.length : 0), 0),
    externalCoverImageCount: works.reduce((sum, work) => sum + (Array.isArray(work.externalCoverImages) ? work.externalCoverImages.length : 0), 0),
    externalCoverWorkCount: works.filter((work) => Array.isArray(work.externalCoverImages) && work.externalCoverImages.length > 0).length,
    workGroups,
    multiWorkGroupCount: workGroups.filter((group) => group.count > 1).length,
    mediaGroups: countBy(works.map((work) => work.mediaGroup || 'unknown')),
    mediaTypes: countBy(works.map((work) => work.mediaType || 'unknown')),
    statuses: countBy(works.map((work) => work.status || 'unknown')),
    sources: [...sourceCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  }
}

export function createPayloadSeedPreviewReport(seed, { inputPath = '' } = {}) {
  const works = Array.isArray(seed?.works) ? seed.works : []
  const summary = summarizePayloadSeed(seed)

  const lines = [
    '# Payload 候选导入预览',
    '',
    `生成时间：${new Date().toISOString()}`,
    inputPath ? `输入文件：\`${inputPath}\`` : '',
    '',
    '## 总览',
    '',
    `- 作品数：${summary.worksCount}`,
    `- 草稿作品：${summary.draftCount}`,
    `- Lite 隐藏：${summary.hiddenLiteCount}`,
    `- Full 隐藏：${summary.hiddenFullCount}`,
    `- 多译名条目数：${summary.localizedTitleCount}`,
    `- 外部封面候选数：${summary.externalCoverImageCount}`,
    `- 带外部封面候选作品：${summary.externalCoverWorkCount}`,
    `- 多条目候选系列分组：${summary.multiWorkGroupCount}`,
    '',
    markdownCountTable('作品大类', summary.mediaGroups),
    markdownCountTable('作品类型', summary.mediaTypes),
    markdownCountTable('状态', summary.statuses),
    markdownCountTable('来源', summary.sources),
    markdownWorkGroupTable(summary.workGroups),
    '## 作品候选清单',
    '',
    '| # | Slug | 标题 | 大类 / 类型 | 首次日期 | 多译名预览 | 来源 | 外部封面 | 候选分组 | 状态 |',
    '| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...works.map((work, index) => `| ${index + 1} | ${escapeMarkdownCell(work.slug)} | ${escapeMarkdownCell(work.title)} | ${escapeMarkdownCell([work.mediaGroup, work.mediaType].filter(Boolean).join(' / '))} | ${escapeMarkdownCell(work.firstPublishedLabel || '')} | ${escapeMarkdownCell(localizedTitlePreview(work))} | ${escapeMarkdownCell(sourcePreview(work))} | ${escapeMarkdownCell(imageMetadataPreview(work))} | ${escapeMarkdownCell(workGroupPreview(work))} | ${escapeMarkdownCell(hiddenDraftState(work))} |`),
    '',
    '## 导入前检查建议',
    '',
    '- 确认候选作品仍为 `draft`。',
    '- 确认 `isLiteVisible` 与 `isFullVisible` 都是隐藏状态。',
    '- 优先检查同名、同译名、同来源 ID 的候选是否有重复。',
    '- 多译名来自外部来源时只作为候选元数据，导入后仍建议人工复核。',
    '- 外部封面只作为候选 URL 元数据，不代表已下载、已上传或已公开展示。',
    '- 候选系列分组只用于复核和预览，不代表已经确认同系列导航。',
    '',
  ]

  return lines.filter((line) => line !== '').join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.get('in')
  const output = args.get('out') || path.join('data_local', 'reports', 'payload-candidate-preview.md')

  if (!input) {
    console.error('Usage: pnpm source:report:payload -- --in <payload-candidates.json> [--out <preview.md>]')
    process.exitCode = 1
    return
  }

  const resolvedInput = path.resolve(input)
  const resolvedOutput = path.resolve(output)
  const seed = JSON.parse(await readFile(resolvedInput, 'utf8'))
  const report = createPayloadSeedPreviewReport(seed, { inputPath: resolvedInput })

  await mkdir(path.dirname(resolvedOutput), { recursive: true })
  await writeFile(resolvedOutput, `${report}\n`, 'utf8')

  console.log(`Wrote Payload candidate preview report -> ${resolvedOutput}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
