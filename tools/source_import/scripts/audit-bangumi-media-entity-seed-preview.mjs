#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_INPUT = path.join('data_local', 'payload', 'bangumi-media-entity-seed-preview.json')
const DEFAULT_OUTPUT = path.join('data_local', 'reports', 'bangumi-media-entity-seed-preview-audit.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-media-entity-seed-preview-audit.md')
const DEFAULT_TOP_LIMIT = 100
const REPORT_UTF8_BOM = '\uFEFF'

const EXPECTED_SOURCE = 'bangumi-media-entity-seed-preview'
const EXPECTED_MODE = 'preview-only-no-payload-write'
const AUDIT_SOURCE = 'bangumi-media-entity-seed-preview-audit'
const AUDIT_MODE = 'audit-only-no-payload-write'
const REQUIRED_FALSE_SAFETY_FLAGS = ['payloadWrite', 'databaseWrite', 'entityImport', 'worksPatch']
const EXPECTED_COLLECTION_BY_KIND = {
  creator: 'creators',
  organization: 'organizations',
}

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
  return String(value ?? '').trim().replace(/\s+/gu, ' ')
}

function pushIssue(list, code, message, extra = {}) {
  list.push({ code, message, ...extra })
}

function countBy(items, keyFn) {
  const counts = new Map()
  for (const item of items) {
    const key = cleanText(keyFn(item))
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}

function asRows(value) {
  return Array.isArray(value) ? value : []
}

function seedDisplayName(seed) {
  return cleanText(seed?.name) || '(missing name)'
}

function auditSeedRows({ rows, kind, errors, warnings, infos }) {
  const expectedCollection = EXPECTED_COLLECTION_BY_KIND[kind]
  const seenNames = new Map()
  let platformSeedsTotal = 0
  let rowsWithEvidence = 0
  let rowsWithSourceWorks = 0

  for (const [index, seed] of rows.entries()) {
    const name = cleanText(seed?.name)
    const slug = cleanText(seed?.slug)
    const collection = cleanText(seed?.collection)
    const seedKind = cleanText(seed?.kind)
    const status = cleanText(seed?.status)
    const source = cleanText(seed?.source)
    const mode = cleanText(seed?.mode)
    const roles = asRows(seed?.roles).map(cleanText).filter(Boolean)
    const originalRoles = asRows(seed?.originalRoles).map(cleanText).filter(Boolean)
    const sourceWorks = asRows(seed?.sourceWorks)
    const evidence = asRows(seed?.evidence)
    const nameKey = name.toLowerCase()

    if (!name) pushIssue(errors, 'missing-seed-name', 'Seed is missing name.', { kind, index })
    if (!slug) pushIssue(errors, 'missing-seed-slug', 'Seed is missing slug.', { kind, index, name })
    if (collection !== expectedCollection) pushIssue(errors, 'unexpected-seed-collection', 'Seed collection does not match kind.', { kind, index, name, collection, expectedCollection })
    if (seedKind !== kind) pushIssue(errors, 'unexpected-seed-kind', 'Seed kind is not expected.', { kind, index, name, seedKind })
    if (status !== 'draft') pushIssue(errors, 'unexpected-seed-status', 'Seed preview should stay draft.', { kind, index, name, status })
    if (source !== 'bangumi-media-candidate-work-hints') pushIssue(errors, 'unexpected-seed-source', 'Seed source is not expected.', { kind, index, name, source })
    if (mode !== EXPECTED_MODE) pushIssue(errors, 'unexpected-seed-mode', 'Seed mode must be preview-only-no-payload-write.', { kind, index, name, mode })

    if (nameKey) {
      if (seenNames.has(nameKey)) {
        pushIssue(errors, 'duplicate-seed-name', 'Duplicate seed name within collection.', { kind, name, firstIndex: seenNames.get(nameKey), index })
      } else {
        seenNames.set(nameKey, index)
      }
    }

    if (roles.length === 0) pushIssue(warnings, 'missing-seed-roles', 'Seed has no roles.', { kind, index, name })
    if (originalRoles.length === 0) pushIssue(warnings, 'missing-seed-original-roles', 'Seed has no original roles.', { kind, index, name })
    if (sourceWorks.length === 0) pushIssue(errors, 'missing-seed-source-works', 'Seed has no source works.', { kind, index, name })
    if (evidence.length === 0) pushIssue(errors, 'missing-seed-evidence', 'Seed has no evidence rows.', { kind, index, name })

    if (sourceWorks.length > 0) rowsWithSourceWorks += 1
    if (evidence.length > 0) rowsWithEvidence += 1
    if (kind === 'organization' && roles.includes('platform')) platformSeedsTotal += 1

    for (const [workIndex, work] of sourceWorks.entries()) {
      if (!cleanText(work?.title)) pushIssue(errors, 'missing-source-work-title', 'Seed source work is missing title.', { kind, index, name, workIndex })
      if (!cleanText(work?.bangumiSubjectId)) pushIssue(errors, 'missing-source-work-bangumi-id', 'Seed source work is missing Bangumi subject id.', { kind, index, name, workIndex })
    }

    const evidenceKeys = new Set()
    for (const [evidenceIndex, row] of evidence.entries()) {
      const evidenceKey = cleanText(row?.key) || [cleanText(row?.work?.bangumiSubjectId), cleanText(row?.role), cleanText(row?.originalRole)].join('|')
      if (!cleanText(row?.role)) pushIssue(errors, 'missing-evidence-role', 'Evidence row is missing role.', { kind, index, name, evidenceIndex })
      if (!cleanText(row?.work?.title)) pushIssue(errors, 'missing-evidence-work-title', 'Evidence row is missing work title.', { kind, index, name, evidenceIndex })
      if (!cleanText(row?.work?.bangumiSubjectId)) pushIssue(errors, 'missing-evidence-bangumi-id', 'Evidence row is missing Bangumi subject id.', { kind, index, name, evidenceIndex })

      if (evidenceKey && evidenceKeys.has(evidenceKey)) {
        pushIssue(errors, 'duplicate-evidence-row', 'Duplicate evidence row within seed.', { kind, index, name, evidenceIndex, key: evidenceKey })
      }
      if (evidenceKey) evidenceKeys.add(evidenceKey)
    }
  }

  if (kind === 'organization' && platformSeedsTotal > 0) {
    pushIssue(infos, 'platform-organization-seeds', 'Platform entries are present as organization seed previews; decide later whether to import them.', { count: platformSeedsTotal })
  }

  return {
    rowsWithEvidence,
    rowsWithSourceWorks,
    platformSeedsTotal,
    roleCounts: countBy(rows.flatMap((seed) => asRows(seed?.roles)), (role) => role),
  }
}

export function auditBangumiMediaEntitySeedPreview(preview, { generatedAt = new Date().toISOString() } = {}) {
  const errors = []
  const warnings = []
  const infos = []
  const creators = asRows(preview?.creators)
  const organizations = asRows(preview?.organizations)
  const meta = preview?.meta || {}
  const safety = meta?.safety || {}

  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
    pushIssue(errors, 'preview-not-object', 'Preview must be an object.')
  }

  if (meta.source !== EXPECTED_SOURCE) pushIssue(errors, 'unexpected-source', 'Preview source is not expected.', { source: meta.source })
  if (meta.mode !== EXPECTED_MODE) pushIssue(errors, 'unexpected-mode', 'Preview mode is not expected.', { mode: meta.mode })

  for (const flag of REQUIRED_FALSE_SAFETY_FLAGS) {
    if (safety[flag] !== false) {
      pushIssue(errors, 'unsafe-preview-flag', 'Preview safety flag must be false.', { flag, value: safety[flag] })
    }
  }

  if (!Array.isArray(preview?.creators)) pushIssue(errors, 'creators-not-array', 'Preview creators must be an array.')
  if (!Array.isArray(preview?.organizations)) pushIssue(errors, 'organizations-not-array', 'Preview organizations must be an array.')

  const creatorStats = auditSeedRows({ rows: creators, kind: 'creator', errors, warnings, infos })
  const organizationStats = auditSeedRows({ rows: organizations, kind: 'organization', errors, warnings, infos })
  const seedsTotal = creators.length + organizations.length
  const evidenceTotal = [...creators, ...organizations].reduce((sum, seed) => sum + asRows(seed?.evidence).length, 0)

  if (seedsTotal === 0) pushIssue(warnings, 'no-seeds', 'No entity seed previews found.')

  if (meta?.stats) {
    if (Number(meta.stats.creatorsTotal) !== creators.length) pushIssue(errors, 'creators-total-mismatch', 'meta.stats.creatorsTotal does not match creators length.', { expected: creators.length, actual: meta.stats.creatorsTotal })
    if (Number(meta.stats.organizationsTotal) !== organizations.length) pushIssue(errors, 'organizations-total-mismatch', 'meta.stats.organizationsTotal does not match organizations length.', { expected: organizations.length, actual: meta.stats.organizationsTotal })
    if (Number(meta.stats.seedsTotal) !== seedsTotal) pushIssue(errors, 'seeds-total-mismatch', 'meta.stats.seedsTotal does not match seed total.', { expected: seedsTotal, actual: meta.stats.seedsTotal })
    if (Number(meta.stats.seedEvidenceTotal) !== evidenceTotal) pushIssue(errors, 'seed-evidence-total-mismatch', 'meta.stats.seedEvidenceTotal does not match evidence total.', { expected: evidenceTotal, actual: meta.stats.seedEvidenceTotal })
  }

  return {
    source: AUDIT_SOURCE,
    mode: AUDIT_MODE,
    generatedAt,
    status: errors.length === 0 ? 'pass' : 'fail',
    input: {
      source: meta.source,
      mode: meta.mode,
      generatedAt: meta.generatedAt,
    },
    stats: {
      creatorsTotal: creators.length,
      organizationsTotal: organizations.length,
      seedsTotal,
      seedEvidenceTotal: evidenceTotal,
      creatorsWithEvidence: creatorStats.rowsWithEvidence,
      organizationsWithEvidence: organizationStats.rowsWithEvidence,
      creatorsWithSourceWorks: creatorStats.rowsWithSourceWorks,
      organizationsWithSourceWorks: organizationStats.rowsWithSourceWorks,
      platformOrganizationSeedsTotal: organizationStats.platformSeedsTotal,
      creatorRoleCounts: creatorStats.roleCounts,
      organizationRoleCounts: organizationStats.roleCounts,
    },
    errors,
    warnings,
    infos,
  }
}

