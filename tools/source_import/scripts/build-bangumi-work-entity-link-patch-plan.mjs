#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeJsonFile } from '../lib/jsonl.mjs'

const DEFAULT_TOP_LIMIT = 120
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

function arrayRows(value) {
  return Array.isArray(value) ? value : []
}

function relationKey(relation) {
  return [relation.collection, relation.siteId || relation.slug, relation.role, relation.originalRole].map(cleanText).join('|').toLowerCase()
}

function workIdentity(work) {
  return {
    siteId: cleanText(work?.siteId),
    slug: cleanText(work?.slug),
    title: cleanText(work?.title),
    originalTitle: cleanText(work?.originalTitle),
    bangumiSubjectId: cleanText(work?.bangumiSubjectId),
  }
}

function workLabel(work) {
  return cleanText(work?.title || work?.slug || work?.siteId || work?.bangumiSubjectId)
}

function normalizeRelation(link, collection) {
  return {
    collection,
    siteId: cleanText(link?.siteId),
    slug: cleanText(link?.slug),
    name: cleanText(link?.name),
    role: cleanText(link?.role || 'other'),
    originalRole: cleanText(link?.originalRole),
    matchedBy: cleanText(link?.matchedBy || 'name'),
    source: {
      type: cleanText(link?.source?.type || 'bangumi-credit-hint'),
      role: cleanText(link?.source?.role || link?.role || 'other'),
      originalRole: cleanText(link?.source?.originalRole || link?.originalRole),
      source: cleanText(link?.source?.source || 'bangumi'),
      note: cleanText(link?.source?.note),
      rawLine: cleanText(link?.source?.rawLine),
    },
  }
}

function uniqueRelations(links, collection) {
  const seen = new Set()
  const output = []

  for (const link of arrayRows(links)) {
    const relation = normalizeRelation(link, collection)
    const key = relationKey(relation)
    if (!relation.name || !(relation.siteId || relation.slug) || seen.has(key)) continue
    seen.add(key)
    output.push(relation)
  }

  return output
}

function auditIsPass(audit) {
  return cleanText(audit?.meta?.source) === 'bangumi-work-entity-link-audit'
    && cleanText(audit?.meta?.mode) === 'audit-only-no-payload-write'
    && cleanText(audit?.meta?.status) === 'pass'
    && Number(audit?.meta?.errors ?? 1) === 0
}

function previewIsValid(preview) {
  return cleanText(preview?.meta?.source) === 'bangumi-work-entity-link-preview'
    && cleanText(preview?.meta?.mode) === 'preview-only-no-payload-write'
    && Array.isArray(preview?.works)
}

function blockedReasonList(workRow, auditPassed) {
  const reasons = []
  const work = workIdentity(workRow?.work || {})
  if (!auditPassed) reasons.push('audit-not-pass')
  if (!workLabel(work)) reasons.push('missing-work-identity')
  if (arrayRows(workRow?.ambiguousCreatorHints).length > 0) reasons.push('ambiguous-creator-hints')
  if (arrayRows(workRow?.ambiguousOrganizationHints).length > 0) reasons.push('ambiguous-organization-hints')
  return reasons
}

export function buildBangumiWorkEntityLinkPatchPlan(preview, audit, { previewInputPath = '', auditInputPath = '' } = {}) {
  const auditPassed = auditIsPass(audit)
  const previewValid = previewIsValid(preview)
  const works = arrayRows(preview?.works)
  const planWorks = []

  let creatorRelationsTotal = 0
  let organizationRelationsTotal = 0
  let worksPlanned = 0
  let worksSkipped = 0
  let unmatchedCreatorHintsIgnored = 0
  let unmatchedOrganizationHintsIgnored = 0
  let ambiguousCreatorHintsBlocked = 0
  let ambiguousOrganizationHintsBlocked = 0

  if (previewValid) {
    for (const workRow of works) {
      const work = workIdentity(workRow?.work || {})
      const creators = uniqueRelations(workRow?.creators, 'creators')
      const organizations = uniqueRelations(workRow?.organizations, 'organizations')
      const skipReasons = blockedReasonList(workRow, auditPassed)
      const hasRelations = creators.length > 0 || organizations.length > 0
      if (!hasRelations) skipReasons.push('no-linked-relations')

      unmatchedCreatorHintsIgnored += arrayRows(workRow?.unmatchedCreatorHints).length
      unmatchedOrganizationHintsIgnored += arrayRows(workRow?.unmatchedOrganizationHints).length
      ambiguousCreatorHintsBlocked += arrayRows(workRow?.ambiguousCreatorHints).length
      ambiguousOrganizationHintsBlocked += arrayRows(workRow?.ambiguousOrganizationHints).length

      const status = skipReasons.length === 0 ? 'planned' : 'skipped'
      if (status === 'planned') {
        worksPlanned += 1
        creatorRelationsTotal += creators.length
        organizationRelationsTotal += organizations.length
      } else {
        worksSkipped += 1
      }

      planWorks.push({
        work,
        status,
        action: status === 'planned' ? 'patch-work-relationships' : 'skip',
        skipReasons,
        relationships: {
          creators: status === 'planned' ? creators : [],
          organizations: status === 'planned' ? organizations : [],
        },
        ignored: {
          unmatchedCreatorHints: arrayRows(workRow?.unmatchedCreatorHints).length,
          unmatchedOrganizationHints: arrayRows(workRow?.unmatchedOrganizationHints).length,
          ambiguousCreatorHints: arrayRows(workRow?.ambiguousCreatorHints).length,
          ambiguousOrganizationHints: arrayRows(workRow?.ambiguousOrganizationHints).length,
        },
      })
    }
  }

  const status = previewValid && auditPassed ? 'ready' : 'blocked'

  return {
    meta: {
      source: 'bangumi-work-entity-link-patch-plan',
      mode: 'plan-only-no-payload-write',
      generatedAt: new Date().toISOString(),
      status,
      previewInputPath: cleanText(previewInputPath),
      auditInputPath: cleanText(auditInputPath),
      previewMode: cleanText(preview?.meta?.mode),
      auditStatus: cleanText(audit?.meta?.status),
      requiresAuditPass: true,
    },
    stats: {
      worksTotal: works.length,
      worksPlanned,
      worksSkipped,
      creatorRelationsTotal,
      organizationRelationsTotal,
      unmatchedCreatorHintsIgnored,
      unmatchedOrganizationHintsIgnored,
      ambiguousCreatorHintsBlocked,
      ambiguousOrganizationHintsBlocked,
    },
    blockedReasons: {
      previewInvalid: !previewValid,
      auditNotPass: !auditPassed,
    },
    works: planWorks,
  }
}

