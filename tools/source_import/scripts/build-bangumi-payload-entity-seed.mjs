#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeJsonFile } from '../lib/jsonl.mjs'

const DEFAULT_TOP_LIMIT = 80
const SOURCE_LABEL = 'Bangumi selected entity preview'
const VALID_ORGANIZATION_TYPES = new Set([
  'publisher',
  'production_company',
  'animation_studio',
  'game_company',
  'distributor',
  'circle',
  'brand',
  'platform',
  'committee',
  'other',
])
const PUBLISHER_NAME_PATTERN = /出版社|書店|书店|小学館|學館|学館|集英社|白泉社|双葉社|徳間書店|一迅社|芳文社|KADOKAWA|角川/iu
const GAME_COMPANY_NAME_PATTERN = /ゲーム|游戏|遊戲|网易|網易|Cygames|ブシロード/iu
const BROADCASTER_NAME_PATTERN = /テレビ|放送|TV|TBS|MBS|BS11|AT-X|TOKYO MX|WOWOW|ABEMA|youtube|bilibili/iu
const STUDIO_NAME_PATTERN = /スタジオ|studio|動画工房|CloverWorks|SHAFT|サンライズ|AIC|AXsiZ|SILVER LINK|J\.C\.STAFF|P\.A\.WORKS/iu

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

function roleCount(row, roleName) {
  if (!Array.isArray(row.roles)) return 0
  return row.roles
    .filter((role) => role.role === roleName)
    .reduce((sum, role) => sum + Number(role.count || 0), 0)
}

function sampleWorkText(row) {
  if (!Array.isArray(row.sampleWorks) || row.sampleWorks.length === 0) return ''
  return row.sampleWorks
    .map((work) => cleanText(work.title || work.slug || work.bangumiSubjectId))
    .filter(Boolean)
    .slice(0, 10)
    .join('; ')
}

function richTextFromPlainText(value) {
  const lines = String(value || '').split('\n')
  const children = lines.map((line) => ({
    type: 'paragraph',
    version: 1,
    direction: null,
    format: '',
    indent: 0,
    children: line
      ? [{ type: 'text', version: 1, text: line, detail: 0, format: 0, mode: 'normal', style: '' }]
      : [],
  }))

  return {
    root: {
      type: 'root',
      version: 1,
      direction: null,
      format: '',
      indent: 0,
      children,
    },
  }
}

function plainNotesFor(row) {
  return [
    SOURCE_LABEL,
    `Source key: ${cleanText(row.sourceKey)}`,
    `Covered works: ${Number(row.worksCount || 0)}`,
    `Hint count: ${Number(row.hintCount || 0)}`,
    `Roles: ${roleText(row)}`,
    sampleWorkText(row) ? `Sample works: ${sampleWorkText(row)}` : '',
  ].filter(Boolean).join('\n')
}

function sourceLinksFor() {
  return [{
    label: SOURCE_LABEL,
    url: '',
  }]
}

function commonFields(row) {
  const notesText = plainNotesFor(row)
  return {
    siteId: cleanText(row.sourceKey),
    name: cleanText(row.name),
    slug: cleanText(row.slug),
    aliases: [],
    localizedNames: [],
    notes: richTextFromPlainText(notesText),
    searchText: [row.name, row.slug, roleText(row), sampleWorkText(row), notesText].map(cleanText).filter(Boolean).join('\n'),
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

export function organizationType(row) {
  const name = cleanText(row.name)
  const animationStudioCount = roleCount(row, 'animation_studio')
  const broadcasterCount = roleCount(row, 'broadcaster')
  const musicLabelCount = roleCount(row, 'music_label')
  const distributorCount = roleCount(row, 'distributor')
  const publisherCount = roleCount(row, 'publisher')
  const platformCount = roleCount(row, 'streaming_platform')
  const productionCompanyCount = roleCount(row, 'production_company')
  const gameCompanyCount = roleCount(row, 'game_developer')
  const committeeCount = roleCount(row, 'committee')
  const committeeMemberCount = roleCount(row, 'committee_member')

  if (PUBLISHER_NAME_PATTERN.test(name) || publisherCount > 0) return 'publisher'
  if (GAME_COMPANY_NAME_PATTERN.test(name) || gameCompanyCount > 0) return 'game_company'
  if (platformCount > 0) return 'platform'
  if (distributorCount >= 2 && distributorCount >= animationStudioCount) return 'distributor'
  if (BROADCASTER_NAME_PATTERN.test(name) || broadcasterCount > 0) return 'other'
  if (musicLabelCount > 0 && animationStudioCount === 0) return 'other'
  if (animationStudioCount >= 3 || (animationStudioCount > 0 && STUDIO_NAME_PATTERN.test(name))) return 'animation_studio'
  if (productionCompanyCount > 0) return 'production_company'
  if (/委員会|委员会|製作|制作|Project|PROJECT/u.test(name) && committeeCount + committeeMemberCount > 0) return 'committee'

  return 'other'
}

function organizationSeedRow(row) {
  const type = organizationType(row)
  if (!VALID_ORGANIZATION_TYPES.has(type)) {
    throw new Error(`Invalid organization type generated for ${row.name}: ${type}`)
  }

  return {
    ...commonFields(row),
    type,
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

function richTextPreview(value) {
  return value?.root?.children
    ?.map((paragraph) => paragraph.children?.map((child) => child.text).join('') || '')
    .filter(Boolean)
    .slice(0, 3)
    .join('；') || ''
}

function seedTable(title, rows, limit = DEFAULT_TOP_LIMIT) {
  const limited = rows.slice(0, limit)
  if (limited.length === 0) return `## ${title}\n\n暂无。\n`
  return [
    `## ${title}`,
    '',
    '| 名称 | Slug | 类型/Rank | 可见性 | 状态 | Notes 摘要 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...limited.map((row) => `| ${escapeMarkdownCell(row.name)} | ${escapeMarkdownCell(row.slug)} | ${escapeMarkdownCell(row.type || row.rank)} | Lite:${row.isLiteVisible ? 'show' : 'hide'} / Full:${row.isFullVisible ? 'show' : 'hide'} | ${escapeMarkdownCell(row.status)} | ${escapeMarkdownCell(richTextPreview(row.notes))} |`),
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
