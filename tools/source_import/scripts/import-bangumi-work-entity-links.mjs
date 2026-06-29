#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeJsonFile } from '../lib/jsonl.mjs'

const DEFAULT_TOP_LIMIT = 100
const DEFAULT_PLAN_INPUT = path.join('data_local', 'payload', 'bangumi-work-entity-link-patch-plan.json')
const DEFAULT_DRY_RUN_AUDIT_INPUT = path.join('data_local', 'reports', 'bangumi-work-entity-link-import-dry-run-audit.json')
const DEFAULT_OUTPUT = path.join('data_local', 'reports', 'bangumi-work-entity-link-import-dry-run.json')
const DEFAULT_APPLY_OUTPUT = path.join('data_local', 'reports', 'bangumi-work-entity-link-import-apply.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-work-entity-link-import-dry-run.md')
const DEFAULT_APPLY_REPORT = path.join('data_local', 'reports', 'bangumi-work-entity-link-import-apply.md')
const REPORT_UTF8_BOM = '\uFEFF'
const APPLY_CONFIRM_TEXT = 'APPLY_WORK_ENTITY_LINKS'

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
    issues.push({ level: 'error', code: 'write-mode-disabled', path: 'args.dryRun', message: 'Use --apply with --confirm for the guarded apply path; --dry-run false is not supported.' })
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

function extractId(value) {
  if (!value) return ''
  if (typeof value === 'string') return cleanText(value)
  return cleanText(value.id || value.value || value.doc?.id)
}

function uniqueIds(values) {
  const seen = new Set()
  const output = []
  for (const value of values.map(extractId).filter(Boolean)) {
    if (seen.has(value)) continue
    seen.add(value)
    output.push(value)
  }
  return output
}

function creditKey(row, relationField) {
  return [extractId(row?.[relationField]), row?.role, row?.originalRole, row?.source].map(cleanText).join('|').toLowerCase()
}

function bangumiSource(relation) {
  return cleanText(relation?.source?.source || 'bangumi') || 'bangumi'
}

export function buildWorkRelationshipPatch(existingWork, action, resolved) {
  const existingCreatorIds = uniqueIds(rows(existingWork?.creators))
  const nextCreatorIds = uniqueIds([...existingCreatorIds, ...rows(resolved.creators).map((item) => item.id)])

  const existingCreatorCredits = rows(existingWork?.creatorCredits)
  const nextCreatorCredits = existingCreatorCredits.map((row) => ({ ...row }))
  const seenCreatorCredits = new Set(nextCreatorCredits.map((row) => creditKey(row, 'creator')))
  for (const item of rows(resolved.creators)) {
    const relation = item.relation
    const row = {
      creator: item.id,
      role: cleanText(relation.role || 'other') || 'other',
      originalRole: cleanText(relation.originalRole),
      source: bangumiSource(relation),
      note: cleanText(relation.source?.note || relation.name),
    }
    const key = creditKey(row, 'creator')
    if (seenCreatorCredits.has(key)) continue
    seenCreatorCredits.add(key)
    nextCreatorCredits.push(row)
  }

  const existingOrganizations = rows(existingWork?.organizations)
  const nextOrganizations = existingOrganizations.map((row) => ({ ...row }))
  const seenOrganizations = new Set(nextOrganizations.map((row) => creditKey(row, 'organization')))
  for (const item of rows(resolved.organizations)) {
    const relation = item.relation
    const row = {
      organization: item.id,
      role: cleanText(relation.role || 'other') || 'other',
      originalRole: cleanText(relation.originalRole),
      source: bangumiSource(relation),
      note: cleanText(relation.source?.note || relation.name),
    }
    const key = creditKey(row, 'organization')
    if (seenOrganizations.has(key)) continue
    seenOrganizations.add(key)
    nextOrganizations.push(row)
  }

  const patch = {}
  if (nextCreatorIds.length !== existingCreatorIds.length) patch.creators = nextCreatorIds
  if (nextCreatorCredits.length !== existingCreatorCredits.length) patch.creatorCredits = nextCreatorCredits
  if (nextOrganizations.length !== existingOrganizations.length) patch.organizations = nextOrganizations

  return {
    patch,
    changed: Object.keys(patch).length > 0,
    addedCreatorIds: nextCreatorIds.length - existingCreatorIds.length,
    addedCreatorCredits: nextCreatorCredits.length - existingCreatorCredits.length,
    addedOrganizations: nextOrganizations.length - existingOrganizations.length,
  }
}

