#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeJsonFile } from '../lib/jsonl.mjs'

const DEFAULT_TOP_LIMIT = 100
const DEFAULT_PLAN_INPUT = path.join('data_local', 'payload', 'bangumi-work-entity-link-patch-plan.json')
const DEFAULT_OUTPUT = path.join('data_local', 'reports', 'bangumi-work-entity-link-import-dry-run.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-work-entity-link-import-dry-run.md')
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

function workLabel(work) {
  return cleanText(work?.title || work?.slug || work?.siteId)
}

function workLocator(work) {
  return {
    siteId: cleanText(work?.siteId),
    slug: cleanText(work?.slug),
    title: cleanText(work?.title),
    bangumiSubjectId: cleanText(work?.bangumiSubjectId),
  }
}

function relationLocator(relation) {
  return {
    collection: cleanText(relation?.collection),
    siteId: cleanText(relation?.siteId),
    slug: cleanText(relation?.slug),
    name: cleanText(relation?.name),
    role: cleanText(relation?.role),
    originalRole: cleanText(relation?.originalRole),
    matchedBy: cleanText(relation?.matchedBy || 'name'),
    source: relation?.source || {},
  }
}

function relationKey(relation) {
  return [relation?.collection, relation?.siteId || relation?.slug, relation?.role, relation?.originalRole].map(cleanText).join('|').toLowerCase()
}

function relationValid(relation) {
  return Boolean(
    cleanText(relation?.collection)
    && (cleanText(relation?.siteId) || cleanText(relation?.slug))
    && cleanText(relation?.name)
    && cleanText(relation?.role)
    && cleanText(relation?.source?.type) === 'bangumi-credit-hint'
  )
}

function validateRelations(relations, collection) {
  const issues = []
  const seen = new Set()

  rows(relations).forEach((relation, index) => {
    const pathName = `${collection}[${index}]`
    if (cleanText(relation?.collection) !== collection) {
      issues.push({ code: 'invalid-relation-collection', path: pathName, message: `Relation collection must be ${collection}.` })
    }
    if (!relationValid(relation)) {
      issues.push({ code: 'invalid-relation-shape', path: pathName, message: 'Relation is missing identity, role, name, or bangumi source type.' })
    }
    const key = relationKey(relation)
    if (seen.has(key)) issues.push({ code: 'duplicate-relation', path: pathName, message: 'Duplicate relation candidate within one work.' })
    else seen.add(key)
  })

  return issues
}

function buildPayloadPatchPreview(workRow) {
  const relationships = workRow?.relationships || {}
  return {
    creators: rows(relationships.creators).map(relationLocator),
    organizations: rows(relationships.organizations).map(relationLocator),
  }
}

export function buildBangumiWorkEntityLinkImportDryRun(plan, { dryRun = true } = {}) {
  const issues = []
  const works = rows(plan?.works)
  const skippedWorks = rows(plan?.skippedWorks)
  const planMode = cleanText(plan?.meta?.mode)
  const auditCheck = cleanText(plan?.meta?.auditCheck)

  if (!dryRun) {
    issues.push({ level: 'error', code: 'write-mode-disabled', path: 'args.dryRun', message: 'This importer skeleton only supports dry-run mode.' })
  }

  if (planMode !== 'plan-only-no-payload-write') {
    issues.push({ level: 'error', code: 'invalid-plan-mode', path: 'meta.mode', message: 'Patch plan mode must be plan-only-no-payload-write.' })
  }

  if (auditCheck !== 'audit-pass') {
    issues.push({ level: 'error', code: 'audit-not-pass', path: 'meta.auditCheck', message: 'Patch plan must come from a passing audit.' })
  }

  const actions = []
  let creatorLinksTotal = 0
  let organizationLinksTotal = 0

  works.forEach((workRow, workIndex) => {
    const work = workLocator(workRow?.work || {})
    const pathBase = `works[${workIndex}]`
    const creators = rows(workRow?.relationships?.creators)
    const organizations = rows(workRow?.relationships?.organizations)
    const validationIssues = [
      ...validateRelations(creators, 'creators'),
      ...validateRelations(organizations, 'organizations'),
    ]

    if (!work.siteId && !work.slug) {
      validationIssues.push({ code: 'missing-work-locator', path: `${pathBase}.work`, message: 'Work is missing siteId/slug locator.' })
    }

    for (const issue of validationIssues) {
      issues.push({ level: 'error', ...issue, path: `${pathBase}.${issue.path}` })
    }

    const action = {
      action: 'dry-run-patch-work-relationships',
      path: pathBase,
      work,
      dryRun: true,
      wouldPatch: validationIssues.length === 0,
      patchPreview: buildPayloadPatchPreview(workRow),
      skippedHints: workRow?.skippedHints || {},
    }

    creatorLinksTotal += action.patchPreview.creators.length
    organizationLinksTotal += action.patchPreview.organizations.length
    actions.push(action)
  })

  if (skippedWorks.length > 0) {
    issues.push({
      level: 'info',
      code: 'plan-skipped-works-present',
      path: 'skippedWorks',
      message: 'Some works were skipped by the patch plan and will not be patched.',
      details: { skippedWorksTotal: skippedWorks.length },
    })
  }

  const errorCount = issues.filter((issue) => issue.level === 'error').length
  const warningCount = issues.filter((issue) => issue.level === 'warning').length
  const infoCount = issues.filter((issue) => issue.level === 'info').length

  return {
    meta: {
      source: 'bangumi-work-entity-link-import-dry-run',
      mode: 'dry-run-only-no-payload-write',
      generatedAt: new Date().toISOString(),
      status: errorCount === 0 ? 'pass' : 'fail',
      dryRun: true,
      planMode,
      auditCheck,
      worksTotal: works.length,
      actionsTotal: actions.length,
      wouldPatchWorksTotal: actions.filter((action) => action.wouldPatch).length,
      skippedPlanWorksTotal: skippedWorks.length,
      creatorLinksTotal,
      organizationLinksTotal,
      errors: errorCount,
      warnings: warningCount,
      infos: infoCount,
    },
    actions,
    skippedPlanWorks: skippedWorks,
    issues,
  }
}

