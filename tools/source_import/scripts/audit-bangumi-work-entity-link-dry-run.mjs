#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeJsonFile } from '../lib/jsonl.mjs'

const DEFAULT_TOP_LIMIT = 100
const DEFAULT_DRY_RUN_INPUT = path.join('data_local', 'reports', 'bangumi-work-entity-link-import-dry-run.json')
const DEFAULT_PLAN_INPUT = path.join('data_local', 'payload', 'bangumi-work-entity-link-patch-plan.json')
const DEFAULT_OUTPUT = path.join('data_local', 'reports', 'bangumi-work-entity-link-import-dry-run-audit.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-work-entity-link-import-dry-run-audit.md')
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

function addIssue(issues, level, code, message, pathName = '', details = {}) {
  issues.push({ level, code, message, path: pathName, details })
}

function countLevels(issues) {
  return {
    errors: issues.filter((issue) => issue.level === 'error').length,
    warnings: issues.filter((issue) => issue.level === 'warning').length,
    infos: issues.filter((issue) => issue.level === 'info').length,
  }
}

function relationCount(action, key) {
  return rows(action?.patchPreview?.[key]).length
}

function relationHasRequiredShape(relation) {
  return Boolean(
    cleanText(relation?.collection)
    && (cleanText(relation?.siteId) || cleanText(relation?.slug))
    && cleanText(relation?.name)
    && cleanText(relation?.role)
    && cleanText(relation?.source?.type) === 'bangumi-credit-hint'
  )
}

function relationKey(relation) {
  return [relation?.collection, relation?.siteId || relation?.slug, relation?.role, relation?.originalRole].map(cleanText).join('|').toLowerCase()
}

function validateActionRelations(issues, action, actionIndex, key, expectedCollection) {
  const seen = new Set()
  const relations = rows(action?.patchPreview?.[key])

  relations.forEach((relation, relationIndex) => {
    const pathName = `actions[${actionIndex}].patchPreview.${key}[${relationIndex}]`
    if (cleanText(relation?.collection) !== expectedCollection) {
      addIssue(issues, 'error', 'invalid-relation-collection', `${key} relation collection must be ${expectedCollection}.`, pathName, { collection: relation?.collection })
    }

    if (!relationHasRequiredShape(relation)) {
      addIssue(issues, 'error', 'invalid-relation-shape', `${key} relation is missing identity, name, role, or bangumi source type.`, pathName)
    }

    const keyValue = relationKey(relation)
    if (seen.has(keyValue)) {
      addIssue(issues, 'error', 'duplicate-action-relation', `Duplicate ${key} relation inside one dry-run action.`, pathName, { key: keyValue })
    }
    seen.add(keyValue)
  })
}