function relationSummary(relations, limit = 6) {
  if (relations.length === 0) return ''
  return relations
    .slice(0, limit)
    .map((relation) => `${relation.name}${relation.role ? `(${relation.role})` : ''}`)
    .join('；') + (relations.length > limit ? `；+${relations.length - limit}` : '')
}

function statusSummary(work) {
  if (work.status === 'planned') return 'planned'
  return `skipped: ${arrayRows(work.skipReasons).join(', ')}`
}

export function createBangumiWorkEntityLinkPatchPlanReport(plan, { topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const meta = plan.meta || {}
  const stats = plan.stats || {}
  const works = arrayRows(plan.works).slice(0, topLimit)

  return [
    '# Bangumi work/entity link patch plan',
    '',
    `生成时间：${meta.generatedAt}`,
    meta.previewInputPath ? `Preview 输入：\`${meta.previewInputPath}\`` : '',
    meta.auditInputPath ? `Audit 输入：\`${meta.auditInputPath}\`` : '',
    '',
    '## 总览',
    '',
    `- 模式：${meta.mode}`,
    `- 状态：${meta.status}`,
    `- preview mode：${meta.previewMode}`,
    `- audit status：${meta.auditStatus}`,
    `- requires audit pass：${meta.requiresAuditPass}`,
    `- works total：${stats.worksTotal}`,
    `- works planned：${stats.worksPlanned}`,
    `- works skipped：${stats.worksSkipped}`,
    `- creator relations planned：${stats.creatorRelationsTotal}`,
    `- organization relations planned：${stats.organizationRelationsTotal}`,
    `- unmatched creator hints ignored：${stats.unmatchedCreatorHintsIgnored}`,
    `- unmatched organization hints ignored：${stats.unmatchedOrganizationHintsIgnored}`,
    `- ambiguous creator hints blocked：${stats.ambiguousCreatorHintsBlocked}`,
    `- ambiguous organization hints blocked：${stats.ambiguousOrganizationHintsBlocked}`,
    '',
    '## Work plan sample',
    '',
    '| # | Work | Status | Creator relationships | Organization relationships |',
    '| ---: | --- | --- | --- | --- |',
    ...works.map((row, index) => `| ${index + 1} | ${escapeMarkdownCell(workLabel(row.work))} | ${escapeMarkdownCell(statusSummary(row))} | ${escapeMarkdownCell(relationSummary(arrayRows(row.relationships?.creators)))} | ${escapeMarkdownCell(relationSummary(arrayRows(row.relationships?.organizations)))} |`),
    '',
    '## 安全说明',
    '',
    '- 这是本地 patch plan，不调用 Payload API。',
    '- 不创建、不更新、不 PATCH works。',
    '- 只把已匹配、非 ambiguous 的 creator/organization link 转换为未来写入候选。',
    '- unmatched hints 被统计为 ignored，不会进入 relationships。',
    '- audit 未通过时计划状态为 blocked，不能进入 dry-run importer。',
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

  const resolvedPreviewInput = path.resolve(previewInput)
  const resolvedAuditInput = path.resolve(auditInput)
  const resolvedOutput = path.resolve(output)
  const resolvedReportOutput = path.resolve(reportOutput)

  const preview = await readJsonFile(resolvedPreviewInput)
  const audit = await readJsonFile(resolvedAuditInput)
  const plan = buildBangumiWorkEntityLinkPatchPlan(preview, audit, {
    previewInputPath: resolvedPreviewInput,
    auditInputPath: resolvedAuditInput,
  })
  const report = createBangumiWorkEntityLinkPatchPlanReport(plan, { topLimit })

  await writeJsonFile(resolvedOutput, plan)
  console.log(`Wrote Bangumi work/entity link patch plan -> ${resolvedOutput}`)

  await mkdir(path.dirname(resolvedReportOutput), { recursive: true })
  await writeFile(resolvedReportOutput, `${REPORT_UTF8_BOM}${report}\n`, 'utf8')
  console.log(`Wrote Bangumi work/entity link patch plan report -> ${resolvedReportOutput}`)

  if (plan.meta.status !== 'ready') process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
