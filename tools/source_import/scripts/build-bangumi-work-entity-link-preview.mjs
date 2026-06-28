#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeJsonFile } from '../lib/jsonl.mjs'

const DEFAULT_TOP_LIMIT = 80
const DEFAULT_WORKS_INPUT = path.join('data_local', 'payload', 'bangumi-yuri-anime-candidates.json')
const DEFAULT_ENTITIES_INPUT = path.join('data_local', 'payload', 'bangumi-payload-entity-seed-preview.json')
const DEFAULT_OUTPUT = path.join('data_local', 'payload', 'bangumi-work-entity-link-preview.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-work-entity-link-preview.md')
const FOOTNOTE_ONLY_NAME_PATTERN = /^\d+(?:\s*[-–]\s*\d+)?[）)]?$/u
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

function cleanHintName(value) {
  const name = cleanText(value)
  if (!name || FOOTNOTE_ONLY_NAME_PATTERN.test(name)) return ''
  return name
}

function normalizeName(value) {
  return cleanText(value).toLowerCase()
}

function escapeMarkdownCell(value) {
  return cleanText(value).replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|')
}

function numberArg(args, key, fallback) {
  const value = Number(args.get(key) ?? fallback)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function collectionRows(value, key) {
  return Array.isArray(value?.[key]) ? value[key] : []
}

export function workRows(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.works)) return value.works
  if (Array.isArray(value?.candidates)) return value.candidates
  if (Array.isArray(value?.items)) return value.items
  if (Array.isArray(value?.records)) return value.records
  return []
}

function workIdentity(work) {
  return {
    siteId: cleanText(work?.siteId),
    slug: cleanText(work?.slug),
    title: cleanText(work?.title || work?.name_cn || work?.name),
    originalTitle: cleanText(work?.originalTitle || work?.name),
    bangumiSubjectId: cleanText(work?.externalIds?.bangumiSubjectId || work?.bangumiSubjectId || work?.id),
  }
}

function parseHintLine(line) {
  const parts = cleanText(line).replace(/^-\s*/u, '').split(/\s+\|\s+/u)
  const name = cleanHintName(parts.shift())
  if (!name) return null

  const fields = new Map()
  for (const part of parts) {
    const match = /^(?<key>[A-Za-z][A-Za-z0-9_-]*)=(?<value>.*)$/u.exec(part)
    if (!match?.groups) continue
    fields.set(match.groups.key, cleanText(match.groups.value))
  }

  return {
    name,
    role: fields.get('role') || 'other',
    originalRole: fields.get('originalRole') || '',
    source: fields.get('source') || 'bangumi',
    note: fields.get('note') || '',
    rawLine: cleanText(line),
  }
}

function normalizeDirectHint(hint) {
  const name = cleanHintName(typeof hint === 'string' ? hint : hint?.name)
  if (!name) return null

  const role = cleanText(typeof hint === 'object' ? hint?.role : '') || 'other'
  const originalRole = cleanText(typeof hint === 'object' ? hint?.originalRole : '')
  const source = cleanText(typeof hint === 'object' ? hint?.source : '') || 'bangumi'
  const note = cleanText(typeof hint === 'object' ? hint?.note : '')
  const rawLine = [
    `- ${name}`,
    `role=${role}`,
    originalRole ? `originalRole=${originalRole}` : '',
    source ? `source=${source}` : '',
    note ? `note=${note}` : '',
  ].filter(Boolean).join(' | ')

  return { name, role, originalRole, source, note, rawLine }
}

function directHints(work, fieldName) {
  return (Array.isArray(work?.[fieldName]) ? work[fieldName] : [])
    .map(normalizeDirectHint)
    .filter(Boolean)
}

function uniqueHints(hints) {
  const seen = new Set()
  const output = []

  for (const hint of hints) {
    const key = [hint.name, hint.role, hint.originalRole, hint.source, hint.note].map(normalizeName).join('|')
    if (seen.has(key)) continue
    seen.add(key)
    output.push(hint)
  }

  return output
}