function relationSummary(relations, limit = 6) {
  const values = rows(relations)
  if (values.length === 0) return ''
  return values.slice(0, limit).map((relation) => `${relation.name}${relation.role ? `(${relation.role})` : ''}`).join('；') + (values.length > limit ? `；+${values.length - limit}` : '')
}

function issueTable(issues, limit) {
  const limited = rows(issues).slice(0, limit)
  if (limited.length === 0) return '暂无。\n'
  return [
    '| Level | Code | Path | Message |',
    '| --- | --- | --- | --- |',
    ...limited.map((issue) => `| ${escapeMarkdownCell(issue.level)} | ${escapeMarkdownCell(issue.code)} | ${escapeMarkdownCell(issue.path)} | ${escapeMarkdownCell(issue.message)} |`),
    '',
  ].join('\n')
}

export function createBangumiWorkEntityLinkImportDryRunReport(dryRun, { planInputPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const meta = dryRun.meta || {}
  const actions = rows(dryRun.actions).slice(0, topLimit)

  return [
    '# Bangumi work/entity link import dry-run',
    '',
    `生成时间：${meta.generatedAt}`,
    planInputPath ? `Plan 输入：\`${planInputPath}\`` : '',
    '',
    '## 总览',
    '',
    `- 模式：${meta.mode}`,
    `- 状态：${meta.status}`,
    `- dryRun：${meta.dryRun}`,
    `- plan mode：${meta.planMode}`,
    `- audit check：${meta.auditCheck}`,
    `- planned works：${meta.worksTotal}`,
    `- dry-run actions：${meta.actionsTotal}`,
    `- would patch works：${meta.wouldPatchWorksTotal}`,
    `- skipped plan works：${meta.skippedPlanWorksTotal}`,
    `- creator links：${meta.creatorLinksTotal}`,
    `- organization links：${meta.organizationLinksTotal}`,
    `- errors：${meta.errors}`,
    `- warnings：${meta.warnings}`,
    `- infos：${meta.infos}`,
    '',
    '## Dry-run actions sample',
    '',
    actions.length === 0 ? '暂无。' : '| # | Work | Would patch | Creators | Organizations |',
    actions.length === 0 ? '' : '| ---: | --- | --- | --- | --- |',
    ...actions.map((action, index) => `| ${index + 1} | ${escapeMarkdownCell(workLabel(action.work))} | ${action.wouldPatch ? 'yes' : 'no'} | ${escapeMarkdownCell(relationSummary(action.patchPreview.creators))} | ${escapeMarkdownCell(relationSummary(action.patchPreview.organizations))} |`),
    '',
    '## Issues',
    '',
    issueTable(dryRun.issues, topLimit),
    '## 安全说明',
    '',
    '- 这是 dry-run importer skeleton，不调用 Payload API。',
    '- 不创建、不更新、不 PATCH works。',
    '- 不写入 relationships。',
    '- 只输出未来真实 importer 会执行的模拟 action。',
    '- 输出位于 `data_local` 时不要提交。',
    '',
  ].filter((line) => line !== '').join('\n')
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const planInput = args.get('plan') || DEFAULT_PLAN_INPUT
  const output = args.get('out') || DEFAULT_OUTPUT
  const reportOutput = args.get('report') || DEFAULT_REPORT
  const topLimit = numberArg(args, 'top', DEFAULT_TOP_LIMIT)
  const dryRun = args.get('dry-run') !== 'false'

  const resolvedPlanInput = path.resolve(planInput)
  const resolvedOutput = path.resolve(output)
  const resolvedReportOutput = path.resolve(reportOutput)

  const plan = await readJsonFile(resolvedPlanInput)
  const dryRunResult = buildBangumiWorkEntityLinkImportDryRun(plan, { dryRun })
  const report = createBangumiWorkEntityLinkImportDryRunReport(dryRunResult, { planInputPath: resolvedPlanInput, topLimit })

  await writeJsonFile(resolvedOutput, dryRunResult)
  console.log(`Wrote Bangumi work/entity link import dry-run -> ${resolvedOutput}`)

  await mkdir(path.dirname(resolvedReportOutput), { recursive: true })
  await writeFile(resolvedReportOutput, `${REPORT_UTF8_BOM}${report}\n`, 'utf8')
  console.log(`Wrote Bangumi work/entity link import dry-run report -> ${resolvedReportOutput}`)

  if (dryRunResult.meta.status !== 'pass') process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
