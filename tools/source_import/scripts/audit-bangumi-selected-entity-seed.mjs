#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeJsonFile } from '../lib/jsonl.mjs'

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

function rowsForKind(seed, kind) {
  const field = kind === 'creator' ? 'creators' : 'organizations'
  return Array.isArray(seed?.[field]) ? seed[field] : []
}

function duplicateValues(rows, keyFn) {
  const seen = new Set()
  const duplicates = new Set()
  for (const row of rows) {
    const value = cleanText(keyFn(row)).toLowerCase()
    if (!value) continue
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates].sort((a, b) => a.localeCompare(b))
}

function countRows(rows, predicate) {
  return rows.filter(predicate).length
}

function hasRelationshipFields(row) {
  return ['works', 'work', 'creatorCredits', 'workOrganizations', 'relationships'].some((field) => Object.hasOwn(row, field))
}

function makeCheck(name, pass, actual, expected, details = []) {
  return {
    name,
    pass: Boolean(pass),
    actual,
    expected,
    details,
  }
}

export function auditBangumiSelectedEntitySeed(seed) {
  const creators = rowsForKind(seed, 'creator')
  const organizations = rowsForKind(seed, 'organization')
  const allRows = [...creators, ...organizations]
  const meta = seed?.meta || {}

  const creatorDuplicateNames = duplicateValues(creators, (row) => row.name)
  const organizationDuplicateNames = duplicateValues(organizations, (row) => row.name)
  const duplicateSlugs = duplicateValues(allRows, (row) => row.slug)
  const duplicateSourceKeys = duplicateValues(allRows, (row) => row.sourceKey)
  const missingNames = countRows(allRows, (row) => !cleanText(row.name))
  const missingSlugs = countRows(allRows, (row) => !cleanText(row.slug))
  const missingSourceKeys = countRows(allRows, (row) => !cleanText(row.sourceKey))
  const nonDraft = allRows.filter((row) => row.status !== 'draft').map((row) => cleanText(row.name || row.slug))
  const nonPending = allRows.filter((row) => row.reviewStatus !== 'pending').map((row) => cleanText(row.name || row.slug))
  const wrongSource = allRows.filter((row) => row.source !== 'bangumi-selected-preview').map((row) => cleanText(row.name || row.slug))
  const withReviewFlags = allRows.filter((row) => Array.isArray(row.reviewFlags) && row.reviewFlags.length > 0).map((row) => cleanText(row.name || row.slug))
  const withRelationshipFields = allRows.filter(hasRelationshipFields).map((row) => cleanText(row.name || row.slug))

  const checks = [
    makeCheck('preview mode', meta.mode === 'preview-only', meta.mode || '', 'preview-only'),
    makeCheck('creator count matches meta', creators.length === Number(meta.creatorsTotal || 0), creators.length, Number(meta.creatorsTotal || 0)),
    makeCheck('organization count matches meta', organizations.length === Number(meta.organizationsTotal || 0), organizations.length, Number(meta.organizationsTotal || 0)),
    makeCheck('source selected creator count matches output', creators.length === Number(meta.sourceSelectedCreators || creators.length), creators.length, Number(meta.sourceSelectedCreators || creators.length)),
    makeCheck('source selected organization count matches output', organizations.length === Number(meta.sourceSelectedOrganizations || organizations.length), organizations.length, Number(meta.sourceSelectedOrganizations || organizations.length)),
    makeCheck('creator names are unique', creatorDuplicateNames.length === 0, creatorDuplicateNames.length, 0, creatorDuplicateNames.slice(0, 20)),
    makeCheck('organization names are unique', organizationDuplicateNames.length === 0, organizationDuplicateNames.length, 0, organizationDuplicateNames.slice(0, 20)),
    makeCheck('slugs are unique across seed rows', duplicateSlugs.length === 0, duplicateSlugs.length, 0, duplicateSlugs.slice(0, 20)),
    makeCheck('source keys are unique across seed rows', duplicateSourceKeys.length === 0, duplicateSourceKeys.length, 0, duplicateSourceKeys.slice(0, 20)),
    makeCheck('names are present', missingNames === 0, missingNames, 0),
    makeCheck('slugs are present', missingSlugs === 0, missingSlugs, 0),
    makeCheck('source keys are present', missingSourceKeys === 0, missingSourceKeys, 0),
    makeCheck('all rows are draft', nonDraft.length === 0, nonDraft.length, 0, nonDraft.slice(0, 20)),
    makeCheck('all rows are pending review', nonPending.length === 0, nonPending.length, 0, nonPending.slice(0, 20)),
    makeCheck('all rows keep selected preview source', wrongSource.length === 0, wrongSource.length, 0, wrongSource.slice(0, 20)),
    makeCheck('no review flags are carried into seed preview', withReviewFlags.length === 0, withReviewFlags.length, 0, withReviewFlags.slice(0, 20)),
    makeCheck('no work relationship fields are present', withRelationshipFields.length === 0, withRelationshipFields.length, 0, withRelationshipFields.slice(0, 20)),
  ]

  return {
    ok: checks.every((check) => check.pass),
    meta: {
      creatorsTotal: creators.length,
      organizationsTotal: organizations.length,
      rowsTotal: allRows.length,
      failedChecks: checks.filter((check) => !check.pass).length,
    },
    checks,
  }
}

