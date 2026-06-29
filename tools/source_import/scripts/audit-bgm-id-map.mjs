#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_INPUT = path.join('data_local', 'payload', 'bgm-id-map.json')
const DEFAULT_OUTPUT = path.join('data_local', 'reports', 'bgm-id-map-audit.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bgm-id-map-audit.md')
const DEFAULT_TOP_LIMIT = 100
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

function rows(value) {
  return Array.isArray(value) ? value : []
}

function cleanText(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ')
}

function issue(list, code, message, extra = {}) {
  list.push({ code, message, ...extra })
}

function count(items, status) {
  return rows(items).filter((item) => item.status === status).length
}

function auditRows(items, kind, errors, warnings) {
  const seenIds = new Set()
  for (const [index, item] of rows(items).entries()) {
    if (!cleanText(item.collection)) issue(errors, 'missing-collection', 'Mapped row is missing collection.', { kind, index })
    if (item.status !== 'matched') issue(errors, `${kind}-not-matched`, 'Mapped row must be matched before relationship planning.', { kind, index, title: item.title, name: item.name, slug: item.slug, status: item.status, error: item.error })
    if (item.status === 'matched' && !cleanText(item.payload?.id)) issue(errors, `${kind}-missing-payload-id`, 'Matched row is missing Payload id.', { kind, index, title: item.title, name: item.name, slug: item.slug })
    if (cleanText(item.payload?.id)) {
      const key = `${item.collection}:${item.payload.id}`
      if (seenIds.has(key)) issue(warnings, `${kind}-duplicate-payload-id`, 'Same Payload id appears multiple times in one section.', { kind, index, id: item.payload.id })
      seenIds.add(key)
    }
  }
}

export function auditBgmIdMap(map, { generatedAt = new Date().toISOString() } = {}) {
  const errors = []
  const warnings = []
  const infos = []
  const stats = map?.meta?.stats || {}
  const works = rows(map?.works)
  const creators = rows(map?.creators)
  const organizations = rows(map?.organizations)

  if (!map || typeof map !== 'object' || Array.isArray(map)) issue(errors, 'map-not-object', 'Input map must be an object.')
  if (cleanText(map?.meta?.source) !== 'bgm-id-map') issue(errors, 'unexpected-source', 'Map source is not expected.', { source: map?.meta?.source })
  if (cleanText(map?.meta?.mode) !== 'read-only-local-query') issue(errors, 'unexpected-mode', 'Map mode is not expected.', { mode: map?.meta?.mode })
  if (map?.meta?.safety?.changes !== false) issue(errors, 'unsafe-changes-flag', 'Map must remain read-only.', { value: map?.meta?.safety?.changes })
  if (map?.meta?.safety?.relationPatch !== false) issue(errors, 'unsafe-relation-flag', 'Relation patch flag must remain false.', { value: map?.meta?.safety?.relationPatch })

  auditRows(works, 'works', errors, warnings)
  auditRows(creators, 'creators', errors, warnings)
  auditRows(organizations, 'organizations', errors, warnings)

  const computed = {
    packageWorksTotal: works.length,
    packageCreatorsTotal: creators.length,
    packageOrganizationsTotal: organizations.length,
    worksMatchedTotal: count(works, 'matched'),
    worksMissingTotal: count(works, 'missing'),
    worksAmbiguousTotal: count(works, 'ambiguous'),
    worksQueryErrorsTotal: count(works, 'query-error'),
    creatorsMatchedTotal: count(creators, 'matched'),
    creatorsMissingTotal: count(creators, 'missing'),
    creatorsAmbiguousTotal: count(creators, 'ambiguous'),
    creatorsQueryErrorsTotal: count(creators, 'query-error'),
    organizationsMatchedTotal: count(organizations, 'matched'),
    organizationsMissingTotal: count(organizations, 'missing'),
    organizationsAmbiguousTotal: count(organizations, 'ambiguous'),
    organizationsQueryErrorsTotal: count(organizations, 'query-error'),
  }

  for (const [key, value] of Object.entries(computed)) {
    if (Number(stats[key]) !== value) issue(errors, 'stats-mismatch', 'Map stats do not match row content.', { field: key, expected: value, actual: stats[key] })
  }

  if (Number(stats.entityNameCollisionRowsTotal || 0) > 0) issue(infos, 'entity-name-collisions', 'Same-name entity collisions were recorded for review.', { count: stats.entityNameCollisionRowsTotal })

  return {
    source: 'bgm-id-map-audit',
    mode: 'audit-only',
    generatedAt,
    status: errors.length === 0 ? 'pass' : 'fail',
    stats: {
      ...computed,
      entityNameCollisionRowsTotal: Number(stats.entityNameCollisionRowsTotal || 0),
      entityNameCollisionDocsTotal: Number(stats.entityNameCollisionDocsTotal || 0),
      errorsTotal: errors.length,
      warningsTotal: warnings.length,
      infosTotal: infos.length,
    },
    errors,
    warnings,
    infos,
  }
}

