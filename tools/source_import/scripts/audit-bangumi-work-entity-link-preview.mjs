#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeJsonFile } from '../lib/jsonl.mjs'

const DEFAULT_TOP_LIMIT = 100
const DEFAULT_INPUT = path.join('data_local', 'payload', 'bangumi-work-entity-link-preview.json')
const DEFAULT_OUTPUT = path.join('data_local', 'reports', 'bangumi-work-entity-link-audit.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-work-entity-link-audit.md')
const REPORT_UTF8_BOM = '\uFEFF'
const FOOTNOTE_ONLY_NAME_PATTERN = /^\d+(?:\s*[-–]\s*\d+)?[）)]?$/u

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

function arrayRows(value) {
  return Array.isArray(value) ? value : []
}

function relationName(link) {
  return cleanText(link?.name)
}

function relationEntityId(link) {
  return cleanText(link?.siteId || link?.slug)
}

function relationRoleKey(link) {
  return [link?.collection, link?.siteId || link?.slug, link?.role, link?.originalRole].map(cleanText).join('|').toLowerCase()
}

function hintName(hint) {
  return cleanText(hint?.name || hint?.hint?.name)
}

function addIssue(issues, level, code, message, pathName = '', details = {}) {
  issues.push({
    level,
    code,
    message,
    path: pathName,
    details,
  })
}

function countIssueLevels(issues) {
  return {
    errors: issues.filter((issue) => issue.level === 'error').length,
    warnings: issues.filter((issue) => issue.level === 'warning').length,
    infos: issues.filter((issue) => issue.level === 'info').length,
  }
}

function auditLinks(issues, workRow, workIndex, fieldName, expectedCollection) {
  const links = arrayRows(workRow?.[fieldName])
  const seen = new Map()

  links.forEach((link, linkIndex) => {
    const pathName = `works[${workIndex}].${fieldName}[${linkIndex}]`
    const name = relationName(link)
    const entityId = relationEntityId(link)

    if (cleanText(link?.collection) !== expectedCollection) {
      addIssue(issues, 'error', 'invalid-link-collection', `${fieldName} link must target ${expectedCollection}.`, pathName, {
        collection: link?.collection,
      })
    }

    if (!name) addIssue(issues, 'error', 'missing-link-name', `${fieldName} link is missing name.`, pathName)
    if (!entityId) addIssue(issues, 'error', 'missing-link-entity-id', `${fieldName} link is missing siteId/slug.`, pathName)
    if (!cleanText(link?.role)) addIssue(issues, 'warning', 'missing-link-role', `${fieldName} link is missing role.`, pathName)
    if (FOOTNOTE_ONLY_NAME_PATTERN.test(name)) addIssue(issues, 'error', 'footnote-only-link-name', `${fieldName} link still has a footnote-only name.`, pathName, { name })

    const source = link?.source || {}
    if (cleanText(source?.type) !== 'bangumi-credit-hint') {
      addIssue(issues, 'error', 'missing-link-source-type', `${fieldName} link source.type must be bangumi-credit-hint.`, pathName, {
        sourceType: source?.type,
      })
    }
    if (!cleanText(source?.rawLine)) addIssue(issues, 'warning', 'missing-link-source-raw-line', `${fieldName} link source.rawLine is missing.`, pathName)

    const key = relationRoleKey(link)
    if (seen.has(key)) {
      addIssue(issues, 'error', 'duplicate-work-link', `Duplicate ${fieldName} relation candidate within one work.`, pathName, {
        duplicateOf: seen.get(key),
        key,
      })
    } else {
      seen.set(key, pathName)
    }
  })

  return links.length
}

function auditHints(issues, workRow, workIndex, fieldName) {
  const hints = arrayRows(workRow?.[fieldName])
  hints.forEach((hint, hintIndex) => {
    const name = hintName(hint)
    if (FOOTNOTE_ONLY_NAME_PATTERN.test(name)) {
      addIssue(issues, 'error', 'footnote-only-hint-name', `${fieldName} still has a footnote-only name.`, `works[${workIndex}].${fieldName}[${hintIndex}]`, { name })
    }
  })
  return hints.length
}

function auditHintCount(issues, workRow, workIndex, fieldName, linkedField, unmatchedField, ambiguousField) {
  const declared = Number(workRow?.[fieldName] ?? 0)
  const actual = arrayRows(workRow?.[linkedField]).length + arrayRows(workRow?.[unmatchedField]).length + arrayRows(workRow?.[ambiguousField]).length
  if (Number.isFinite(declared) && declared !== actual) {
    addIssue(issues, 'warning', 'hint-count-mismatch', `${fieldName} does not match linked + unmatched + ambiguous rows.`, `works[${workIndex}]`, {
      declared,
      actual,
      linkedField,
      unmatchedField,
      ambiguousField,
    })
  }
}