export function extractBangumiCreditHints(work) {
  const evidenceNote = typeof work?.evidenceNote === 'string' ? work.evidenceNote : ''
  const result = {
    creators: directHints(work, 'creatorCreditHints'),
    organizations: directHints(work, 'organizationCreditHints'),
  }
  let currentSection = ''

  for (const line of evidenceNote.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('## ')) {
      if (trimmed.includes('Bangumi 创作者职位候选')) currentSection = 'creators'
      else if (trimmed.includes('Bangumi 机构/制作候选')) currentSection = 'organizations'
      else currentSection = ''
      continue
    }

    if (!currentSection || !trimmed.startsWith('- ')) continue
    const hint = parseHintLine(trimmed)
    if (hint) result[currentSection].push(hint)
  }

  return {
    creators: uniqueHints(result.creators),
    organizations: uniqueHints(result.organizations),
  }
}

function normalizeEntity(row, collection) {
  return {
    collection,
    siteId: cleanText(row?.siteId),
    slug: cleanText(row?.slug),
    name: cleanText(row?.name),
    status: cleanText(row?.status),
    isLiteVisible: row?.isLiteVisible === false ? false : Boolean(row?.isLiteVisible),
    isFullVisible: row?.isFullVisible === false ? false : Boolean(row?.isFullVisible),
  }
}

function buildEntityIndex(entitySeed, collection) {
  const byName = new Map()
  const entities = collectionRows(entitySeed, collection).map((row) => normalizeEntity(row, collection)).filter((row) => row.name)

  for (const entity of entities) {
    const key = normalizeName(entity.name)
    const existing = byName.get(key) || []
    existing.push(entity)
    byName.set(key, existing)
  }

  return { entities, byName }
}

function roleIdentity(hint) {
  return [hint.role, hint.originalRole, hint.source, hint.note].map(cleanText).join('|')
}

function sourceForHint(hint) {
  return {
    type: 'bangumi-credit-hint',
    role: hint.role,
    originalRole: hint.originalRole,
    source: hint.source,
    note: hint.note,
    rawLine: hint.rawLine,
  }
}

function linkHints(hints, index) {
  const links = []
  const unmatchedHints = []
  const ambiguousHints = []
  const seenLinks = new Set()

  for (const hint of hints) {
    const key = normalizeName(hint.name)
    const matches = index.byName.get(key) || []

    if (matches.length === 0) {
      unmatchedHints.push(hint)
      continue
    }

    if (matches.length > 1) {
      ambiguousHints.push({ hint, matches })
      continue
    }

    const entity = matches[0]
    const linkKey = [entity.collection, entity.siteId || entity.slug, roleIdentity(hint)].join('|')
    if (seenLinks.has(linkKey)) continue
    seenLinks.add(linkKey)

    links.push({
      collection: entity.collection,
      siteId: entity.siteId,
      slug: entity.slug,
      name: entity.name,
      role: hint.role,
      originalRole: hint.originalRole,
      matchedBy: 'name',
      source: sourceForHint(hint),
    })
  }

  return { links, unmatchedHints, ambiguousHints }
}

