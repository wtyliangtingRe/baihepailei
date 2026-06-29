#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_INPUT = path.join('data_local', 'payload', 'bangumi-media-work-package-preview.json')
const DEFAULT_OUTPUT = path.join('data_local', 'reports', 'bangumi-media-work-package-preview-audit.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-media-work-package-preview-audit.md')
const DEFAULT_TOP_LIMIT = 100
const REPORT_UTF8_BOM = '\uFEFF'

const EXPECTED_SOURCE = 'bangumi-media-work-package-preview'
const EXPECTED_MODE = 'package-preview-only-no-payload-write'
const AUDIT_SOURCE = 'bangumi-media-work-package-preview-audit'
const AUDIT_MODE = 'audit-only-no-payload-write'
const REQUIRED_FALSE_SAFETY_FLAGS = ['payloadWrite', 'databaseWrite', 'workImport', 'entityImport', 'worksPatch', 'coverUpload']

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

function auditCreditHints({ hints, workIndex, title, kind, errors, warnings }) {
  const seen = new Set()
  for (const [hintIndex, hint] of hints.entries()) {
    const name = cleanText(hint?.name)
    const role = cleanText(hint?.role)
    const key = [name.toLowerCase(), role, cleanText(hint?.originalRole)].join('|')

    if (!name) pushIssue(errors, 'missing-credit-hint-name', 'Credit hint is missing name.', { workIndex, title, kind, hintIndex })
    if (!role) pushIssue(warnings, 'missing-credit-hint-role', 'Credit hint is missing normalized role.', { workIndex, title, kind, hintIndex, name })
    if (seen.has(key)) pushIssue(warnings, 'duplicate-credit-hint', 'Duplicate credit hint within work package row.', { workIndex, title, kind, hintIndex, name, role })
    seen.add(key)
  }
}

