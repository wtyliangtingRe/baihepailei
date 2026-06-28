#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeJsonFile } from '../lib/jsonl.mjs'

const DEFAULT_TOP_LIMIT = 80
const DEFAULT_MIN_CREATOR_WORKS = 2
const DEFAULT_MIN_ORGANIZATION_WORKS = 3

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

function normalizeCandidate(item) {
  return {
    kind: cleanText(item?.kind),
    key: cleanText(item?.key),
    name: cleanText(item?.name),
    suggestedSlug: cleanText(item?.suggestedSlug),
    hintCount: Number(item?.hintCount || 0),
    worksCount: Number(item?.worksCount || 0),
    roles: Array.isArray(item?.roles) ? item.roles : [],
    originalRoles: Array.isArray(item?.originalRoles) ? item.originalRoles : [],
    sources: Array.isArray(item?.sources) ? item.sources.map(cleanText).filter(Boolean) : [],
    sampleWorks: Array.isArray(item?.sampleWorks) ? item.sampleWorks : [],
    sampleNotes: Array.isArray(item?.sampleNotes) ? item.sampleNotes : [],
    reviewFlags: Array.isArray(item?.reviewFlags) ? item.reviewFlags.map(cleanText).filter(Boolean) : [],
  }
}

function sortCandidates(rows) {
  return [...rows].sort((a, b) => b.worksCount - a.worksCount || b.hintCount - a.hintCount || a.name.localeCompare(b.name))
}

function isSelected(item, { minWorks }) {
  return item.reviewFlags.length === 0 && item.worksCount >= minWorks
}

function splitCandidates(rows, options) {
  const selected = []
  const review = []
  const belowThreshold = []

  for (const item of rows.map(normalizeCandidate).filter((item) => item.name)) {
    if (isSelected(item, options)) selected.push(item)
    else if (item.reviewFlags.length > 0) review.push(item)
    else belowThreshold.push(item)
  }

  return {
    selected: sortCandidates(selected),
    review: sortCandidates(review),
    belowThreshold: sortCandidates(belowThreshold),
  }
}

export function selectBangumiEntities(review, options = {}) {
  const minCreatorWorks = options.minCreatorWorks ?? DEFAULT_MIN_CREATOR_WORKS
  const minOrganizationWorks = options.minOrganizationWorks ?? DEFAULT_MIN_ORGANIZATION_WORKS
  const creators = splitCandidates(Array.isArray(review?.creators) ? review.creators : [], { minWorks: minCreatorWorks })
  const organizations = splitCandidates(Array.isArray(review?.organizations) ? review.organizations : [], { minWorks: minOrganizationWorks })

  return {
    meta: {
      sourceWorksTotal: Number(review?.meta?.worksTotal || 0),
      sourceCreatorsTotal: Number(review?.meta?.creatorsTotal || 0),
      sourceOrganizationsTotal: Number(review?.meta?.organizationsTotal || 0),
      minCreatorWorks,
      minOrganizationWorks,
      selectedCreators: creators.selected.length,
      selectedOrganizations: organizations.selected.length,
      reviewCreators: creators.review.length,
      reviewOrganizations: organizations.review.length,
      belowThresholdCreators: creators.belowThreshold.length,
      belowThresholdOrganizations: organizations.belowThreshold.length,
    },
    selectedCreators: creators.selected,
    selectedOrganizations: organizations.selected,
    reviewCreators: creators.review,
    reviewOrganizations: organizations.review,
    belowThresholdCreators: creators.belowThreshold,
    belowThresholdOrganizations: organizations.belowThreshold,
  }
}