export function auditBangumiWorkEntityLinkImportDryRun(dryRun, plan = null) {
  const issues = []
  const meta = dryRun?.meta || {}
  const actions = rows(dryRun?.actions)
  const skippedPlanWorks = rows(dryRun?.skippedPlanWorks)
  const planMeta = plan?.meta || null
  const planWorks = rows(plan?.works)
  const planSkippedWorks = rows(plan?.skippedWorks)

  if (cleanText(meta.source) !== 'bangumi-work-entity-link-import-dry-run') {
    addIssue(issues, 'error', 'invalid-dry-run-source', 'Dry-run source must be bangumi-work-entity-link-import-dry-run.', 'meta.source', { actual: meta.source })
  }

  if (cleanText(meta.mode) !== 'dry-run-only-no-payload-write') {
    addIssue(issues, 'error', 'invalid-dry-run-mode', 'Dry-run mode must be dry-run-only-no-payload-write.', 'meta.mode', { actual: meta.mode })
  }

  if (cleanText(meta.status) !== 'pass') {
    addIssue(issues, 'error', 'dry-run-not-pass', 'Dry-run result must be pass before any write PR can be prepared.', 'meta.status', { actual: meta.status })
  }

  if (meta.dryRun !== true) {
    addIssue(issues, 'error', 'dry-run-flag-not-true', 'Dry-run flag must be true.', 'meta.dryRun', { actual: meta.dryRun })
  }

  if (cleanText(meta.planMode) !== 'plan-only-no-payload-write') {
    addIssue(issues, 'error', 'invalid-plan-mode-marker', 'Dry-run must point back to a plan-only patch plan.', 'meta.planMode', { actual: meta.planMode })
  }

  if (cleanText(meta.auditCheck) !== 'audit-pass') {
    addIssue(issues, 'error', 'audit-marker-not-pass', 'Dry-run must point back to a passing audit.', 'meta.auditCheck', { actual: meta.auditCheck })
  }

  if (Number(meta.errors ?? 0) !== 0) {
    addIssue(issues, 'error', 'dry-run-has-errors', 'Dry-run meta.errors must be 0.', 'meta.errors', { actual: meta.errors })
  }

  if (Number(meta.worksTotal) !== actions.length) {
    addIssue(issues, 'error', 'works-total-mismatch', 'meta.worksTotal must match actions.length.', 'meta.worksTotal', { expected: actions.length, actual: meta.worksTotal })
  }

  if (Number(meta.actionsTotal) !== actions.length) {
    addIssue(issues, 'error', 'actions-total-mismatch', 'meta.actionsTotal must match actions.length.', 'meta.actionsTotal', { expected: actions.length, actual: meta.actionsTotal })
  }

  const wouldPatchWorksTotal = actions.filter((action) => action?.wouldPatch === true).length
  const creatorLinksTotal = actions.reduce((sum, action) => sum + relationCount(action, 'creators'), 0)
  const organizationLinksTotal = actions.reduce((sum, action) => sum + relationCount(action, 'organizations'), 0)

  if (Number(meta.wouldPatchWorksTotal) !== wouldPatchWorksTotal) {
    addIssue(issues, 'error', 'would-patch-total-mismatch', 'meta.wouldPatchWorksTotal must match actions with wouldPatch=true.', 'meta.wouldPatchWorksTotal', { expected: wouldPatchWorksTotal, actual: meta.wouldPatchWorksTotal })
  }

  if (Number(meta.creatorLinksTotal) !== creatorLinksTotal) {
    addIssue(issues, 'error', 'creator-links-total-mismatch', 'meta.creatorLinksTotal must match dry-run creator links.', 'meta.creatorLinksTotal', { expected: creatorLinksTotal, actual: meta.creatorLinksTotal })
  }

  if (Number(meta.organizationLinksTotal) !== organizationLinksTotal) {
    addIssue(issues, 'error', 'organization-links-total-mismatch', 'meta.organizationLinksTotal must match dry-run organization links.', 'meta.organizationLinksTotal', { expected: organizationLinksTotal, actual: meta.organizationLinksTotal })
  }

  actions.forEach((action, actionIndex) => {
    const pathName = `actions[${actionIndex}]`
    if (cleanText(action?.action) !== 'dry-run-patch-work-relationships') {
      addIssue(issues, 'error', 'invalid-action-type', 'Dry-run action type must be dry-run-patch-work-relationships.', `${pathName}.action`, { actual: action?.action })
    }
    if (action?.dryRun !== true) {
      addIssue(issues, 'error', 'action-dry-run-not-true', 'Every action must keep dryRun=true.', `${pathName}.dryRun`, { actual: action?.dryRun })
    }
    if (action?.wouldPatch !== true) {
      addIssue(issues, 'error', 'action-would-patch-not-true', 'Every planned dry-run action should be patchable.', `${pathName}.wouldPatch`, { actual: action?.wouldPatch })
    }
    if (!cleanText(action?.work?.siteId) && !cleanText(action?.work?.slug)) {
      addIssue(issues, 'error', 'missing-action-work-locator', 'Action work must have siteId or slug.', `${pathName}.work`)
    }
    validateActionRelations(issues, action, actionIndex, 'creators', 'creators')
    validateActionRelations(issues, action, actionIndex, 'organizations', 'organizations')
  })

  if (planMeta) {
    if (cleanText(planMeta.mode) !== 'plan-only-no-payload-write') {
      addIssue(issues, 'error', 'input-plan-mode-invalid', 'Input plan mode must be plan-only-no-payload-write.', 'plan.meta.mode', { actual: planMeta.mode })
    }
    if (cleanText(planMeta.auditCheck) !== 'audit-pass') {
      addIssue(issues, 'error', 'input-plan-audit-not-pass', 'Input plan auditCheck must be audit-pass.', 'plan.meta.auditCheck', { actual: planMeta.auditCheck })
    }
    if (Number(planMeta.plannedWorksTotal) !== actions.length || planWorks.length !== actions.length) {
      addIssue(issues, 'error', 'plan-actions-count-mismatch', 'Plan planned works must match dry-run actions.', 'plan.works', {
        planMetaPlannedWorksTotal: planMeta.plannedWorksTotal,
        planWorksLength: planWorks.length,
        actionsLength: actions.length,
      })
    }
    if (Number(planMeta.skippedWorksTotal) !== skippedPlanWorks.length || planSkippedWorks.length !== skippedPlanWorks.length) {
      addIssue(issues, 'error', 'plan-skipped-count-mismatch', 'Plan skipped works must match dry-run skippedPlanWorks.', 'plan.skippedWorks', {
        planMetaSkippedWorksTotal: planMeta.skippedWorksTotal,
        planSkippedWorksLength: planSkippedWorks.length,
        dryRunSkippedPlanWorksLength: skippedPlanWorks.length,
      })
    }
  }

  if (skippedPlanWorks.length > 0) {
    addIssue(issues, 'info', 'skipped-plan-works-present', 'Skipped plan works are present and must remain outside write actions.', 'skippedPlanWorks', { skippedPlanWorksTotal: skippedPlanWorks.length })
  }

  const levels = countLevels(issues)

  return {
    meta: {
      source: 'bangumi-work-entity-link-import-dry-run-audit',
      mode: 'audit-only-no-payload-write',
      generatedAt: new Date().toISOString(),
      status: levels.errors === 0 ? 'pass' : 'fail',
      errors: levels.errors,
      warnings: levels.warnings,
      infos: levels.infos,
    },
    stats: {
      dryRunMode: cleanText(meta.mode),
      dryRunStatus: cleanText(meta.status),
      planMode: cleanText(meta.planMode),
      auditCheck: cleanText(meta.auditCheck),
      actionsTotal: actions.length,
      wouldPatchWorksTotal,
      skippedPlanWorksTotal: skippedPlanWorks.length,
      creatorLinksTotal,
      organizationLinksTotal,
    },
    issues,
  }
}