function renderIssues(title, items, topLimit) {
  const lines = [`## ${title}`, '']
  if (rows(items).length === 0) return `${lines.join('\n')}\n- none\n`
  for (const item of rows(items).slice(0, topLimit)) lines.push(`- ${item.code}: ${item.message}`)
  return `${lines.join('\n')}\n`
}

export function createBgmIdMapAuditReport(audit, { topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const s = audit?.stats || {}
  return `${REPORT_UTF8_BOM}${[
    '# BGM ID map audit',
    '',
    '## Summary',
    '',
    `- source: ${audit?.source || ''}`,
    `- mode: ${audit?.mode || ''}`,
    `- status: ${audit?.status || ''}`,
    `- generatedAt: ${audit?.generatedAt || ''}`,
    `- works: ${s.worksMatchedTotal}/${s.packageWorksTotal}; missing=${s.worksMissingTotal}; ambiguous=${s.worksAmbiguousTotal}; queryErrors=${s.worksQueryErrorsTotal}`,
    `- creators: ${s.creatorsMatchedTotal}/${s.packageCreatorsTotal}; missing=${s.creatorsMissingTotal}; ambiguous=${s.creatorsAmbiguousTotal}; queryErrors=${s.creatorsQueryErrorsTotal}`,
    `- organizations: ${s.organizationsMatchedTotal}/${s.packageOrganizationsTotal}; missing=${s.organizationsMissingTotal}; ambiguous=${s.organizationsAmbiguousTotal}; queryErrors=${s.organizationsQueryErrorsTotal}`,
    `- errors: ${s.errorsTotal}`,
    `- warnings: ${s.warningsTotal}`,
    `- infos: ${s.infosTotal}`,
    '',
    '## Safety',
    '',
    '- Audit only.',
    '- No relation patch.',
    '- Keep outputs under data_local.',
    '',
    renderIssues('Errors', audit?.errors, topLimit),
    '',
    renderIssues('Warnings', audit?.warnings, topLimit),
    '',
    renderIssues('Infos', audit?.infos, topLimit),
  ].join('\n')}\n`
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, value, 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.get('in') || DEFAULT_INPUT
  const output = args.get('out') || DEFAULT_OUTPUT
  const report = args.get('report') || DEFAULT_REPORT
  const topLimit = Number(args.get('top') || DEFAULT_TOP_LIMIT)
  const map = await readJson(input)
  const audit = auditBgmIdMap(map)
  await writeJson(output, audit)
  await writeText(report, createBgmIdMapAuditReport(audit, { topLimit }))
  console.log(`Wrote BGM ID map audit -> ${output}`)
  console.log(`Wrote BGM ID map audit report -> ${report}`)
  console.log(`Audit status: ${audit.status}; errors=${audit.errors.length}; warnings=${audit.warnings.length}; infos=${audit.infos.length}`)
  if (audit.status !== 'pass') process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