export function auditBangumiMediaWorkPackagePreview(pkg, { generatedAt = new Date().toISOString() } = {}) {
  const errors = []
  const warnings = []
  const infos = []
  const meta = pkg?.meta || {}
  const safety = meta?.safety || {}
  const works = asRows(pkg?.works)
  const seenBangumiIds = new Map()
  const seenSlugs = new Map()
  let rowsWithCreatorHints = 0
  let rowsWithOrganizationHints = 0
  let rowsWithCoverReferences = 0
  let creatorCreditHintsTotal = 0
  let organizationCreditHintsTotal = 0

  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) pushIssue(errors, 'package-not-object', 'Work package preview must be an object.')
  if (meta.source !== EXPECTED_SOURCE) pushIssue(errors, 'unexpected-source', 'Work package preview source is not expected.', { source: meta.source })
  if (meta.mode !== EXPECTED_MODE) pushIssue(errors, 'unexpected-mode', 'Work package preview mode is not expected.', { mode: meta.mode })

  for (const flag of REQUIRED_FALSE_SAFETY_FLAGS) {
    if (safety[flag] !== false) pushIssue(errors, 'unsafe-package-flag', 'Package safety flag must be false.', { flag, value: safety[flag] })
  }

  if (!Array.isArray(pkg?.works)) pushIssue(errors, 'works-not-array', 'Package works must be an array.')
  if (works.length === 0) pushIssue(warnings, 'no-works', 'No work package rows found.')

  for (const [index, work] of works.entries()) {
    const title = cleanText(work?.title)
    const slug = cleanText(work?.slug)
    const bangumiSubjectId = cleanText(work?.bangumiSubjectId)
    const mediaGroup = cleanText(work?.mediaGroup)
    const mediaType = cleanText(work?.mediaType)
    const creatorHints = asRows(work?.creatorCreditHints)
    const organizationHints = asRows(work?.organizationCreditHints)
    const evidence = asRows(work?.evidence)
    const rowSafety = work?.safety || {}

    if (cleanText(work?.collection) !== 'works') pushIssue(errors, 'unexpected-work-collection', 'Work package row collection must be works.', { index, title, collection: work?.collection })
    if (cleanText(work?.kind) !== 'media-work') pushIssue(errors, 'unexpected-work-kind', 'Work package row kind must be media-work.', { index, title, kind: work?.kind })
    if (!title) pushIssue(errors, 'missing-work-title', 'Work package row is missing title.', { index })
    if (!slug) pushIssue(errors, 'missing-work-slug', 'Work package row is missing slug.', { index, title })
    if (!bangumiSubjectId) pushIssue(errors, 'missing-bangumi-subject-id', 'Work package row is missing Bangumi subject id.', { index, title })
    if (!mediaGroup) pushIssue(errors, 'missing-media-group', 'Work package row is missing mediaGroup.', { index, title })
    if (!mediaType) pushIssue(errors, 'missing-media-type', 'Work package row is missing mediaType.', { index, title })
    if (cleanText(work?.status) !== 'draft') pushIssue(errors, 'unexpected-work-status', 'Work package row should stay draft.', { index, title, status: work?.status })
    if (cleanText(work?.importAction) !== 'create-if-missing') pushIssue(errors, 'unexpected-import-action', 'Work package row importAction is not expected.', { index, title, importAction: work?.importAction })
    if (cleanText(work?.source) !== EXPECTED_SOURCE) pushIssue(errors, 'unexpected-work-source', 'Work package row source is not expected.', { index, title, source: work?.source })

    for (const flag of REQUIRED_FALSE_SAFETY_FLAGS) {
      if (rowSafety[flag] !== false) pushIssue(errors, 'unsafe-work-flag', 'Work package row safety flag must be false.', { index, title, flag, value: rowSafety[flag] })
    }

    if (bangumiSubjectId) {
      const idKey = bangumiSubjectId.toLowerCase()
      if (seenBangumiIds.has(idKey)) pushIssue(errors, 'duplicate-bangumi-subject-id', 'Duplicate Bangumi subject id in work package.', { index, title, bangumiSubjectId, firstIndex: seenBangumiIds.get(idKey) })
      else seenBangumiIds.set(idKey, index)
    }

    if (slug) {
      const slugKey = slug.toLowerCase()
      if (seenSlugs.has(slugKey)) pushIssue(errors, 'duplicate-work-slug', 'Duplicate work slug in package.', { index, title, slug, firstIndex: seenSlugs.get(slugKey) })
      else seenSlugs.set(slugKey, index)
    }

    if (!Array.isArray(work?.creatorCreditHints)) pushIssue(errors, 'creator-credit-hints-not-array', 'creatorCreditHints must be an array.', { index, title })
    if (!Array.isArray(work?.organizationCreditHints)) pushIssue(errors, 'organization-credit-hints-not-array', 'organizationCreditHints must be an array.', { index, title })
    if (creatorHints.length > 0) rowsWithCreatorHints += 1
    if (organizationHints.length > 0) rowsWithOrganizationHints += 1
    creatorCreditHintsTotal += creatorHints.length
    organizationCreditHintsTotal += organizationHints.length

    auditCreditHints({ hints: creatorHints, workIndex: index, title, kind: 'creator', errors, warnings })
    auditCreditHints({ hints: organizationHints, workIndex: index, title, kind: 'organization', errors, warnings })

    if (evidence.length === 0) pushIssue(errors, 'missing-work-evidence', 'Work package row has no evidence.', { index, title })
    for (const [evidenceIndex, row] of evidence.entries()) {
      if (!cleanText(row?.bangumiSubjectId)) pushIssue(errors, 'missing-evidence-bangumi-id', 'Work evidence row is missing Bangumi subject id.', { index, title, evidenceIndex })
      if (!cleanText(row?.title)) pushIssue(errors, 'missing-evidence-title', 'Work evidence row is missing title.', { index, title, evidenceIndex })
    }

    if (work?.coverPreview?.value) rowsWithCoverReferences += 1
    if (work?.coverPreview?.upload === true || rowSafety.coverUpload !== false) {
      pushIssue(errors, 'cover-upload-not-disabled', 'Cover preview must remain reference-only with no upload.', { index, title })
    }
  }

  if (meta?.stats) {
    if (Number(meta.stats.worksTotal) !== works.length) pushIssue(errors, 'works-total-mismatch', 'meta.stats.worksTotal does not match works length.', { expected: works.length, actual: meta.stats.worksTotal })
    if (Number(meta.stats.creatorCreditHintsTotal) !== creatorCreditHintsTotal) pushIssue(errors, 'creator-hints-total-mismatch', 'meta.stats.creatorCreditHintsTotal does not match actual hints.', { expected: creatorCreditHintsTotal, actual: meta.stats.creatorCreditHintsTotal })
    if (Number(meta.stats.organizationCreditHintsTotal) !== organizationCreditHintsTotal) pushIssue(errors, 'organization-hints-total-mismatch', 'meta.stats.organizationCreditHintsTotal does not match actual hints.', { expected: organizationCreditHintsTotal, actual: meta.stats.organizationCreditHintsTotal })
    if (Number(meta.stats.rowsWithCreatorHints) !== rowsWithCreatorHints) pushIssue(errors, 'rows-with-creator-hints-mismatch', 'meta.stats.rowsWithCreatorHints does not match actual rows.', { expected: rowsWithCreatorHints, actual: meta.stats.rowsWithCreatorHints })
    if (Number(meta.stats.rowsWithOrganizationHints) !== rowsWithOrganizationHints) pushIssue(errors, 'rows-with-organization-hints-mismatch', 'meta.stats.rowsWithOrganizationHints does not match actual rows.', { expected: rowsWithOrganizationHints, actual: meta.stats.rowsWithOrganizationHints })
  }

  if (rowsWithCoverReferences > 0) pushIssue(infos, 'cover-references-present', 'Cover references are present but remain upload-disabled.', { count: rowsWithCoverReferences })

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
      worksTotal: works.length,
      creatorCreditHintsTotal,
      organizationCreditHintsTotal,
      rowsWithCreatorHints,
      rowsWithOrganizationHints,
      rowsWithCoverReferences,
      mediaGroupCounts: countBy(works, (work) => work.mediaGroup),
      mediaTypeCounts: countBy(works, (work) => work.mediaType),
    },
    errors,
    warnings,
    infos,
  }
}