function candidateTable(title, rows, limit = DEFAULT_TOP_LIMIT) {
  const limited = rows.slice(0, limit)
  if (limited.length === 0) return `## ${title}\n\n暂无。\n`
  return [
    `## ${title}`,
    '',
    '| 名称 | 覆盖作品 | 候选条数 | Roles | 标记 | 示例作品 |',
    '| --- | ---: | ---: | --- | --- | --- |',
    ...limited.map((item) => `| ${escapeMarkdownCell(item.name)} | ${item.worksCount} | ${item.hintCount} | ${escapeMarkdownCell(item.roles.map((role) => `${role.role}:${role.count}`).join('；'))} | ${escapeMarkdownCell(item.reviewFlags.join('；'))} | ${escapeMarkdownCell(item.sampleWorks.map((work) => work.title).slice(0, 5).join('；'))} |`),
    '',
  ].join('\n')
}

export function createBangumiEntitySelectionReport(selection, { inputPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  return [
    '# Bangumi 候选实体选择预览',
    '',
    `生成时间：${new Date().toISOString()}`,
    inputPath ? `输入文件：\`${inputPath}\`` : '',
    '',
    '## 总览',
    '',
    `- 来源作品数：${selection.meta.sourceWorksTotal}`,
    `- 来源 creator 候选数：${selection.meta.sourceCreatorsTotal}`,
    `- 来源 organization 候选数：${selection.meta.sourceOrganizationsTotal}`,
    `- creator 最小覆盖作品阈值：${selection.meta.minCreatorWorks}`,
    `- organization 最小覆盖作品阈值：${selection.meta.minOrganizationWorks}`,
    `- 选中 creator：${selection.meta.selectedCreators}`,
    `- 选中 organization：${selection.meta.selectedOrganizations}`,
    `- 需复核 creator：${selection.meta.reviewCreators}`,
    `- 需复核 organization：${selection.meta.reviewOrganizations}`,
    `- 阈值以下 creator：${selection.meta.belowThresholdCreators}`,
    `- 阈值以下 organization：${selection.meta.belowThresholdOrganizations}`,
    '',
    candidateTable('选中 creator 候选', selection.selectedCreators, topLimit),
    candidateTable('选中 organization 候选', selection.selectedOrganizations, topLimit),
    candidateTable('高频复核 creator 候选', selection.reviewCreators, topLimit),
    candidateTable('高频复核 organization 候选', selection.reviewOrganizations, topLimit),
    '## 安全说明',
    '',
    '- 这只是本地选择预览，不是导入文件。',
    '- 未调用 Payload API，也不会创建或更新任何记录。',
    '- `selected*` 只代表当前规则下较干净，仍建议人工抽查后再进入下一步。',
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
  const output = args.get('out') || path.join('data_local', 'payload', 'bangumi-entity-selection-preview.json')
  const reportOutput = args.get('report') || path.join('data_local', 'reports', 'bangumi-entity-selection-preview.md')
  const minCreatorWorks = numberArg(args, 'min-creator-works', DEFAULT_MIN_CREATOR_WORKS)
  const minOrganizationWorks = numberArg(args, 'min-organization-works', DEFAULT_MIN_ORGANIZATION_WORKS)
  const topLimit = numberArg(args, 'top', DEFAULT_TOP_LIMIT)

  if (!input) {
    console.error('Usage: node tools/source_import/scripts/select-bangumi-entities.mjs --in <entity-candidates.json> [--out <selection.json>] [--report <report.md>] [--min-creator-works 2] [--min-organization-works 3]')
    process.exitCode = 1
    return
  }

  const resolvedInput = path.resolve(input)
  const resolvedOutput = path.resolve(output)
  const resolvedReportOutput = path.resolve(reportOutput)
  const review = await readJsonFile(resolvedInput)
  const selection = selectBangumiEntities(review, { minCreatorWorks, minOrganizationWorks })
  const report = createBangumiEntitySelectionReport(selection, { inputPath: resolvedInput, topLimit })

  await mkdir(path.dirname(resolvedOutput), { recursive: true })
  await writeJsonFile(resolvedOutput, selection)
  console.log(`Wrote Bangumi entity selection preview -> ${resolvedOutput}`)

  await mkdir(path.dirname(resolvedReportOutput), { recursive: true })
  await writeFile(resolvedReportOutput, `${report}\n`, 'utf8')
  console.log(`Wrote Bangumi entity selection report -> ${resolvedReportOutput}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