function issueTable(issues, limit = DEFAULT_TOP_LIMIT) {
  const limited = rows(issues).slice(0, limit)
  if (limited.length === 0) return '暂无。\n'
  return [
    '| Level | Code | Path | Message |',
    '| --- | --- | --- | --- |',
    ...limited.map((issue) => `| ${escapeMarkdownCell(issue.level)} | ${escapeMarkdownCell(issue.code)} | ${escapeMarkdownCell(issue.path)} | ${escapeMarkdownCell(issue.message)} |`),
    '',
  ].join('\n')
}

export function createBangumiWorkEntityLinkImportDryRunAuditReport(audit, { dryRunInputPath = '', planInputPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const meta = audit.meta || {}
  const stats = audit.stats || {}

  return [
    '# Bangumi work/entity link import dry-run audit',
    '',
    `生成时间：${meta.generatedAt}`,
    dryRunInputPath ? `Dry-run 输入：\`${dryRunInputPath}\`` : '',
    planInputPath ? `Plan 输入：\`${planInputPath}\`` : '',
    '',
    '## 总览',
    '',
    `- 模式：${meta.mode}`,
    `- 状态：${meta.status}`,
    `- errors：${meta.errors}`,
    `- warnings：${meta.warnings}`,
    `- infos：${meta.infos}`,
    `- dry-run mode：${stats.dryRunMode}`,
    `- dry-run status：${stats.dryRunStatus}`,
    `- plan mode：${stats.planMode}`,
    `- audit check：${stats.auditCheck}`,
    `- actions：${stats.actionsTotal}`,
    `- would patch works：${stats.wouldPatchWorksTotal}`,
    `- skipped plan works：${stats.skippedPlanWorksTotal}`,
    `- creator links：${stats.creatorLinksTotal}`,
    `- organization links：${stats.organizationLinksTotal}`,
    '',
    '## Issues',
    '',
    issueTable(audit.issues, topLimit),
    '## 安全说明',
    '',
    '- 这是 dry-run 结果审计，不调用 Payload API。',
    '- 不创建、不更新、不 PATCH works。',
    '- 不写入 relationships。',
    '- 只有 dry-run 审计 pass 后，才适合另开真实写入 PR。',
    '- 输出位于 `data_local` 时不要提交。',
    '',
  ].filter((line) => line !== '').join('\n')
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const dryRunInput = args.get('dry-run') || DEFAULT_DRY_RUN_INPUT
  const planInput = args.get('plan') || DEFAULT_PLAN_INPUT
  const output = args.get('out') || DEFAULT_OUTPUT
  const reportOutput = args.get('report') || DEFAULT_REPORT
  const topLimit = numberArg(args, 'top', DEFAULT_TOP_LIMIT)

  const resolvedDryRunInput = path.resolve(dryRunInput)
  const resolvedPlanInput = path.resolve(planInput)
  const resolvedOutput = path.resolve(output)
  const resolvedReportOutput = path.resolve(reportOutput)

  const dryRun = await readJsonFile(resolvedDryRunInput)
  const plan = await readJsonFile(resolvedPlanInput)
  const audit = auditBangumiWorkEntityLinkImportDryRun(dryRun, plan)
  const report = createBangumiWorkEntityLinkImportDryRunAuditReport(audit, {
    dryRunInputPath: resolvedDryRunInput,
    planInputPath: resolvedPlanInput,
    topLimit,
  })

  await writeJsonFile(resolvedOutput, audit)
  console.log(`Wrote Bangumi work/entity link dry-run audit -> ${resolvedOutput}`)

  await mkdir(path.dirname(resolvedReportOutput), { recursive: true })
  await writeFile(resolvedReportOutput, `${REPORT_UTF8_BOM}${report}\n`, 'utf8')
  console.log(`Wrote Bangumi work/entity link dry-run audit report -> ${resolvedReportOutput}`)

  if (audit.meta.status !== 'pass') process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
