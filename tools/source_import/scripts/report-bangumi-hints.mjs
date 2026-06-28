#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readJsonl, writeJsonFile } from '../lib/jsonl.mjs'

const DEFAULT_TOP_LIMIT = 40

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

function uniqueSorted(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function normalizedKey(value) {
  return cleanText(value).toLowerCase()
}

function workSlug(work) {
  return cleanText(work.slug || work.title || work.externalIds?.bangumiSubjectId || 'unknown')
}

function collectHints(works, fieldName, kind) {
  const rows = []

  for (const work of works) {
    const hints = Array.isArray(work?.[fieldName]) ? work[fieldName] : []
    const seen = new Set()

    for (const raw of hints) {
      const name = cleanText(raw?.name)
      if (!name) continue

      const row = {
        kind,
        name,
        role: cleanText(raw?.role || 'other') || 'other',
        originalRole: cleanText(raw?.originalRole),
        source: cleanText(raw?.source),
        note: cleanText(raw?.note),
        title: cleanText(work?.title),
        slug: workSlug(work),
        bangumiSubjectId: cleanText(work?.externalIds?.bangumiSubjectId),
      }
      const key = [normalizedKey(row.name), normalizedKey(row.role), normalizedKey(row.originalRole)].join('|')
      if (seen.has(key)) continue
      seen.add(key)
      rows.push(row)
    }
  }

  return rows
}

function countBy(rows, keyFn) {
  const counts = new Map()
  for (const row of rows) {
    const key = cleanText(keyFn(row) || 'unknown') || 'unknown'
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function aggregateByName(rows) {
  const byName = new Map()

  for (const row of rows) {
    const key = normalizedKey(row.name)
    const item = byName.get(key) || {
      name: row.name,
      count: 0,
      roles: new Set(),
      originalRoles: new Set(),
      works: new Set(),
      workTitles: new Set(),
    }
    item.count += 1
    if (row.role) item.roles.add(row.role)
    if (row.originalRole) item.originalRoles.add(row.originalRole)
    item.works.add(row.slug)
    if (row.title) item.workTitles.add(row.title)
    byName.set(key, item)
  }

  return [...byName.values()]
    .map((item) => ({
      name: item.name,
      count: item.count,
      worksCount: item.works.size,
      roles: uniqueSorted([...item.roles]),
      originalRoles: uniqueSorted([...item.originalRoles]),
      sampleWorks: uniqueSorted([...item.workTitles]).slice(0, 8),
    }))
    .sort((a, b) => b.worksCount - a.worksCount || b.count - a.count || a.name.localeCompare(b.name))
}

function roleCoverage(rows) {
  const byRole = new Map()

  for (const row of rows) {
    const role = cleanText(row.role || 'other') || 'other'
    const item = byRole.get(role) || { role, hints: 0, works: new Set(), names: new Set() }
    item.hints += 1
    item.works.add(row.slug)
    item.names.add(normalizedKey(row.name))
    byRole.set(role, item)
  }

  return [...byRole.values()]
    .map((item) => ({ role: item.role, hints: item.hints, works: item.works.size, names: item.names.size }))
    .sort((a, b) => b.works - a.works || b.hints - a.hints || a.role.localeCompare(b.role))
}

function reviewReasons(row) {
  const reasons = []
  if (/[、,，;；/／&＆]|\s+x\s+|\s+×\s+/iu.test(row.name)) reasons.push('name_has_separator')
  if (row.name.length >= 40) reasons.push('very_long_name')
  if (/監督|监督|脚本|構成|构成|制作|製作|委员会|委員会|原作|企画|音乐|音楽/iu.test(row.name)) reasons.push('name_contains_role_word')
  if (row.kind === 'organization' && row.role === 'committee' && !/委员会|委員会|製作委員会|制作委员会|製作委员会/iu.test(row.name)) reasons.push('committee_role_without_committee_word')
  if (row.kind === 'person' && /委员会|委員会/iu.test(row.name)) reasons.push('person_name_looks_like_group')
  if (/^\d+$/u.test(row.name)) reasons.push('numeric_name')
  return reasons
}

function reviewRows(rows) {
  return rows
    .map((row) => ({ ...row, reasons: reviewReasons(row) }))
    .filter((row) => row.reasons.length > 0)
    .sort((a, b) => a.reasons.join(',').localeCompare(b.reasons.join(',')) || a.name.localeCompare(b.name))
}

function markdownCountTable(title, rows, limit = DEFAULT_TOP_LIMIT) {
  const limited = rows.slice(0, limit)
  if (limited.length === 0) return `## ${title}\n\n暂无。\n`
  return [
    `## ${title}`,
    '',
    '| 值 | 数量 |',
    '| --- | ---: |',
    ...limited.map(([label, count]) => `| ${escapeMarkdownCell(label)} | ${count} |`),
    '',
  ].join('\n')
}

function markdownRoleTable(title, rows) {
  if (rows.length === 0) return `## ${title}\n\n暂无。\n`
  return [
    `## ${title}`,
    '',
    '| Role | 候选条数 | 覆盖作品 | 唯一名称 |',
    '| --- | ---: | ---: | ---: |',
    ...rows.map((row) => `| ${escapeMarkdownCell(row.role)} | ${row.hints} | ${row.works} | ${row.names} |`),
    '',
  ].join('\n')
}

function markdownNameTable(title, rows, limit = DEFAULT_TOP_LIMIT) {
  const limited = rows.slice(0, limit)
  if (limited.length === 0) return `## ${title}\n\n暂无。\n`
  return [
    `## ${title}`,
    '',
    '| 名称 | 覆盖作品 | 候选条数 | Roles | 原始职位 | 作品示例 |',
    '| --- | ---: | ---: | --- | --- | --- |',
    ...limited.map((row) => `| ${escapeMarkdownCell(row.name)} | ${row.worksCount} | ${row.count} | ${escapeMarkdownCell(row.roles.join('；'))} | ${escapeMarkdownCell(row.originalRoles.join('；'))} | ${escapeMarkdownCell(row.sampleWorks.join('；'))} |`),
    '',
  ].join('\n')
}

function markdownReviewTable(title, rows, limit = DEFAULT_TOP_LIMIT) {
  const limited = rows.slice(0, limit)
  if (limited.length === 0) return `## ${title}\n\n暂无。\n`
  return [
    `## ${title}`,
    '',
    '| 名称 | 类型 | Role | 原始职位 | 原因 | 作品 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...limited.map((row) => `| ${escapeMarkdownCell(row.name)} | ${escapeMarkdownCell(row.kind)} | ${escapeMarkdownCell(row.role)} | ${escapeMarkdownCell(row.originalRole)} | ${escapeMarkdownCell(row.reasons.join('；'))} | ${escapeMarkdownCell(row.title)} |`),
    '',
  ].join('\n')
}

export function summarizeBangumiHints(works) {
  const personRows = collectHints(works, 'creatorCreditHints', 'person')
  const organizationRows = collectHints(works, 'organizationCreditHints', 'organization')
  const allRows = [...personRows, ...organizationRows]
  const groups = aggregateByName(organizationRows.filter((row) => row.role === 'committee'))
  const groupMembers = aggregateByName(organizationRows.filter((row) => row.role === 'committee_member'))

  return {
    worksTotal: works.length,
    worksWithPersonHints: new Set(personRows.map((row) => row.slug)).size,
    worksWithOrganizationHints: new Set(organizationRows.map((row) => row.slug)).size,
    personHintsTotal: personRows.length,
    organizationHintsTotal: organizationRows.length,
    personUniqueNames: aggregateByName(personRows).length,
    organizationUniqueNames: aggregateByName(organizationRows).length,
    personRoleCoverage: roleCoverage(personRows),
    organizationRoleCoverage: roleCoverage(organizationRows),
    personOriginalRoles: countBy(personRows, (row) => row.originalRole || 'unknown'),
    organizationOriginalRoles: countBy(organizationRows, (row) => row.originalRole || 'unknown'),
    topPersons: aggregateByName(personRows),
    topOrganizations: aggregateByName(organizationRows),
    topGroups: groups,
    topGroupMembers: groupMembers,
    reviewNeeded: reviewRows(allRows),
  }
}

export function createBangumiHintsReport(works, { inputPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const summary = summarizeBangumiHints(works)
  const lines = [
    '# Bangumi 候选职位/制作报告',
    '',
    `生成时间：${new Date().toISOString()}`,
    inputPath ? `输入文件：\`${inputPath}\`` : '',
    '',
    '## 总览',
    '',
    `- 作品数：${summary.worksTotal}`,
    `- 带人物候选作品：${summary.worksWithPersonHints}`,
    `- 带机构/制作候选作品：${summary.worksWithOrganizationHints}`,
    `- 人物候选条数：${summary.personHintsTotal}`,
    `- 机构/制作候选条数：${summary.organizationHintsTotal}`,
    `- 人物唯一名称：${summary.personUniqueNames}`,
    `- 机构唯一名称：${summary.organizationUniqueNames}`,
    `- 制作组候选名称：${summary.topGroups.length}`,
    `- 制作组成员候选名称：${summary.topGroupMembers.length}`,
    `- 疑似需人工复核条目：${summary.reviewNeeded.length}`,
    '',
    markdownRoleTable('人物 role 覆盖', summary.personRoleCoverage),
    markdownRoleTable('机构/制作 role 覆盖', summary.organizationRoleCoverage),
    markdownCountTable('Bangumi 人物原始职位', summary.personOriginalRoles, topLimit),
    markdownCountTable('Bangumi 机构原始职位', summary.organizationOriginalRoles, topLimit),
    markdownNameTable('高频人物候选', summary.topPersons, topLimit),
    markdownNameTable('高频机构候选', summary.topOrganizations, topLimit),
    markdownNameTable('制作组候选', summary.topGroups, topLimit),
    markdownNameTable('制作组成员候选', summary.topGroupMembers, topLimit),
    markdownReviewTable('疑似需要人工复核的候选名', summary.reviewNeeded, topLimit),
    '## 后续建议',
    '',
    '- 先人工检查高频人物与高频机构，确认别名、混写和错误拆分。',
    '- 对制作组与成员保持分离：组名作为 committee，括号内成员作为 committee_member。',
    '- 自动创建 creators / organizations 前，应先确定名称归一规则和别名合并策略。',
    '- 不要把这份报告或 JSON summary 提交到仓库；它属于 `data_local/reports` 的本地派生产物。',
    '',
  ]

  return lines.filter((line) => line !== '').join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.get('in')
  const output = args.get('out') || path.join('data_local', 'reports', 'bangumi-hints-report.md')
  const jsonOutput = args.get('json') || ''
  const topLimit = Number(args.get('top') || DEFAULT_TOP_LIMIT)

  if (!input) {
    console.error('Usage: pnpm source:report:bangumi-hints -- --in <deduped-candidates.jsonl> [--out <report.md>] [--json <summary.json>] [--top 40]')
    process.exitCode = 1
    return
  }

  const resolvedInput = path.resolve(input)
  const resolvedOutput = path.resolve(output)
  const works = await readJsonl(resolvedInput)
  const summary = summarizeBangumiHints(works)
  const report = createBangumiHintsReport(works, { inputPath: resolvedInput, topLimit })

  await mkdir(path.dirname(resolvedOutput), { recursive: true })
  await writeFile(resolvedOutput, `${report}\n`, 'utf8')
  console.log(`Wrote Bangumi hints report -> ${resolvedOutput}`)

  if (jsonOutput) {
    const resolvedJsonOutput = path.resolve(jsonOutput)
    await writeJsonFile(resolvedJsonOutput, summary)
    console.log(`Wrote Bangumi hints summary -> ${resolvedJsonOutput}`)
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
