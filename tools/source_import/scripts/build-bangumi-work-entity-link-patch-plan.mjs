#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeJsonFile } from '../lib/jsonl.mjs'

const DEFAULT_TOP_LIMIT = 100
const DEFAULT_PREVIEW_INPUT = path.join('data_local', 'payload', 'bangumi-work-entity-link-preview.json')
const DEFAULT_AUDIT_INPUT = path.join('data_local', 'reports', 'bangumi-work-entity-link-audit.json')
const DEFAULT_OUTPUT = path.join('data_local', 'payload', 'bangumi-work-entity-link-patch-plan.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-work-entity-link-patch-plan.md')
const REPORT_UTF8_BOM = '\uFEFF'

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

function rows(value) {
  return Array.isArray(value) ? value : []
}

function workKey(work) {
  return cleanText(work?.siteId || work?.slug || work?.title)
}

function relationKey(link) {
  return [link?.collection, link?.siteId || link?.slug, link?.role, link?.originalRole].map(cleanText).join('|').toLowerCase()
}

function normalizeWorkIdentity(work) {
  return {
    siteId: cleanText(work?.siteId),
    slug: cleanText(work?.slug),
    title: cleanText(work?.title),
    originalTitle: cleanText(work?.originalTitle),
    bangumiSubjectId: cleanText(work?.bangumiSubjectId),
  }
}

function normalizePlanRelation(link) {
  const source = link?.source || {}
  return {
    collection: cleanText(link?.collection),
    siteId: cleanText(link?.siteId),
    slug: cleanText(link?.slug),
    name: cleanText(link?.name),
    role: cleanText(link?.role),
    originalRole: cleanText(link?.originalRole),
    matchedBy: cleanText(link?.matchedBy || 'name'),
    source: {
      type: cleanText(source?.type || 'bangumi-credit-hint'),
      role: cleanText(source?.role || link?.role),
      originalRole: cleanText(source?.originalRole || link?.originalRole),
      source: cleanText(source?.source || 'bangumi'),
      note: cleanText(source?.note),
      rawLine: cleanText(source?.rawLine),
    },
  }
}

function uniqueRelations(links) {
  const output = []
  const seen = new Set()

  for (const link of rows(links)) {
    const key = relationKey(link)
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(normalizePlanRelation(link))
  }

  return output
}

function auditAllowsPlan(audit, { requireAuditPass }) {
  if (!requireAuditPass) {
    return { ok: true, reason: 'audit-check-disabled' }
  }

  if (!audit) {
    return { ok: false, reason: 'audit-missing' }
  }

  if (cleanText(audit?.meta?.mode) !== 'audit-only-no-payload-write') {
    return { ok: false, reason: 'audit-mode-invalid' }
  }

  if (cleanText(audit?.meta?.status) !== 'pass') {
    return { ok: false, reason: 'audit-not-pass' }
  }

  if (Number(audit?.meta?.errors ?? 0) > 0) {
    return { ok: false, reason: 'audit-has-errors' }
  }

  return { ok: true, reason: 'audit-pass' }
}