function applyPreflightIssues({ apply, confirm, dryRunAudit }) {
  const issues = []
  if (!apply) return issues
  if (confirm !== APPLY_CONFIRM_TEXT) {
    issues.push({ level: 'error', code: 'apply-confirm-missing', path: 'args.confirm', message: `Real apply requires --confirm ${APPLY_CONFIRM_TEXT}.` })
  }
  if (cleanText(dryRunAudit?.meta?.mode) !== 'audit-only-no-payload-write') {
    issues.push({ level: 'error', code: 'dry-run-audit-mode-invalid', path: 'dryRunAudit.meta.mode', message: 'Dry-run audit mode must be audit-only-no-payload-write.' })
  }
  if (cleanText(dryRunAudit?.meta?.status) !== 'pass') {
    issues.push({ level: 'error', code: 'dry-run-audit-not-pass', path: 'dryRunAudit.meta.status', message: 'Dry-run audit must pass before apply.' })
  }
  if (Number(dryRunAudit?.meta?.errors ?? 0) !== 0) {
    issues.push({ level: 'error', code: 'dry-run-audit-has-errors', path: 'dryRunAudit.meta.errors', message: 'Dry-run audit must have zero errors.' })
  }
  return issues
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { raw: text }
  }
  if (!response.ok) {
    const detail = payload ? JSON.stringify(payload, null, 2) : text
    throw new Error(`HTTP ${response.status} ${response.statusText}\n${detail}`)
  }
  return payload
}

async function login(baseUrl, email, password) {
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!result?.token) throw new Error('Payload login succeeded but did not return a token.')
  return result.token
}

function authHeaders(token) {
  return { Authorization: `JWT ${token}` }
}

function setWhere(params, field, operator, value) {
  params.set(`where[${field}][${operator}]`, String(value))
}

async function findOne(baseUrl, token, collection, field, value) {
  if (!value) return null
  const params = new URLSearchParams()
  setWhere(params, field, 'equals', value)
  params.set('limit', '1')
  const result = await requestJson(`${baseUrl}/api/${collection}?${params.toString()}`, {
    headers: authHeaders(token),
  })
  return result?.docs?.[0] || null
}

async function findPayloadDoc(baseUrl, token, collection, locator) {
  const bySiteId = await findOne(baseUrl, token, collection, 'siteId', locator.siteId)
  if (bySiteId) return { doc: bySiteId, matchedBy: 'siteId' }
  const bySlug = await findOne(baseUrl, token, collection, 'slug', locator.slug)
  if (bySlug) return { doc: bySlug, matchedBy: 'slug' }
  return { doc: null, matchedBy: '' }
}

