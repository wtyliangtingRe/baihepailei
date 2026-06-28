#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readJsonl, writeJsonFile } from '../lib/jsonl.mjs'

const DEFAULT_TOP_LIMIT = 50

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

function stableHash(value) {
  let hash = 0x811c9dc5
  for (const char of cleanText(value).toLowerCase()) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).padStart(7, '0')
}

function normalizedName(value) {
  return cleanText(value).toLowerCase()
}

function workSlug(work) {
  return cleanText(work?.slug || work?.externalIds?.bangumiSubjectId || work?.title || 'unknown')
}

function collectHintRows(works, fieldName, kind) {
  const rows = []
  for (const work of works) {
    const hints = Array.isArray(work?.[fieldName]) ? work[fieldName] : []
    const seen = new Set()
    for (const hint of hints) {
      const name = cleanText(hint?.name)
      if (!name) continue
      const role = cleanText(hint?.role || 'other') || 'other'
      const originalRole = cleanText(hint?.originalRole)
      const key = `${kind}:${stableHash(name)}`
      const dedupeKey = [key, role, originalRole, workSlug(work)].join('|')
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      rows.push({
        kind,
        key,
        name,
        role,
        originalRole,
        source: cleanText(hint?.source || 'bangumi') || 'bangumi',
        note: cleanText(hint?.note),
        workSlug: workSlug(work),
        workTitle: cleanText(work?.title),
        bangumiSubjectId: cleanText(work?.externalIds?.bangumiSubjectId),
      })
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

function uniqueSorted(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function reviewFlags(item, sharedNames) {
  const flags = []
  if (/[、,，;；/／&＆+＋×・]/u.test(item.name)) flags.push('compound_name')
  if (/[「」『』《》（）()［\]]/u.test(item.name)) flags.push('has_bracket_or_quote')
  if (sharedNames.has(normalizedName(item.name))) flags.push('appears_in_both_lists')
  if (item.kind === 'creator' && /委員会|委员会|製作|制作|Project|Studio|会社|社$/u.test(item.name)) flags.push('creator_name_looks_like_group')
  if (item.kind === 'organization' && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー・]{2,5}$/u.test(item.name)) flags.push('organization_name_may_be_person')
  return flags
}

function aggregateRows(rows, sharedNames) {
  const byKey = new Map()
  for (const row of rows) {
    const item = byKey.get(row.key) || {
      kind: row.kind,
      key: row.key,
      name: row.name,
      suggestedSlug: `${row.kind}-${stableHash(row.name)}`,
      hintCount: 0,
      works: new Map(),
      roles: new Map(),
      originalRoles: new Map(),
      sources: new Set(),
      sampleNotes: new Set(),
    }
    item.hintCount += 1
    item.works.set(row.workSlug, {
      title: row.workTitle,
      slug: row.workSlug,
      bangumiSubjectId: row.bangumiSubjectId,
    })
    item.roles.set(row.role, (item.roles.get(row.role) || 0) + 1)
    if (row.originalRole) item.originalRoles.set(row.originalRole, (item.originalRoles.get(row.originalRole) || 0) + 1)
    item.sources.add(row.source)
    if (row.note) item.sampleNotes.add(row.note)
    byKey.set(row.key, item)
  }

  return [...byKey.values()].map((item) => {
    const output = {
      kind: item.kind,
      key: item.key,
      name: item.name,
      suggestedSlug: item.suggestedSlug,
      hintCount: item.hintCount,
      worksCount: item.works.size,
      roles: [...item.roles.entries()].map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count || a.role.localeCompare(b.role)),
      originalRoles: [...item.originalRoles.entries()].map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count || a.role.localeCompare(b.role)),
      sources: uniqueSorted([...item.sources]),
      sampleWorks: [...item.works.values()].slice(0, 10),
      sampleNotes: uniqueSorted([...item.sampleNotes]).slice(0, 5),
    }
    output.reviewFlags = reviewFlags(output, sharedNames)
    return output
  }).sort((a, b) => b.worksCount - a.worksCount || b.hintCount - a.hintCount || a.name.localeCompare(b.name))
}