export function buildBangumiWorkEntityLinkPatchPlan(preview, audit = null, { requireAuditPass = true } = {}) {
  const previewMode = cleanText(preview?.meta?.mode)
  const auditCheck = auditAllowsPlan(audit, { requireAuditPass })
  const works = rows(preview?.works)
  const plannedWorks = []
  const skippedWorks = []

  const canPlan = previewMode === 'preview-only-no-payload-write' && auditCheck.ok

  for (const row of works) {
    const work = normalizeWorkIdentity(row?.work || {})
    const creators = uniqueRelations(row?.creators)
    const organizations = uniqueRelations(row?.organizations)
    const unmatchedCreatorHints = rows(row?.unmatchedCreatorHints).length
    const unmatchedOrganizationHints = rows(row?.unmatchedOrganizationHints).length
    const ambiguousCreatorHints = rows(row?.ambiguousCreatorHints).length
    const ambiguousOrganizationHints = rows(row?.ambiguousOrganizationHints).length
    const hasAmbiguous = ambiguousCreatorHints > 0 || ambiguousOrganizationHints > 0
    const hasLinks = creators.length > 0 || organizations.length > 0
    const reasons = []

    if (!canPlan) reasons.push(auditCheck.ok ? 'preview-mode-invalid' : auditCheck.reason)
    if (!workKey(work)) reasons.push('missing-work-identity')
    if (!hasLinks) reasons.push('no-matched-links')
    if (hasAmbiguous) reasons.push('ambiguous-hints-present')

    if (reasons.length > 0) {
      skippedWorks.push({
        work,
        reasons,
        matchedCreatorLinks: creators.length,
        matchedOrganizationLinks: organizations.length,
        unmatchedCreatorHints,
        unmatchedOrganizationHints,
        ambiguousCreatorHints,
        ambiguousOrganizationHints,
      })
      continue
    }

    plannedWorks.push({
      work,
      operation: 'patch-work-relationships',
      mode: 'plan-only-no-payload-write',
      relationships: {
        creators,
        organizations,
      },
      skippedHints: {
        unmatchedCreatorHints,
        unmatchedOrganizationHints,
        ambiguousCreatorHints,
        ambiguousOrganizationHints,
      },
    })
  }

  const plannedCreatorLinksTotal = plannedWorks.reduce((sum, row) => sum + row.relationships.creators.length, 0)
  const plannedOrganizationLinksTotal = plannedWorks.reduce((sum, row) => sum + row.relationships.organizations.length, 0)
  const skippedMatchedCreatorLinksTotal = skippedWorks.reduce((sum, row) => sum + row.matchedCreatorLinks, 0)
  const skippedMatchedOrganizationLinksTotal = skippedWorks.reduce((sum, row) => sum + row.matchedOrganizationLinks, 0)

  return {
    meta: {
      source: 'bangumi-work-entity-link-patch-plan',
      mode: 'plan-only-no-payload-write',
      generatedAt: new Date().toISOString(),
      previewMode,
      auditMode: cleanText(audit?.meta?.mode),
      auditStatus: cleanText(audit?.meta?.status),
      auditRequired: Boolean(requireAuditPass),
      auditCheck: auditCheck.reason,
      worksTotal: works.length,
      plannedWorksTotal: plannedWorks.length,
      skippedWorksTotal: skippedWorks.length,
      plannedCreatorLinksTotal,
      plannedOrganizationLinksTotal,
      skippedMatchedCreatorLinksTotal,
      skippedMatchedOrganizationLinksTotal,
      unmatchedCreatorHintsTotal: plannedWorks.reduce((sum, row) => sum + row.skippedHints.unmatchedCreatorHints, 0)
        + skippedWorks.reduce((sum, row) => sum + row.unmatchedCreatorHints, 0),
      unmatchedOrganizationHintsTotal: plannedWorks.reduce((sum, row) => sum + row.skippedHints.unmatchedOrganizationHints, 0)
        + skippedWorks.reduce((sum, row) => sum + row.unmatchedOrganizationHints, 0),
      ambiguousCreatorHintsTotal: plannedWorks.reduce((sum, row) => sum + row.skippedHints.ambiguousCreatorHints, 0)
        + skippedWorks.reduce((sum, row) => sum + row.ambiguousCreatorHints, 0),
      ambiguousOrganizationHintsTotal: plannedWorks.reduce((sum, row) => sum + row.skippedHints.ambiguousOrganizationHints, 0)
        + skippedWorks.reduce((sum, row) => sum + row.ambiguousOrganizationHints, 0),
    },
    works: plannedWorks,
    skippedWorks,
  }
}

function relationSummary(relations, limit = 6) {
  const items = rows(relations)
  if (items.length === 0) return ''
  return items.slice(0, limit).map((item) => `${item.name}${item.role ? `(${item.role})` : ''}`).join('；') + (items.length > limit ? `；+${items.length - limit}` : '')
}

function reasonSummary(reasons) {
  return rows(reasons).join('；')
}