function summarizeHintsByName(rowsToSummarize) {
  const groups = new Map()

  for (const item of rowsToSummarize) {
    const hint = item.hint || item
    const work = item.work || {}
    const key = [normalizeName(hint.name), hint.role, hint.originalRole].join('|')
    const existing = groups.get(key) || {
      name: cleanText(hint.name),
      role: cleanText(hint.role || 'other'),
      originalRole: cleanText(hint.originalRole),
      count: 0,
      works: [],
    }
    existing.count += 1
    const title = cleanText(work.title || work.slug)
    if (title && !existing.works.includes(title) && existing.works.length < 10) existing.works.push(title)
    groups.set(key, existing)
  }

  return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

function duplicateEntityNames(index) {
  return [...index.byName.values()]
    .filter((items) => items.length > 1)
    .map((items) => ({
      name: items[0].name,
      entities: items.map((item) => ({ siteId: item.siteId, slug: item.slug, collection: item.collection })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function sharedEntityNames(creatorIndex, organizationIndex) {
  const rowsOut = []
  for (const [key, creators] of creatorIndex.byName.entries()) {
    const organizations = organizationIndex.byName.get(key) || []
    if (organizations.length === 0) continue
    rowsOut.push({
      name: creators[0].name,
      creators: creators.map((item) => ({ siteId: item.siteId, slug: item.slug })),
      organizations: organizations.map((item) => ({ siteId: item.siteId, slug: item.slug })),
    })
  }
  return rowsOut.sort((a, b) => a.name.localeCompare(b.name))
}

function duplicateEntityIds(entities) {
  const groups = new Map()
  for (const entity of entities) {
    for (const field of ['siteId', 'slug']) {
      const value = cleanText(entity[field])
      if (!value) continue
      const key = `${field}:${value.toLowerCase()}`
      const existing = groups.get(key) || { field, value, entities: [] }
      existing.entities.push({ collection: entity.collection, name: entity.name, siteId: entity.siteId, slug: entity.slug })
      groups.set(key, existing)
    }
  }

  return [...groups.values()]
    .filter((group) => new Set(group.entities.map((item) => item.name)).size > 1)
    .sort((a, b) => a.value.localeCompare(b.value))
}

function sourceShape(seed) {
  if (Array.isArray(seed)) return 'array'
  if (Array.isArray(seed?.works)) return 'works'
  if (Array.isArray(seed?.candidates)) return 'candidates'
  if (Array.isArray(seed?.items)) return 'items'
  if (Array.isArray(seed?.records)) return 'records'
  return 'unknown'
}

export function buildBangumiWorkEntityLinkPreview(worksSeed, entitySeed) {
  const works = workRows(worksSeed)
  const creatorIndex = buildEntityIndex(entitySeed, 'creators')
  const organizationIndex = buildEntityIndex(entitySeed, 'organizations')
  const previewWorks = []
  const unmatchedCreatorRows = []
  const unmatchedOrganizationRows = []
  const ambiguousCreatorRows = []
  const ambiguousOrganizationRows = []

  for (const work of works) {
    const identity = workIdentity(work)
    const hints = extractBangumiCreditHints(work)
    const creatorResult = linkHints(hints.creators, creatorIndex)
    const organizationResult = linkHints(hints.organizations, organizationIndex)

    for (const hint of creatorResult.unmatchedHints) unmatchedCreatorRows.push({ hint, work: identity })
    for (const hint of organizationResult.unmatchedHints) unmatchedOrganizationRows.push({ hint, work: identity })
    for (const row of creatorResult.ambiguousHints) ambiguousCreatorRows.push({ ...row, work: identity })
    for (const row of organizationResult.ambiguousHints) ambiguousOrganizationRows.push({ ...row, work: identity })

    previewWorks.push({
      work: identity,
      creatorHintCount: hints.creators.length,
      organizationHintCount: hints.organizations.length,
      creators: creatorResult.links,
      organizations: organizationResult.links,
      unmatchedCreatorHints: creatorResult.unmatchedHints,
      unmatchedOrganizationHints: organizationResult.unmatchedHints,
      ambiguousCreatorHints: creatorResult.ambiguousHints,
      ambiguousOrganizationHints: organizationResult.ambiguousHints,
    })
  }

  const duplicateCreatorNames = duplicateEntityNames(creatorIndex)
  const duplicateOrganizationNames = duplicateEntityNames(organizationIndex)
  const sharedNames = sharedEntityNames(creatorIndex, organizationIndex)
  const duplicateIds = duplicateEntityIds([...creatorIndex.entities, ...organizationIndex.entities])

  const creatorLinksTotal = previewWorks.reduce((sum, work) => sum + work.creators.length, 0)
  const organizationLinksTotal = previewWorks.reduce((sum, work) => sum + work.organizations.length, 0)

  return {
    meta: {
      source: 'bangumi-work-entity-link-preview',
      mode: 'preview-only-no-payload-write',
      generatedAt: new Date().toISOString(),
      worksSourceShape: sourceShape(worksSeed),
      worksTotal: works.length,
      creatorsTotal: creatorIndex.entities.length,
      organizationsTotal: organizationIndex.entities.length,
      worksWithCreatorLinks: previewWorks.filter((work) => work.creators.length > 0).length,
      worksWithOrganizationLinks: previewWorks.filter((work) => work.organizations.length > 0).length,
      creatorLinksTotal,
      organizationLinksTotal,
      unmatchedCreatorHintsTotal: unmatchedCreatorRows.length,
      unmatchedOrganizationHintsTotal: unmatchedOrganizationRows.length,
      ambiguousCreatorHintsTotal: ambiguousCreatorRows.length,
      ambiguousOrganizationHintsTotal: ambiguousOrganizationRows.length,
      duplicateCreatorNameGroups: duplicateCreatorNames.length,
      duplicateOrganizationNameGroups: duplicateOrganizationNames.length,
      sharedCreatorOrganizationNames: sharedNames.length,
      duplicateEntityIdGroups: duplicateIds.length,
    },
    works: previewWorks,
    unmatchedCreatorHints: summarizeHintsByName(unmatchedCreatorRows),
    unmatchedOrganizationHints: summarizeHintsByName(unmatchedOrganizationRows),
    suspiciousEntities: {
      duplicateCreatorNames,
      duplicateOrganizationNames,
      sharedCreatorOrganizationNames: sharedNames,
      duplicateEntityIds: duplicateIds,
    },
  }
}

function linkSummary(links, limit = 8) {
  if (links.length === 0) return ''
  return links
    .slice(0, limit)
    .map((link) => `${link.name}${link.role ? `(${link.role})` : ''}`)
    .join('；') + (links.length > limit ? `；+${links.length - limit}` : '')
}

function hintSummary(hints, limit = 8) {
  if (hints.length === 0) return ''
  return hints
    .slice(0, limit)
    .map((hint) => `${hint.name}${hint.role ? `(${hint.role})` : ''}`)
    .join('；') + (hints.length > limit ? `；+${hints.length - limit}` : '')
}

function hintTable(title, rowsToRender, limit = DEFAULT_TOP_LIMIT) {
  const limited = rowsToRender.slice(0, limit)
  if (limited.length === 0) return `## ${title}\n\n暂无。\n`
  return [
    `## ${title}`,
    '',
    '| 名称 | Role | 次数 | 作品示例 |',
    '| --- | --- | ---: | --- |',
    ...limited.map((row) => `| ${escapeMarkdownCell(row.name)} | ${escapeMarkdownCell([row.role, row.originalRole].filter(Boolean).join(' / '))} | ${row.count} | ${escapeMarkdownCell(row.works.join('；'))} |`),
    '',
  ].join('\n')
}

function suspiciousTable(title, rowsToRender, renderDetails, limit = DEFAULT_TOP_LIMIT) {
  const limited = rowsToRender.slice(0, limit)
  if (limited.length === 0) return `## ${title}\n\n暂无。\n`
  return [
    `## ${title}`,
    '',
    '| 名称/键 | 详情 |',
    '| --- | --- |',
    ...limited.map((row) => `| ${escapeMarkdownCell(row.name || row.value)} | ${escapeMarkdownCell(renderDetails(row))} |`),
    '',
  ].join('\n')
}

export function createBangumiWorkEntityLinkPreviewReport(preview, { worksInputPath = '', entitiesInputPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const meta = preview.meta
  const works = Array.isArray(preview.works) ? preview.works : []
  const sampleWorks = works.slice(0, topLimit)

  return [
    '# Bangumi works ↔ entities 关系预览',
    '',
    `生成时间：${meta.generatedAt}`,
    worksInputPath ? `Works 输入：\`${worksInputPath}\`` : '',
    entitiesInputPath ? `Entities 输入：\`${entitiesInputPath}\`` : '',
    '',
    '## 总览',
    '',
    `- 模式：${meta.mode}`,
    `- Works 输入形状：${meta.worksSourceShape}`,
    `- 总 works 数：${meta.worksTotal}`,
    `- entity creators 数：${meta.creatorsTotal}`,
    `- entity organizations 数：${meta.organizationsTotal}`,
    `- 能匹配 creator 的 works 数：${meta.worksWithCreatorLinks}`,
    `- 能匹配 organization 的 works 数：${meta.worksWithOrganizationLinks}`,
    `- creator 匹配总数：${meta.creatorLinksTotal}`,
    `- organization 匹配总数：${meta.organizationLinksTotal}`,
    `- 未匹配 creator hint：${meta.unmatchedCreatorHintsTotal}`,
    `- 未匹配 organization hint：${meta.unmatchedOrganizationHintsTotal}`,
    `- 疑似一名多实体 / 多名同实体组：${meta.duplicateCreatorNameGroups + meta.duplicateOrganizationNameGroups + meta.sharedCreatorOrganizationNames + meta.duplicateEntityIdGroups}`,
    '',
    '## 每部作品样例关系',
    '',
    '| # | Work | Creator links | Organization links | 未匹配 creator | 未匹配 organization |',
    '| ---: | --- | --- | --- | --- | --- |',
    ...sampleWorks.map((row, index) => `| ${index + 1} | ${escapeMarkdownCell(row.work.title || row.work.slug)} | ${escapeMarkdownCell(linkSummary(row.creators))} | ${escapeMarkdownCell(linkSummary(row.organizations))} | ${escapeMarkdownCell(hintSummary(row.unmatchedCreatorHints))} | ${escapeMarkdownCell(hintSummary(row.unmatchedOrganizationHints))} |`),
    '',
    hintTable('未匹配 creator hint', preview.unmatchedCreatorHints, topLimit),
    hintTable('未匹配 organization hint', preview.unmatchedOrganizationHints, topLimit),
    suspiciousTable('同名 creator 实体', preview.suspiciousEntities.duplicateCreatorNames, (row) => row.entities.map((item) => `${item.siteId || item.slug}`).join('；'), topLimit),
    suspiciousTable('同名 organization 实体', preview.suspiciousEntities.duplicateOrganizationNames, (row) => row.entities.map((item) => `${item.siteId || item.slug}`).join('；'), topLimit),
    suspiciousTable('creator / organization 同名候选', preview.suspiciousEntities.sharedCreatorOrganizationNames, (row) => `creators=${row.creators.map((item) => item.siteId || item.slug).join('；')} organizations=${row.organizations.map((item) => item.siteId || item.slug).join('；')}`, topLimit),
    suspiciousTable('多名同 siteId / slug 候选', preview.suspiciousEntities.duplicateEntityIds, (row) => `${row.field}=${row.value}；${row.entities.map((item) => `${item.collection}:${item.name}`).join('；')}`, topLimit),
    '## 安全说明',
    '',
    '- 这只是本地关系预览，不调用 Payload API。',
    '- 不创建、不更新、不 PATCH works。',
    '- 只输出将来可能写入 works relationship 的候选关系。',
    '- 支持读取 Payload works seed，也支持读取 normalized Bangumi candidate JSON。',
    '- 会过滤纯脚注编号式 Bangumi credit hint，例如 `7`、`12)`。',
    '- Markdown 报告使用 UTF-8 with BOM，便于 Windows PowerShell 直接读取。',
    '- 输出位于 `data_local` 时不要提交。',
    '',
  ].filter((line) => line !== '').join('\n')
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const worksInput = args.get('works') || DEFAULT_WORKS_INPUT
  const entitiesInput = args.get('entities') || DEFAULT_ENTITIES_INPUT
  const output = args.get('out') || DEFAULT_OUTPUT
  const reportOutput = args.get('report') || DEFAULT_REPORT
  const topLimit = numberArg(args, 'top', DEFAULT_TOP_LIMIT)

  const resolvedWorksInput = path.resolve(worksInput)
  const resolvedEntitiesInput = path.resolve(entitiesInput)
  const resolvedOutput = path.resolve(output)
  const resolvedReportOutput = path.resolve(reportOutput)

  const worksSeed = await readJsonFile(resolvedWorksInput)
  const entitySeed = await readJsonFile(resolvedEntitiesInput)
  const preview = buildBangumiWorkEntityLinkPreview(worksSeed, entitySeed)
  const report = createBangumiWorkEntityLinkPreviewReport(preview, {
    worksInputPath: resolvedWorksInput,
    entitiesInputPath: resolvedEntitiesInput,
    topLimit,
  })

  await writeJsonFile(resolvedOutput, preview)
  console.log(`Wrote Bangumi work/entity link preview -> ${resolvedOutput}`)

  await mkdir(path.dirname(resolvedReportOutput), { recursive: true })
  await writeFile(resolvedReportOutput, `${REPORT_UTF8_BOM}${report}\n`, 'utf8')
  console.log(`Wrote Bangumi work/entity link report -> ${resolvedReportOutput}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