async function updateWork(baseUrl, token, id, patch) {
  return requestJson(`${baseUrl}/api/works/${id}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  })
}

async function resolveAction(baseUrl, token, action) {
  const errors = []
  const workResult = await findPayloadDoc(baseUrl, token, 'works', action.work)
  if (!workResult.doc) {
    errors.push({ code: 'work-not-found', message: 'Work was not found by siteId or slug.', work: action.work })
  }

  const creators = []
  for (const relation of rows(action.patchPreview?.creators)) {
    const result = await findPayloadDoc(baseUrl, token, 'creators', relation)
    if (!result.doc) {
      errors.push({ code: 'creator-not-found', message: 'Creator was not found by siteId or slug.', relation })
      continue
    }
    creators.push({ id: result.doc.id, relation, matchedBy: result.matchedBy })
  }

  const organizations = []
  for (const relation of rows(action.patchPreview?.organizations)) {
    const result = await findPayloadDoc(baseUrl, token, 'organizations', relation)
    if (!result.doc) {
      errors.push({ code: 'organization-not-found', message: 'Organization was not found by siteId or slug.', relation })
      continue
    }
    organizations.push({ id: result.doc.id, relation, matchedBy: result.matchedBy })
  }

  return { work: workResult.doc, workMatchedBy: workResult.matchedBy, creators, organizations, errors }
}

export async function applyBangumiWorkEntityLinks({ plan, dryRunAudit, baseUrl, email, password, apply = false, confirm = '', limit = 0 }) {
  const dryRunResult = buildBangumiWorkEntityLinkImportDryRun(plan)
  const issues = [...dryRunResult.issues, ...applyPreflightIssues({ apply, confirm, dryRunAudit })]
  const actions = limit > 0 ? dryRunResult.actions.slice(0, limit) : dryRunResult.actions

  if (!apply) {
    return { ...dryRunResult, meta: { ...dryRunResult.meta, apply: false, limit } }
  }

  if (issues.some((issue) => issue.level === 'error')) {
    return {
      meta: {
        source: 'bangumi-work-entity-link-import-apply',
        mode: 'apply-guarded-payload-write',
        generatedAt: new Date().toISOString(),
        status: 'fail',
        apply: true,
        limit,
        worksTotal: actions.length,
        updated: 0,
        skipped: 0,
        errors: issues.filter((issue) => issue.level === 'error').length,
      },
      results: [],
      issues,
    }
  }

  if (!email || !password) throw new Error('Set PAYLOAD_SEED_EMAIL and PAYLOAD_SEED_PASSWORD before apply.')
  const token = await login(baseUrl, email, password)
  const results = []

  for (const action of actions) {
    const label = workLabel(action.work)
    try {
      const resolved = await resolveAction(baseUrl, token, action)
      if (resolved.errors.length > 0) {
        results.push({ work: action.work, label, status: 'error', errors: resolved.errors })
        continue
      }

      const patchPlan = buildWorkRelationshipPatch(resolved.work, action, resolved)
      if (!patchPlan.changed) {
        results.push({ work: action.work, label, status: 'skipped-existing', patch: {}, added: patchPlan })
        continue
      }

      await updateWork(baseUrl, token, resolved.work.id, patchPlan.patch)
      results.push({ work: action.work, label, status: 'updated', payloadId: resolved.work.id, patch: patchPlan.patch, added: patchPlan })
    } catch (error) {
      results.push({ work: action.work, label, status: 'error', errors: [{ code: 'apply-error', message: String(error?.message || error) }] })
    }
  }

  const updated = results.filter((row) => row.status === 'updated').length
  const skipped = results.filter((row) => row.status === 'skipped-existing').length
  const errors = results.filter((row) => row.status === 'error').length

  return {
    meta: {
      source: 'bangumi-work-entity-link-import-apply',
      mode: 'apply-guarded-payload-write',
      generatedAt: new Date().toISOString(),
      status: errors === 0 ? 'pass' : 'fail',
      apply: true,
      limit,
      url: baseUrl,
      worksTotal: actions.length,
      updated,
      skipped,
      errors,
    },
    results,
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
    '- 默认仍是 dry-run，不调用 Payload API。',
    `- 真实 apply 必须显式传入 \`--apply --confirm ${APPLY_CONFIRM_TEXT}\`。`,
    '- apply 前必须有通过的 dry-run audit。',
    '- apply 只合并缺失关系，不修改可见性、状态、正文或其他字段。',
    '- 输出位于 `data_local` 时不要提交。',
    '',
  ].filter((line) => line !== '').join('\n')
}

