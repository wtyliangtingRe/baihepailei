#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_INPUT = path.join('data_local', 'payload', 'bangumi-media-entity-seed-package-preview.json')
const DEFAULT_OUTPUT = path.join('data_local', 'reports', 'bangumi-media-entity-seed-package-preview-audit.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-media-entity-seed-package-preview-audit.md')
const DEFAULT_TOP_LIMIT = 100
const REPORT_UTF8_BOM = '\uFEFF'
const EXPECTED_SOURCE = 'bangumi-media-entity-seed-package-preview'
const EXPECTED_MODE = 'package-preview-only-no-payload-write'
const AUDIT_SOURCE = 'bangumi-media-entity-seed-package-preview-audit'
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

function asRows(value) {
  return Array.isArray(value) ? value : []
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

function auditEntities({ rows, kind, errors, warnings }) {
  const expectedCollection = EXPECTED_COLLECTION_BY_KIND[kind]
  const seenNames = new Map()
  let rowsWithEvidence = 0
  let rowsWithSourceWorks = 0
  let platformRowsTotal = 0

  for (const [index, entity] of rows.entries()) {
    const name = cleanText(entity?.name)
    const slug = cleanText(entity?.slug)
    const collection = cleanText(entity?.collection)
    const entityKind = cleanText(entity?.kind)
    const status = cleanText(entity?.status)
    const importAction = cleanText(entity?.importAction)
    const source = cleanText(entity?.source)
    const roles = asRows(entity?.roles).map(cleanText).filter(Boolean)
    const originalRoles = asRows(entity?.originalRoles).map(cleanText).filter(Boolean)
    const sourceWorks = asRows(entity?.sourceWorks)
    const evidence = asRows(entity?.evidence)
    const safety = entity?.safety || {}
    const nameKey = name.toLowerCase()

    if (!name) pushIssue(errors, 'missing-entity-name', 'Package entity is missing name.', { kind, index })
    if (!slug) pushIssue(errors, 'missing-entity-slug', 'Package entity is missing slug.', { kind, index, name })
    if (collection !== expectedCollection) pushIssue(errors, 'unexpected-entity-collection', 'Package entity collection does not match kind.', { kind, index, name, collection, expectedCollection })
    if (entityKind !== kind) pushIssue(errors, 'unexpected-entity-kind', 'Package entity kind is not expected.', { kind, index, name, entityKind })
    if (status !== 'draft') pushIssue(errors, 'unexpected-entity-status', 'Package entity should stay draft.', { kind, index, name, status })
    if (importAction !== 'create-if-missing') pushIssue(errors, 'unexpected-import-action', 'Package entity importAction is not expected.', { kind, index, name, importAction })
    if (source !== EXPECTED_SOURCE) pushIssue(errors, 'unexpected-entity-source', 'Package entity source is not expected.', { kind, index, name, source })

    for (const flag of REQUIRED_FALSE_SAFETY_FLAGS) {
      if (safety[flag] !== false) pushIssue(errors, 'unsafe-entity-flag', 'Package entity safety flag must be false.', { kind, index, name, flag, value: safety[flag] })
    }

    if (nameKey) {
      if (seenNames.has(nameKey)) pushIssue(errors, 'duplicate-package-entity-name', 'Duplicate package entity name within collection.', { kind, name, firstIndex: seenNames.get(nameKey), index })
      else seenNames.set(nameKey, index)
    }

    if (roles.length === 0) pushIssue(warnings, 'missing-entity-roles', 'Package entity has no roles.', { kind, index, name })
    if (originalRoles.length === 0) pushIssue(warnings, 'missing-entity-original-roles', 'Package entity has no original roles.', { kind, index, name })
    if (sourceWorks.length === 0) pushIssue(errors, 'missing-entity-source-works', 'Package entity has no source works.', { kind, index, name })
    if (evidence.length === 0) pushIssue(errors, 'missing-entity-evidence', 'Package entity has no evidence rows.', { kind, index, name })

    if (kind === 'organization' && roles.includes('platform')) {
      platformRowsTotal += 1
      pushIssue(errors, 'platform-organization-in-package', 'Platform organization seed should be excluded from import package by default.', { index, name, roles })
    }

    if (sourceWorks.length > 0) rowsWithSourceWorks += 1
    if (evidence.length > 0) rowsWithEvidence += 1

    for (const [workIndex, work] of sourceWorks.entries()) {
      if (!cleanText(work?.title)) pushIssue(errors, 'missing-source-work-title', 'Package entity source work is missing title.', { kind, index, name, workIndex })
      if (!cleanText(work?.bangumiSubjectId)) pushIssue(errors, 'missing-source-work-bangumi-id', 'Package entity source work is missing Bangumi subject id.', { kind, index, name, workIndex })
    }

    const evidenceKeys = new Set()
    for (const [evidenceIndex, row] of evidence.entries()) {
      const evidenceKey = cleanText(row?.key) || [cleanText(row?.work?.bangumiSubjectId), cleanText(row?.role), cleanText(row?.originalRole)].join('|')
      if (!cleanText(row?.role)) pushIssue(errors, 'missing-evidence-role', 'Package entity evidence row is missing role.', { kind, index, name, evidenceIndex })
      if (!cleanText(row?.work?.title)) pushIssue(errors, 'missing-evidence-work-title', 'Package entity evidence row is missing work title.', { kind, index, name, evidenceIndex })
      if (!cleanText(row?.work?.bangumiSubjectId)) pushIssue(errors, 'missing-evidence-bangumi-id', 'Package entity evidence row is missing Bangumi subject id.', { kind, index, name, evidenceIndex })
      if (evidenceKey && evidenceKeys.has(evidenceKey)) pushIssue(errors, 'duplicate-evidence-row', 'Duplicate evidence row within package entity.', { kind, index, name, evidenceIndex, key: evidenceKey })
      if (evidenceKey) evidenceKeys.add(evidenceKey)
    }
  }

  return {
    rowsWithEvidence,
    rowsWithSourceWorks,
    platformRowsTotal,
    roleCounts: countBy(rows.flatMap((entity) => asRows(entity?.roles)), (role) => role),
  }
}

export function auditBangumiMediaEntitySeedPackagePreview(pkg, { generatedAt = new Date().toISOString() } = {}) {
  const errors = []
  const warnings = []
  const infos = []
  const meta = pkg?.meta || {}
  const safety = meta?.safety || {}
  const creators = asRows(pkg?.creators)
  const organizations = asRows(pkg?.organizations)
  const skippedSeeds = asRows(pkg?.skippedSeeds)

  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) pushIssue(errors, 'package-not-object', 'Package preview must be an object.')
  if (meta.source !== EXPECTED_SOURCE) pushIssue(errors, 'unexpected-source', 'Package preview source is not expected.', { source: meta.source })
  if (meta.mode !== EXPECTED_MODE) pushIssue(errors, 'unexpected-mode', 'Package preview mode is not expected.', { mode: meta.mode })

  for (const flag of REQUIRED_FALSE_SAFETY_FLAGS) {
    if (safety[flag] !== false) pushIssue(errors, 'unsafe-package-flag', 'Package preview safety flag must be false.', { flag, value: safety[flag] })
  }

  if (!Array.isArray(pkg?.creators)) pushIssue(errors, 'creators-not-array', 'Package creators must be an array.')
  if (!Array.isArray(pkg?.organizations)) pushIssue(errors, 'organizations-not-array', 'Package organizations must be an array.')
  if (!Array.isArray(pkg?.skippedSeeds)) pushIssue(errors, 'skipped-seeds-not-array', 'Package skippedSeeds must be an array.')

  const creatorStats = auditEntities({ rows: creators, kind: 'creator', errors, warnings })
  const organizationStats = auditEntities({ rows: organizations, kind: 'organization', errors, warnings })
  const entitiesTotal = creators.length + organizations.length
  const packageEvidenceTotal = [...creators, ...organizations].reduce((sum, entity) => sum + asRows(entity?.evidence).length, 0)
  const excludedPlatformSeedsTotal = skippedSeeds.filter((seed) => cleanText(seed.reason) === 'platform-organization-excluded-by-default').length

  if (excludedPlatformSeedsTotal > 0) {
    pushIssue(infos, 'platform-organization-seeds-excluded', 'Platform organization seeds were excluded from the package by default.', { count: excludedPlatformSeedsTotal })
  }

  for (const [index, seed] of skippedSeeds.entries()) {
    if (!cleanText(seed?.name)) pushIssue(errors, 'missing-skipped-seed-name', 'Skipped seed is missing name.', { index })
    if (!cleanText(seed?.reason)) pushIssue(errors, 'missing-skipped-seed-reason', 'Skipped seed is missing reason.', { index, name: seed?.name })
  }

  if (meta?.stats) {
    if (Number(meta.stats.creatorsTotal) !== creators.length) pushIssue(errors, 'creators-total-mismatch', 'meta.stats.creatorsTotal does not match creators length.', { expected: creators.length, actual: meta.stats.creatorsTotal })
    if (Number(meta.stats.organizationsTotal) !== organizations.length) pushIssue(errors, 'organizations-total-mismatch', 'meta.stats.organizationsTotal does not match organizations length.', { expected: organizations.length, actual: meta.stats.organizationsTotal })
    if (Number(meta.stats.entitiesTotal) !== entitiesTotal) pushIssue(errors, 'entities-total-mismatch', 'meta.stats.entitiesTotal does not match package entity total.', { expected: entitiesTotal, actual: meta.stats.entitiesTotal })
    if (Number(meta.stats.skippedSeedsTotal) !== skippedSeeds.length) pushIssue(errors, 'skipped-seeds-total-mismatch', 'meta.stats.skippedSeedsTotal does not match skippedSeeds length.', { expected: skippedSeeds.length, actual: meta.stats.skippedSeedsTotal })
    if (Number(meta.stats.excludedPlatformSeedsTotal) !== excludedPlatformSeedsTotal) pushIssue(errors, 'excluded-platform-total-mismatch', 'meta.stats.excludedPlatformSeedsTotal does not match skipped platform seeds.', { expected: excludedPlatformSeedsTotal, actual: meta.stats.excludedPlatformSeedsTotal })
    if (Number(meta.stats.packageEvidenceTotal) !== packageEvidenceTotal) pushIssue(errors, 'package-evidence-total-mismatch', 'meta.stats.packageEvidenceTotal does not match evidence total.', { expected: packageEvidenceTotal, actual: meta.stats.packageEvidenceTotal })
  }

  return {
    source: 'bangumi-media-entity-seed-package-preview-audit',
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
      entitiesTotal,
      skippedSeedsTotal: skippedSeeds.length,
      excludedPlatformSeedsTotal,
      packageEvidenceTotal,
      creatorsWithEvidence: creatorStats.rowsWithEvidence,
      organizationsWithEvidence: organizationStats.rowsWithEvidence,
      creatorsWithSourceWorks: creatorStats.rowsWithSourceWorks,
      organizationsWithSourceWorks: organizationStats.rowsWithSourceWorks,
      platformOrganizationsInPackageTotal: organizationStats.platformRowsTotal,
      creatorRoleCounts: creatorStats.roleCounts,
      organizationRoleCounts: organizationStats.roleCounts,
    },
    errors,
    warnings,
    infos,
  }
}