export function auditBangumiWorkEntityLinkPreview(preview) {
  const issues = []
  const works = arrayRows(preview?.works)
  const meta = preview?.meta || {}

  if (cleanText(meta.source) !== 'bangumi-work-entity-link-preview') {
    addIssue(issues, 'error', 'invalid-preview-source', 'Preview source must be bangumi-work-entity-link-preview.', 'meta.source', { actual: meta.source })
  }

  if (cleanText(meta.mode) !== 'preview-only-no-payload-write') {
    addIssue(issues, 'error', 'invalid-preview-mode', 'Preview mode must be preview-only-no-payload-write.', 'meta.mode', { actual: meta.mode })
  }

  if (!Array.isArray(preview?.works)) {
    addIssue(issues, 'error', 'missing-works-array', 'Preview must contain a works array.', 'works')
  }

  if (Number(meta.worksTotal) !== works.length) {
    addIssue(issues, 'error', 'works-total-mismatch', 'meta.worksTotal must match works.length.', 'meta.worksTotal', {
      metaWorksTotal: meta.worksTotal,
      actualWorksTotal: works.length,
    })
  }

  let creatorLinksTotal = 0
  let organizationLinksTotal = 0
  let worksWithCreatorLinks = 0
  let worksWithOrganizationLinks = 0
  let unmatchedCreatorHintsTotal = 0
  let unmatchedOrganizationHintsTotal = 0
  let ambiguousCreatorHintsTotal = 0
  let ambiguousOrganizationHintsTotal = 0

  works.forEach((workRow, workIndex) => {
    const workPath = `works[${workIndex}]`
    const work = workRow?.work || {}
    const workLabel = cleanText(work?.title || work?.slug || work?.siteId)
    if (!workLabel) addIssue(issues, 'error', 'missing-work-identity', 'Work row is missing title/slug/siteId identity.', `${workPath}.work`)

    const creatorCount = auditLinks(issues, workRow, workIndex, 'creators', 'creators')
    const organizationCount = auditLinks(issues, workRow, workIndex, 'organizations', 'organizations')
    creatorLinksTotal += creatorCount
    organizationLinksTotal += organizationCount
    if (creatorCount > 0) worksWithCreatorLinks += 1
    if (organizationCount > 0) worksWithOrganizationLinks += 1

    unmatchedCreatorHintsTotal += auditHints(issues, workRow, workIndex, 'unmatchedCreatorHints')
    unmatchedOrganizationHintsTotal += auditHints(issues, workRow, workIndex, 'unmatchedOrganizationHints')
    ambiguousCreatorHintsTotal += auditHints(issues, workRow, workIndex, 'ambiguousCreatorHints')
    ambiguousOrganizationHintsTotal += auditHints(issues, workRow, workIndex, 'ambiguousOrganizationHints')

    auditHintCount(issues, workRow, workIndex, 'creatorHintCount', 'creators', 'unmatchedCreatorHints', 'ambiguousCreatorHints')
    auditHintCount(issues, workRow, workIndex, 'organizationHintCount', 'organizations', 'unmatchedOrganizationHints', 'ambiguousOrganizationHints')
  })

  const computed = {
    worksTotal: works.length,
    worksWithCreatorLinks,
    worksWithOrganizationLinks,
    creatorLinksTotal,
    organizationLinksTotal,
    unmatchedCreatorHintsTotal,
    unmatchedOrganizationHintsTotal,
    ambiguousCreatorHintsTotal,
    ambiguousOrganizationHintsTotal,
  }

  for (const [key, actual] of Object.entries(computed)) {
    if (Number(meta[key]) !== actual) {
      addIssue(issues, 'error', 'meta-count-mismatch', `meta.${key} must match computed audit count.`, `meta.${key}`, {
        expected: actual,
        actual: meta[key],
      })
    }
  }

  if (computed.ambiguousCreatorHintsTotal > 0 || computed.ambiguousOrganizationHintsTotal > 0) {
    addIssue(issues, 'warning', 'ambiguous-hints-present', 'Ambiguous hints are present and must not enter a write plan without manual handling.', 'works', {
      ambiguousCreatorHintsTotal: computed.ambiguousCreatorHintsTotal,
      ambiguousOrganizationHintsTotal: computed.ambiguousOrganizationHintsTotal,
    })
  }

  if (computed.unmatchedCreatorHintsTotal > 0 || computed.unmatchedOrganizationHintsTotal > 0) {
    addIssue(issues, 'info', 'unmatched-hints-present', 'Unmatched hints are expected to remain report-only and must not enter relationship writes.', 'works', {
      unmatchedCreatorHintsTotal: computed.unmatchedCreatorHintsTotal,
      unmatchedOrganizationHintsTotal: computed.unmatchedOrganizationHintsTotal,
    })
  }

  const levelCounts = countIssueLevels(issues)

  return {
    meta: {
      source: 'bangumi-work-entity-link-audit',
      mode: 'audit-only-no-payload-write',
      generatedAt: new Date().toISOString(),
      status: levelCounts.errors === 0 ? 'pass' : 'fail',
      errors: levelCounts.errors,
      warnings: levelCounts.warnings,
      infos: levelCounts.infos,
    },
    stats: {
      previewMode: cleanText(meta.mode),
      worksSourceShape: cleanText(meta.worksSourceShape),
      ...computed,
    },
    issues,
  }
}

