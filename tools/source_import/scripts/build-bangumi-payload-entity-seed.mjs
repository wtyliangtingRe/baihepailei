#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeJsonFile } from '../lib/jsonl.mjs'

const DEFAULT_TOP_LIMIT = 80
const SOURCE_LABEL = 'Bangumi selected entity preview'

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
  return cleanText(value).replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|')
}

function numberArg(args, key, fallback) {
  const value = Number(args.get(key) ?? fallback)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function roleText(row) {
  if (!Array.isArray(row.roles) || row.roles.length === 0) return 'unknown'
  return row.roles.map((role) => `${role.role}:${role.count}`).join('; ')
}

function sampleWorkText(row) {
  if (!Array.isArray(row.sampleWorks) || row.sampleWorks.length === 0) return ''
  return row.sampleWorks
    .map((work) => cleanText(work.title || work.slug || work.bangumiSubjectId))
    .filter(Boolean)
    .slice(0, 10)
    .join('; ')
}

function notesFor(row) {
  return [
    SOURCE_LABEL,
    `Source key: ${cleanText(row.sourceKey)}`,
    `Covered works: ${Number(row.worksCount || 0)}`,
    `Hint count: ${Number(row.hintCount || 0)}`,
    `Roles: ${roleText(row)}`,
    sampleWorkText(row) ? `Sample works: ${sampleWorkText(row)}` : '',
  ].filter(Boolean).join('\n')
}

function sourceLinksFor(row) {
  return [{
    label: SOURCE_LABEL,
    url: '',
    note: `sourceKey=${cleanText(row.sourceKey)}; works=${Number(row.worksCount || 0)}; hints=${Number(row.hintCount || 0)}`,
  }]
}

function commonFields(row) {
  return {
    siteId: cleanText(row.sourceKey),
    name: cleanText(row.name),
    slug: cleanText(row.slug),
    aliases: [],
    localizedNames: [],
    notes: notesFor(row),
    searchText: [row.name, row.slug, roleText(row), sampleWorkText(row)].map(cleanText).filter(Boolean).join('\n'),
    isLiteVisible: false,
    isFullVisible: false,
    status: 'draft',
  }
}

function creatorSeedRow(row) {
  return {
    ...commonFields(row),
    rank: 'unknown',
  }
}

function organizationType(row) {
  const roles = Array.isArray(row.roles) ? row.roles.map((role) => role.role) : []
  if (roles.includes('animation_studio')) return 'studio'
  if (roles.includes('publisher')) return 'publisher'
  if (roles.includes('game_developer')) return 'company'
  if (roles.includes('broadcaster')) return 'broadcaster'
  if (roles.includes('music_label')) return 'music_label'
  return 'other'
}

function organizationSeedRow(row) {
  return {
    ...commonFields(row),
    type: organizationType(row),
    sourceLinks: sourceLinksFor(row),
  }
}

function sortRows(rows) {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name))
}

export function buildBangumiPayloadEntitySeed(seedPreview) {
  const selectedCreators = Array.isArray(seedPreview?.creators) ? seedPreview.creators : []
  const selectedOrganizations = Array.isArray(seedPreview?.organizations) ? seedPreview.organizations : []
  const creators = sortRows(selectedCreators.map(creatorSeedRow).filter((row) => row.name && row.slug))
  const organizations = sortRows(selectedOrganizations.map(organizationSeedRow).filter((row) => row.name && row.slug))

  return {
    meta: {
      source: 'bangumi-selected-entity-seed-preview',
      mode: 'payload-seed-preview-only',
      sourceCreatorsTotal: Number(seedPreview?.meta?.creatorsTotal || selectedCreators.length),
      sourceOrganizationsTotal: Number(seedPreview?.meta?.organizationsTotal || selectedOrganizations.length),
      creatorsTotal: creators.length,
      organizationsTotal: organizations.length,
    },
    creators,
    organizations,
  }
}

function seedTable(title, rows, limit = DEFAULT_TOP_LIMIT) {
  const limited = rows.slice(0, limit)
  if (limited.length === 0) return `## ${title}\n\n暂无。\n`
  return [
    `## ${title}`,
    '',
    '| 名称 | Slug | 类型/Rank | 可见性 | 状态 | Notes 摘要 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...limited.map((row) => `| ${escapeMarkdownCell(row.name)} | ${escapeMarkdownCell(row.slug)} | ${escapeMarkdownCell(row.type || row.rank)} | Lite:${row.isLiteVisible ? 'show' : 'hide'} / Full:${row.isFullVisible ? 'show' : 'hide'} | ${escapeMarkdownCell(row.status)} | ${escapeMarkdownCell(String(row.notes || '').split('\n').slice(0, 3).join('；'))} |`),
    '',
  ].join('\n')
}

export function createBangumiPayloadEntitySeedReport(seed, { inputPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  return [
    '# Bangumi Payload 实体 seed 包预览',
    '',
    `生成时间：${new Date().toISOString()}`,
    inputPath ? `输入文件：\`${inputPath}\`` : '',
    '',
    '## 总览',
    '',
    `- 来源 creator：${seed.meta.sourceCreatorsTotal}`,
    `- 来源 organization：${seed.meta.sourceOrganizationsTotal}`,
    `- 输出 creators：${seed.meta.creatorsTotal}`,
    `- 输出 organizations：${seed.meta.organizationsTotal}`,
    `- 模式：${seed.meta.mode}`,
    '',
    seedTable('creators collection 预览', seed.creators, topLimit),
    seedTable('organizations collection 预览', seed.organizations, topLimit),
    '## 安全说明',
    '',
    '- 这只是 Payload collection seed 形状预览，不调用 Payload API。',
    '- 所有输出默认 `status: draft` 且 Lite/Full 都隐藏。',
    '- 暂不生成作品关系。',
    '- 输出位于 `data_local` 时不要提交。',
    '',
  ].filter((line) => line !== '').join('\n')
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.get('in')
  const output = args.get('out') || path.join('data_local', 'payload', 'bangumi-payload-entity-seed-preview.json')
  const reportOutput = args.get('report') || path.join('data_local', 'reports', 'bangumi-payload-entity-seed-preview.md')
  const topLimit = numberArg(args, 'top', DEFAULT_TOP_LIMIT)

  if (!input) {
    console.error('Usage: node tools/source_import/scripts/build-bangumi-payload-entity-seed.mjs --in <selected-entity-seed-preview.json> [--out <payload-seed.json>] [--report <report.md>]')
    process.exitCode = 1
    return
  }

  const resolvedInput = path.resolve(input)
  const resolvedOutput = path.resolve(output)
  const resolvedReportOutput = path.resolve(reportOutput)
  const seedPreview = await readJsonFile(resolvedInput)
  const seed = buildBangumiPayloadEntitySeed(seedPreview)
  const report = createBangumiPayloadEntitySeedReport(seed, { inputPath: resolvedInput, topLimit })

  await mkdir(path.dirname(resolvedOutput), { recursive: true })
  await writeJsonFile(resolvedOutput, seed)
  console.log(`Wrote Bangumi Payload entity seed preview -> ${resolvedOutput}`)

  await mkdir(path.dirname(resolvedReportOutput), { recursive: true })
  await writeFile(resolvedReportOutput, `${report}\n`, 'utf8')
  console.log(`Wrote Bangumi Payload entity seed report -> ${resolvedReportOutput}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