export function createBangumiWorkEntityLinkPatchPlanReport(plan, { previewInputPath = '', auditInputPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const meta = plan.meta || {}
  const plannedWorks = rows(plan.works).slice(0, topLimit)
  const skippedWorks = rows(plan.skippedWorks).slice(0, topLimit)

  return [
    '# Bangumi work/entity link patch plan',
    '',
    `生成时间：${meta.generatedAt}`,
    previewInputPath ? `Preview 输入：\`${previewInputPath}\`` : '',
    auditInputPath ? `Audit 输入：\`${auditInputPath}\`` : '',
    '',
    '## 总览',
    '',
    `- 模式：${meta.mode}`,
    `- preview mode：${meta.previewMode}`,
    `- audit status：${meta.auditStatus}`,
    `- audit check：${meta.auditCheck}`,
    `- works：${meta.worksTotal}`,
    `- planned works：${meta.plannedWorksTotal}`,
    `- skipped works：${meta.skippedWorksTotal}`,
    `- planned creator links：${meta.plannedCreatorLinksTotal}`,
    `- planned organization links：${meta.plannedOrganizationLinksTotal}`,
    `- skipped matched creator links：${meta.skippedMatchedCreatorLinksTotal}`,
    `- skipped matched organization links：${meta.skippedMatchedOrganizationLinksTotal}`,
    `- unmatched creator hints：${meta.unmatchedCreatorHintsTotal}`,
    `- unmatched organization hints：${meta.unmatchedOrganizationHintsTotal}`,
    `- ambiguous creator hints：${meta.ambiguousCreatorHintsTotal}`,
    `- ambiguous organization hints：${meta.ambiguousOrganizationHintsTotal}`,
    '',
    '## Planned works sample',
    '',
    plannedWorks.length === 0 ? '暂无。' : '| # | Work | Creators | Organizations | Skipped hints |',
    plannedWorks.length === 0 ? '' : '| ---: | --- | --- | --- | --- |',
    ...plannedWorks.map((row, index) => `| ${index + 1} | ${escapeMarkdownCell(row.work.title || row.work.slug || row.work.siteId)} | ${escapeMarkdownCell(relationSummary(row.relationships.creators))} | ${escapeMarkdownCell(relationSummary(row.relationships.organizations))} | ${escapeMarkdownCell(`unmatchedC=${row.skippedHints.unmatchedCreatorHints}; unmatchedO=${row.skippedHints.unmatchedOrganizationHints}; ambiguousC=${row.skippedHints.ambiguousCreatorHints}; ambiguousO=${row.skippedHints.ambiguousOrganizationHints}`)} |`),
    '',
    '## Skipped works sample',
    '',
    skippedWorks.length === 0 ? '暂无。' : '| # | Work | Reasons | Matched creators | Matched organizations |',
    skippedWorks.length === 0 ? '' : '| ---: | --- | --- | ---: | ---: |',
    ...skippedWorks.map((row, index) => `| ${index + 1} | ${escapeMarkdownCell(row.work.title || row.work.slug || row.work.siteId)} | ${escapeMarkdownCell(reasonSummary(row.reasons))} | ${row.matchedCreatorLinks} | ${row.matchedOrganizationLinks} |`),
    '',
    '## 安全说明',
    '',
    '- 这是本地写入计划，不调用 Payload API。',
    '- 不创建、不更新、不 PATCH works。',
    '- 只包含未来可能写入 relationships 的候选结构。',
    '- unmatched hints 不进入写入计划，只保留统计。',
    '- ambiguous hints 默认阻止对应 work 进入写入计划。',
    '- 输出位于 `data_local` 时不要提交。',
    '',
  ].filter((line) => line !== '').join('\n')
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const previewInput = args.get('preview') || DEFAULT_PREVIEW_INPUT
  const auditInput = args.get('audit') || DEFAULT_AUDIT_INPUT
  const output = args.get('out') || DEFAULT_OUTPUT
  const reportOutput = args.get('report') || DEFAULT_REPORT
  const topLimit = numberArg(args, 'top', DEFAULT_TOP_LIMIT)
  const requireAuditPass = args.get('no-require-audit-pass') !== 'true'

  const resolvedPreviewInput = path.resolve(previewInput)
  const resolvedAuditInput = path.resolve(auditInput)
  const resolvedOutput = path.resolve(output)
  const resolvedReportOutput = path.resolve(reportOutput)

  const preview = await readJsonFile(resolvedPreviewInput)
  const audit = await readJsonFile(resolvedAuditInput)
  const plan = buildBangumiWorkEntityLinkPatchPlan(preview, audit, { requireAuditPass })
  const report = createBangumiWorkEntityLinkPatchPlanReport(plan, {
    previewInputPath: resolvedPreviewInput,
    auditInputPath: resolvedAuditInput,
    topLimit,
  })

  await writeJsonFile(resolvedOutput, plan)
  console.log(`Wrote Bangumi work/entity link patch plan -> ${resolvedOutput}`)

  await mkdir(path.dirname(resolvedReportOutput), { recursive: true })
  await writeFile(resolvedReportOutput, `${REPORT_UTF8_BOM}${report}\n`, 'utf8')
  console.log(`Wrote Bangumi work/entity link patch plan report -> ${resolvedReportOutput}`)

  if (plan.meta.auditCheck !== 'audit-pass') process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
