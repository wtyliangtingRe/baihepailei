#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeJsonFile } from '../lib/jsonl.mjs'

const DEFAULT_TOP_LIMIT = 80

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

function sourceNote(candidate) {
  const roleText = Array.isArray(candidate.roles) && candidate.roles.length > 0
    ? candidate.roles.map((row) => `${row.role}:${row.count}`).join('; ')
    : 'unknown'
  return [
    'Generated from Bangumi selected entity preview.',
    `Selection key: ${candidate.key}`,
    `Covered works: ${candidate.worksCount}`,
    `Hint count: ${candidate.hintCount}`,
    `Roles: ${roleText}`,
  ].join('\n')
}

function normalizeSelectedCandidate(candidate, kind) {
  return {
    name: cleanText(candidate?.name),
    slug: cleanText(candidate?.suggestedSlug),
    source: 'bangumi-selected-preview',
    sourceKey: cleanText(candidate?.key),
    worksCount: Number(candidate?.worksCount || 0),
    hintCount: Number(candidate?.hintCount || 0),
    roles: Array.isArray(candidate?.roles) ? candidate.roles : [],
    originalRoles: Array.isArray(candidate?.originalRoles) ? candidate.originalRoles : [],
    sampleWorks: Array.isArray(candidate?.sampleWorks) ? candidate.sampleWorks : [],
    evidenceNote: sourceNote(candidate || {}),
    status: 'draft',
    reviewStatus: 'pending',
    candidateKind: kind,
  }
}

function sortSeedRows(rows) {
  return [...rows].sort((a, b) => b.worksCount - a.worksCount || b.hintCount - a.hintCount || a.name.localeCompare(b.name))
}

export function buildBangumiSelectedEntitySeed(selection) {
  const creators = sortSeedRows((Array.isArray(selection?.selectedCreators) ? selection.selectedCreators : [])
    .map((candidate) => normalizeSelectedCandidate(candidate, 'creator'))
    .filter((candidate) => candidate.name && candidate.slug))
  const organizations = sortSeedRows((Array.isArray(selection?.selectedOrganizations) ? selection.selectedOrganizations : [])
    .map((candidate) => normalizeSelectedCandidate(candidate, 'organization'))
    .filter((candidate) => candidate.name && candidate.slug))

  return {
    meta: {
      sourceWorksTotal: Number(selection?.meta?.sourceWorksTotal || 0),
      sourceSelectedCreators: Number(selection?.meta?.selectedCreators || creators.length),
      sourceSelectedOrganizations: Number(selection?.meta?.selectedOrganizations || organizations.length),
      creatorsTotal: creators.length,
      organizationsTotal: organizations.length,
      mode: 'preview-only',
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
    '| 名称 | Slug | 覆盖作品 | 候选条数 | Roles | 示例作品 |',
    '| --- | --- | ---: | ---: | --- | --- |',
    ...limited.map((item) => `| ${escapeMarkdownCell(item.name)} | ${escapeMarkdownCell(item.slug)} | ${item.worksCount} | ${item.hintCount} | ${escapeMarkdownCell(item.roles.map((role) => `${role.role}:${role.count}`).join('；'))} | ${escapeMarkdownCell(item.sampleWorks.map((work) => work.title).slice(0, 5).join('；'))} |`),
    '',
  ].join('\n')
}

export function createBangumiSelectedEntitySeedReport(seed, { inputPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  return [
    '# Bangumi selected 实体 seed 预览',
    '',
    `生成时间：${new Date().toISOString()}`,
    inputPath ? `输入文件：\`${inputPath}\`` : '',
    '',
    '## 总览',
    '',
    `- 来源作品数：${seed.meta.sourceWorksTotal}`,
    `- 来源 selected creator：${seed.meta.sourceSelectedCreators}`,
    `- 来源 selected organization：${seed.meta.sourceSelectedOrganizations}`,
    `- seed creator 草稿：${seed.meta.creatorsTotal}`,
    `- seed organization 草稿：${seed.meta.organizationsTotal}`,
    `- 模式：${seed.meta.mode}`,
    '',
    seedTable('creator seed 草稿', seed.creators, topLimit),
    seedTable('organization seed 草稿', seed.organizations, topLimit),
    '## 安全说明',
    '',
    '- 这不是 Payload 导入脚本，只是本地 seed 形状预览。',
    '- 未调用 Payload API，不创建或更新 creators / organizations。',
    '- 暂不生成 work relationship。',
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
  const output = args.get('out') || path.join('data_local', 'payload', 'bangumi-selected-entity-seed-preview.json')
  const reportOutput = args.get('report') || path.join('data_local', 'reports', 'bangumi-selected-entity-seed-preview.md')
  const topLimit = numberArg(args, 'top', DEFAULT_TOP_LIMIT)

  if (!input) {
    console.error('Usage: node tools/source_import/scripts/build-bangumi-selected-entity-seed.mjs --in <selection-preview.json> [--out <seed-preview.json>] [--report <report.md>]')
    process.exitCode = 1
    return
  }

  const resolvedInput = path.resolve(input)
  const resolvedOutput = path.resolve(output)
  const resolvedReportOutput = path.resolve(reportOutput)
  const selection = await readJsonFile(resolvedInput)
  const seed = buildBangumiSelectedEntitySeed(selection)
  const report = createBangumiSelectedEntitySeedReport(seed, { inputPath: resolvedInput, topLimit })

  await mkdir(path.dirname(resolvedOutput), { recursive: true })
  await writeJsonFile(resolvedOutput, seed)
  console.log(`Wrote Bangumi selected entity seed preview -> ${resolvedOutput}`)

  await mkdir(path.dirname(resolvedReportOutput), { recursive: true })
  await writeFile(resolvedReportOutput, `${report}\n`, 'utf8')
  console.log(`Wrote Bangumi selected entity seed report -> ${resolvedReportOutput}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