export function createBangumiSelectedEntitySeedAuditReport(audit, { inputPath = '' } = {}) {
  const checkRows = audit.checks.map((check) => `| ${check.pass ? 'PASS' : 'FAIL'} | ${escapeMarkdownCell(check.name)} | ${escapeMarkdownCell(check.actual)} | ${escapeMarkdownCell(check.expected)} | ${escapeMarkdownCell((check.details || []).join('；'))} |`)
  return [
    '# Bangumi selected 实体 seed 审计报告',
    '',
    `生成时间：${new Date().toISOString()}`,
    inputPath ? `输入文件：\`${inputPath}\`` : '',
    '',
    '## 总览',
    '',
    `- 结果：${audit.ok ? 'PASS' : 'FAIL'}`,
    `- creator rows：${audit.meta.creatorsTotal}`,
    `- organization rows：${audit.meta.organizationsTotal}`,
    `- total rows：${audit.meta.rowsTotal}`,
    `- failed checks：${audit.meta.failedChecks}`,
    '',
    '## Checks',
    '',
    '| 状态 | 检查项 | 实际值 | 期望值 | 详情 |',
    '| --- | --- | --- | --- | --- |',
    ...checkRows,
    '',
    '## 安全说明',
    '',
    '- 这只是本地 JSON 审计，不调用 Payload API。',
    '- 审计通过只代表 seed 预览形状安全，不代表已人工确认实体语义。',
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
  const jsonOutput = args.get('json') || path.join('data_local', 'reports', 'bangumi-selected-entity-seed-audit.json')
  const reportOutput = args.get('report') || path.join('data_local', 'reports', 'bangumi-selected-entity-seed-audit.md')

  if (!input) {
    console.error('Usage: node tools/source_import/scripts/audit-bangumi-selected-entity-seed.mjs --in <seed-preview.json> [--json <audit.json>] [--report <audit.md>]')
    process.exitCode = 1
    return
  }

  const resolvedInput = path.resolve(input)
  const resolvedJsonOutput = path.resolve(jsonOutput)
  const resolvedReportOutput = path.resolve(reportOutput)
  const seed = await readJsonFile(resolvedInput)
  const audit = auditBangumiSelectedEntitySeed(seed)
  const report = createBangumiSelectedEntitySeedAuditReport(audit, { inputPath: resolvedInput })

  await mkdir(path.dirname(resolvedJsonOutput), { recursive: true })
  await writeJsonFile(resolvedJsonOutput, audit)
  console.log(`Wrote Bangumi selected entity seed audit JSON -> ${resolvedJsonOutput}`)

  await mkdir(path.dirname(resolvedReportOutput), { recursive: true })
  await writeFile(resolvedReportOutput, `${report}\n`, 'utf8')
  console.log(`Wrote Bangumi selected entity seed audit report -> ${resolvedReportOutput}`)

  if (!audit.ok) {
    console.error('Bangumi selected entity seed audit failed.')
    process.exitCode = 1
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