export function createBangumiMediaEntitySeedPackagePreviewAuditReport(audit, { inputPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const stats = audit?.stats || {}
  const lines = [
    '# Bangumi media entity seed package preview audit',
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
    `- entitiesTotal: ${stats.entitiesTotal}`,
    `- skippedSeedsTotal: ${stats.skippedSeedsTotal}`,
    `- excludedPlatformSeedsTotal: ${stats.excludedPlatformSeedsTotal}`,
    `- packageEvidenceTotal: ${stats.packageEvidenceTotal}`,
    `- platformOrganizationsInPackageTotal: ${stats.platformOrganizationsInPackageTotal}`,
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

  const pkg = await readJson(input)
  const audit = auditBangumiMediaEntitySeedPackagePreview(pkg)

  await writeJson(output, audit)
  await writeText(report, createBangumiMediaEntitySeedPackagePreviewAuditReport(audit, { inputPath: input, topLimit }))

  console.log(`Wrote Bangumi media entity seed package preview audit -> ${output}`)
  console.log(`Wrote Bangumi media entity seed package preview audit report -> ${report}`)
  console.log(`Audit status: ${audit.status}; errors: ${audit.errors.length}; warnings: ${audit.warnings.length}; infos: ${audit.infos.length}`)

  if (audit.status !== 'pass') process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