export function createBangumiMediaEntitySeedPreviewAuditReport(audit, { inputPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const stats = audit?.stats || {}
  const lines = [
    '# Bangumi media entity seed preview audit',
    '',
    '## Summary',
    '',
    `- source: ${audit.source}`,
    `- mode: ${audit.mode}`,
    `- status: ${audit.status}`,
    `- generatedAt: ${audit.generatedAt}`,
    inputPath ? `- input: ${inputPath}` : '',
    `- creatorsTotal: ${stats.creatorsTotal}`,
    `- organizationsTotal: ${stats.organizationsTotal}`,
    `- seedsTotal: ${stats.seedsTotal}`,
    `- seedEvidenceTotal: ${stats.seedEvidenceTotal}`,
    `- platformOrganizationSeedsTotal: ${stats.platformOrganizationSeedsTotal}`,
    `- errors: ${(audit.errors || []).length}`,
    `- warnings: ${(audit.warnings || []).length}`,
    `- infos: ${(audit.infos || []).length}`,
    '',
    '## Safety',
    '',
    '- Audit only.',
    '- No Payload connection.',
    '- No database writes.',
    '- No entity import.',
    '- No works patch.',
    '- Outputs should stay under data_local and must not be committed.',
    '',
    '## Creator role counts',
    '',
  ].filter((line) => line !== '')

  for (const [role, count] of Object.entries(stats.creatorRoleCounts || {})) lines.push(`- ${role}: ${count}`)

  lines.push('', '## Organization role counts', '')
  for (const [role, count] of Object.entries(stats.organizationRoleCounts || {})) lines.push(`- ${role}: ${count}`)

  for (const [heading, items] of [
    ['Errors', audit.errors || []],
    ['Warnings', audit.warnings || []],
    ['Infos', audit.infos || []],
  ]) {
    lines.push('', `## ${heading}`, '')
    if (items.length === 0) {
      lines.push('- none')
      continue
    }
    for (const item of items.slice(0, topLimit)) lines.push(`- ${item.code}: ${item.message}`)
    if (items.length > topLimit) lines.push(`- ... ${items.length - topLimit} more`)
  }

  return `${REPORT_UTF8_BOM}${lines.join('\n')}\n`
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

  const preview = await readJson(input)
  const audit = auditBangumiMediaEntitySeedPreview(preview)

  await writeJson(output, audit)
  await writeText(report, createBangumiMediaEntitySeedPreviewAuditReport(audit, { inputPath: input, topLimit }))

  console.log(`Wrote Bangumi media entity seed preview audit -> ${output}`)
  console.log(`Wrote Bangumi media entity seed preview audit report -> ${report}`)
  console.log(`Audit status: ${audit.status}; errors: ${audit.errors.length}; warnings: ${audit.warnings.length}; infos: ${audit.infos.length}`)

  if (audit.status !== 'pass') process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