export function createBangumiWorkEntityLinkApplyReport(result, { planInputPath = '', auditInputPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const meta = result.meta || {}
  const results = rows(result.results).slice(0, topLimit)

  return [
    '# Bangumi work/entity link apply report',
    '',
    `生成时间：${meta.generatedAt}`,
    planInputPath ? `Plan 输入：\`${planInputPath}\`` : '',
    auditInputPath ? `Dry-run audit 输入：\`${auditInputPath}\`` : '',
    '',
    '## 总览',
    '',
    `- 模式：${meta.mode}`,
    `- 状态：${meta.status}`,
    `- apply：${meta.apply}`,
    `- url：${meta.url || ''}`,
    `- works：${meta.worksTotal}`,
    `- updated：${meta.updated}`,
    `- skipped existing：${meta.skipped}`,
    `- errors：${meta.errors}`,
    '',
    '## Results sample',
    '',
    results.length === 0 ? '暂无。' : '| # | Work | Status | Added creator IDs | Added creator credits | Added organizations |',
    results.length === 0 ? '' : '| ---: | --- | --- | ---: | ---: | ---: |',
    ...results.map((row, index) => `| ${index + 1} | ${escapeMarkdownCell(row.label || workLabel(row.work))} | ${escapeMarkdownCell(row.status)} | ${row.added?.addedCreatorIds ?? 0} | ${row.added?.addedCreatorCredits ?? 0} | ${row.added?.addedOrganizations ?? 0} |`),
    '',
    '## 安全说明',
    '',
    '- 本报告来自受保护 apply 路径。',
    '- apply 只 PATCH works 的 creators、creatorCredits、organizations 三个关系字段。',
    '- 不修改状态、可见性、标题、正文、证据备注或其他字段。',
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
  const auditInput = args.get('dry-run-audit') || DEFAULT_DRY_RUN_AUDIT_INPUT
  const apply = args.get('apply') === 'true'
  const output = args.get('out') || (apply ? DEFAULT_APPLY_OUTPUT : DEFAULT_OUTPUT)
  const reportOutput = args.get('report') || (apply ? DEFAULT_APPLY_REPORT : DEFAULT_REPORT)
  const topLimit = numberArg(args, 'top', DEFAULT_TOP_LIMIT)
  const limit = numberArg(args, 'limit', 0)
  const baseUrl = String(args.get('url') || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const confirm = cleanText(args.get('confirm'))

  const resolvedPlanInput = path.resolve(planInput)
  const resolvedAuditInput = path.resolve(auditInput)
  const resolvedOutput = path.resolve(output)
  const resolvedReportOutput = path.resolve(reportOutput)

  const plan = await readJsonFile(resolvedPlanInput)

  let result
  let report
  if (apply) {
    const dryRunAudit = await readJsonFile(resolvedAuditInput)
    result = await applyBangumiWorkEntityLinks({
      plan,
      dryRunAudit,
      baseUrl,
      email: process.env.PAYLOAD_SEED_EMAIL,
      password: process.env.PAYLOAD_SEED_PASSWORD,
      apply,
      confirm,
      limit,
    })
    report = createBangumiWorkEntityLinkApplyReport(result, { planInputPath: resolvedPlanInput, auditInputPath: resolvedAuditInput, topLimit })
  } else {
    result = buildBangumiWorkEntityLinkImportDryRun(plan)
    report = createBangumiWorkEntityLinkImportDryRunReport(result, { planInputPath: resolvedPlanInput, topLimit })
  }

  await writeJsonFile(resolvedOutput, result)
  console.log(`Wrote Bangumi work/entity link import result -> ${resolvedOutput}`)

  await mkdir(path.dirname(resolvedReportOutput), { recursive: true })
  await writeFile(resolvedReportOutput, `${REPORT_UTF8_BOM}${report}\n`, 'utf8')
  console.log(`Wrote Bangumi work/entity link import report -> ${resolvedReportOutput}`)

  if (result.meta.status !== 'pass') process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