export function buildBangumiEntityReview(works) {
  const creatorRows = collectHintRows(works, 'creatorCreditHints', 'creator')
  const organizationRows = collectHintRows(works, 'organizationCreditHints', 'organization')
  const creatorNames = new Set(creatorRows.map((row) => normalizedName(row.name)))
  const organizationNames = new Set(organizationRows.map((row) => normalizedName(row.name)))
  const sharedNames = new Set([...creatorNames].filter((name) => organizationNames.has(name)))
  const creators = aggregateRows(creatorRows, sharedNames)
  const organizations = aggregateRows(organizationRows, sharedNames)

  return {
    meta: {
      worksTotal: works.length,
      creatorRowsTotal: creatorRows.length,
      organizationRowsTotal: organizationRows.length,
      creatorsTotal: creators.length,
      organizationsTotal: organizations.length,
      sharedNameCandidates: sharedNames.size,
      flaggedCreators: creators.filter((item) => item.reviewFlags.length > 0).length,
      flaggedOrganizations: organizations.filter((item) => item.reviewFlags.length > 0).length,
      creatorRoles: countBy(creatorRows, (row) => row.role).map(([role, count]) => ({ role, count })),
      organizationRoles: countBy(organizationRows, (row) => row.role).map(([role, count]) => ({ role, count })),
    },
    creators,
    organizations,
  }
}

function markdownCandidateTable(title, rows, limit = DEFAULT_TOP_LIMIT) {
  const limited = rows.slice(0, limit)
  if (limited.length === 0) return `## ${title}\n\n暂无。\n`
  return [
    `## ${title}`,
    '',
    '| 名称 | 覆盖作品 | 候选条数 | Roles | 复核标记 | 作品示例 |',
    '| --- | ---: | ---: | --- | --- | --- |',
    ...limited.map((item) => `| ${escapeMarkdownCell(item.name)} | ${item.worksCount} | ${item.hintCount} | ${escapeMarkdownCell(item.roles.map((role) => `${role.role}:${role.count}`).join('；'))} | ${escapeMarkdownCell(item.reviewFlags.join('；'))} | ${escapeMarkdownCell(item.sampleWorks.map((work) => work.title).slice(0, 5).join('；'))} |`),
    '',
  ].join('\n')
}

export function createBangumiEntityReviewReport(review, { inputPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const flagged = [...review.creators, ...review.organizations]
    .filter((item) => item.reviewFlags.length > 0)
    .sort((a, b) => b.worksCount - a.worksCount || a.name.localeCompare(b.name))

  return [
    '# Bangumi 候选实体审查报告',
    '',
    `生成时间：${new Date().toISOString()}`,
    inputPath ? `输入文件：\`${inputPath}\`` : '',
    '',
    '## 总览',
    '',
    `- 作品数：${review.meta.worksTotal}`,
    `- creator hint 行数：${review.meta.creatorRowsTotal}`,
    `- organization hint 行数：${review.meta.organizationRowsTotal}`,
    `- creator 候选数：${review.meta.creatorsTotal}`,
    `- organization 候选数：${review.meta.organizationsTotal}`,
    `- 人物/机构同名候选：${review.meta.sharedNameCandidates}`,
    `- 带复核标记 creator：${review.meta.flaggedCreators}`,
    `- 带复核标记 organization：${review.meta.flaggedOrganizations}`,
    '',
    markdownCandidateTable('高频 creator 候选', review.creators, topLimit),
    markdownCandidateTable('高频 organization 候选', review.organizations, topLimit),
    markdownCandidateTable('需要人工复核的高频候选', flagged, topLimit),
    '## 后续建议',
    '',
    '- 优先人工检查 `compound_name`、`appears_in_both_lists`、`creator_name_looks_like_group`。',
    '- 这份输出只是审查清单，不应直接导入 Payload。',
    '- 生成的 JSON/Markdown 属于 `data_local` 本地派生产物，不要提交。',
    '',
  ].filter((line) => line !== '').join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.get('in')
  const output = args.get('out') || path.join('data_local', 'payload', 'bangumi-entity-candidates.json')
  const reportOutput = args.get('report') || path.join('data_local', 'reports', 'bangumi-entity-candidates-report.md')
  const topLimit = Number(args.get('top') || DEFAULT_TOP_LIMIT)

  if (!input) {
    console.error('Usage: node tools/source_import/scripts/report-bangumi-entities.mjs --in <deduped-candidates.jsonl> [--out <candidates.json>] [--report <report.md>] [--top 50]')
    process.exitCode = 1
    return
  }

  const resolvedInput = path.resolve(input)
  const resolvedOutput = path.resolve(output)
  const resolvedReportOutput = path.resolve(reportOutput)
  const works = await readJsonl(resolvedInput)
  const review = buildBangumiEntityReview(works)
  const report = createBangumiEntityReviewReport(review, { inputPath: resolvedInput, topLimit })

  await mkdir(path.dirname(resolvedOutput), { recursive: true })
  await writeJsonFile(resolvedOutput, review)
  console.log(`Wrote Bangumi entity candidates -> ${resolvedOutput}`)

  await mkdir(path.dirname(resolvedReportOutput), { recursive: true })
  await writeFile(resolvedReportOutput, `${report}\n`, 'utf8')
  console.log(`Wrote Bangumi entity candidate report -> ${resolvedReportOutput}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