export function createBangumiMediaWorkPackagePreviewAuditReport(audit, { inputPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const stats = audit?.stats || {}
  const lines = [
    '# Bangumi media work package preview audit',
    '',
    '## Summary',
    '',
    `- source: ${audit.source}`,
    `- mode: ${audit.mode}`,
    `- status: ${audit.status}`,
    `- generatedAt: ${audit.generatedAt}`,
    inputPath ? `- input: ${inputPath}` : '',
    `- worksTotal: ${stats.worksTotal}`,
    `- creatorCreditHintsTotal: ${stats.creatorCreditHintsTotal}`,
    `- organizationCreditHintsTotal: ${stats.organizationCreditHintsTotal}`,
    `- rowsWithCreatorHints: ${stats.rowsWithCreatorHints}`,
    `- rowsWithOrganizationHints: ${stats.rowsWithOrganizationHints}`,
    `- rowsWithCoverReferences: ${stats.rowsWithCoverReferences}`,
    `- errors: ${(audit.errors || []).length}`,
    `- warnings: ${(audit.warnings || []).length}`,
    `- infos: ${(audit.infos || []).length}`,
    '',
    '## Safety',
    '',
    '- Audit only.',
    '- No Payload connection.',
    '- No database writes.',
    '- No work import.',
    '- No entity import.',
    '- No works patch.',
    '- Cover references are not uploaded.',
    '- Outputs should stay under data_local and must not be committed.',
    '',
    '## Media group counts',
    '',
  ].filter((line) => line !== '')

  for (const [group, count] of Object.entries(stats.mediaGroupCounts || {})) lines.push(`- ${group}: ${count}`)

  lines.push('', '## Media type counts', '')
  for (const [type, count] of Object.entries(stats.mediaTypeCounts || {})) lines.push(`- ${type}: ${count}`)

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
  const audit = auditBangumiMediaWorkPackagePreview(pkg)

  await writeJson(output, audit)
  await writeText(report, createBangumiMediaWorkPackagePreviewAuditReport(audit, { inputPath: input, topLimit }))

  console.log(`Wrote Bangumi media work package preview audit -> ${output}`)
  console.log(`Wrote Bangumi media work package preview audit report -> ${report}`)
  console.log(`Audit status: ${audit.status}; errors: ${audit.errors.length}; warnings: ${audit.warnings.length}; infos: ${audit.infos.length}`)

  if (audit.status !== 'pass') process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