function issueTable(issues, limit = DEFAULT_TOP_LIMIT) {
  const limited = issues.slice(0, limit)
  if (limited.length === 0) return '暂无。\n'
  return [
    '| Level | Code | Path | Message |',
    '| --- | --- | --- | --- |',
    ...limited.map((issue) => `| ${escapeMarkdownCell(issue.level)} | ${escapeMarkdownCell(issue.code)} | ${escapeMarkdownCell(issue.path)} | ${escapeMarkdownCell(issue.message)} |`),
    '',
  ].join('\n')
}

export function createBangumiWorkEntityLinkAuditReport(audit, { inputPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const meta = audit.meta || {}
  const stats = audit.stats || {}
  const issues = arrayRows(audit.issues)

  return [
    '# Bangumi work/entity link audit',
    '',
    `生成时间：${meta.generatedAt}`,
    inputPath ? `输入：\`${inputPath}\`` : '',
    '',
    '## 总览',
    '',
    `- 模式：${meta.mode}`,
    `- 状态：${meta.status}`,
    `- errors：${meta.errors}`,
    `- warnings：${meta.warnings}`,
    `- infos：${meta.infos}`,
    `- preview mode：${stats.previewMode}`,
    `- works 输入形状：${stats.worksSourceShape}`,
    `- works：${stats.worksTotal}`,
    `- creator links：${stats.creatorLinksTotal}`,
    `- organization links：${stats.organizationLinksTotal}`,
    `- unmatched creator hints：${stats.unmatchedCreatorHintsTotal}`,
    `- unmatched organization hints：${stats.unmatchedOrganizationHintsTotal}`,
    `- ambiguous creator hints：${stats.ambiguousCreatorHintsTotal}`,
    `- ambiguous organization hints：${stats.ambiguousOrganizationHintsTotal}`,
    '',
    '## Issues',
    '',
    issueTable(issues, topLimit),
    '## 安全说明',
    '',
    '- 这是本地只读审计，不调用 Payload API。',
    '- 不创建、不更新、不 PATCH works。',
    '- unmatched hints 只允许留在报告里，不能进入未来写入计划。',
    '- ambiguous hints 必须在写入前人工处理或明确跳过。',
    '- 输出位于 `data_local` 时不要提交。',
    '',
  ].filter((line) => line !== '').join('\n')
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.get('in') || DEFAULT_INPUT
  const output = args.get('out') || DEFAULT_OUTPUT
  const reportOutput = args.get('report') || DEFAULT_REPORT
  const topLimit = numberArg(args, 'top', DEFAULT_TOP_LIMIT)

  const resolvedInput = path.resolve(input)
  const resolvedOutput = path.resolve(output)
  const resolvedReportOutput = path.resolve(reportOutput)

  const preview = await readJsonFile(resolvedInput)
  const audit = auditBangumiWorkEntityLinkPreview(preview)
  const report = createBangumiWorkEntityLinkAuditReport(audit, { inputPath: resolvedInput, topLimit })

  await writeJsonFile(resolvedOutput, audit)
  console.log(`Wrote Bangumi work/entity link audit -> ${resolvedOutput}`)

  await mkdir(path.dirname(resolvedReportOutput), { recursive: true })
  await writeFile(resolvedReportOutput, `${REPORT_UTF8_BOM}${report}\n`, 'utf8')
  console.log(`Wrote Bangumi work/entity link audit report -> ${resolvedReportOutput}`)

  if (audit.meta.status !== 'pass') process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
