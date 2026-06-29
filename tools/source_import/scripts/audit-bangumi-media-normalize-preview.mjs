#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_INPUT = path.join('data_local', 'normalized', 'bangumi-media-subjects.candidate-works.jsonl')
const DEFAULT_OUTPUT = path.join('data_local', 'reports', 'bangumi-media-normalize-preview-audit.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-media-normalize-preview-audit.md')
const DEFAULT_TOP_LIMIT = 100
const REPORT_UTF8_BOM = '\uFEFF'

const ALLOWED_MEDIA_TYPES = new Set(['manga', 'novel', 'light_novel', 'visual_novel', 'game'])
const ALLOWED_FORMATS = new Set(['manga_series', 'novel_series', 'light_novel_series', 'visual_novel', 'unknown'])
const ALLOWED_MEDIA_GROUPS = new Set(['book', 'game'])

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

function sumBy(items, keyFn) {
  return items.reduce((sum, item) => sum + Number(keyFn(item) || 0), 0)
}

function bangumiSubjectId(candidate) {
  return cleanText(candidate?.externalIds?.bangumiSubjectId || candidate?.candidateSources?.find((source) => source?.source === 'bangumi')?.externalId)
}

function hasBangumiSource(candidate) {
  return Array.isArray(candidate?.candidateSources)
    && candidate.candidateSources.some((source) => source?.source === 'bangumi' && cleanText(source?.externalId))
}

export function auditBangumiMediaNormalizePreview(candidates) {
  const errors = []
  const warnings = []
  const infos = []
  const rows = Array.isArray(candidates) ? candidates : []

  if (!Array.isArray(candidates)) {
    pushIssue(errors, 'candidates-not-array', 'Candidate input must be an array.')
  }

  if (rows.length === 0) {
    pushIssue(warnings, 'no-candidates', 'No candidate works found.')
  }

  const seenIds = new Map()
  let rowsWithCovers = 0
  let rowsWithCreatorHints = 0
  let rowsWithOrganizationHints = 0

  for (const [index, candidate] of rows.entries()) {
    const title = cleanText(candidate?.title)
    const slug = cleanText(candidate?.slug)
    const mediaType = cleanText(candidate?.mediaType)
    const mediaGroup = cleanText(candidate?.mediaGroup)
    const format = cleanText(candidate?.format)
    const subjectId = bangumiSubjectId(candidate)

    if (!title) pushIssue(errors, 'missing-title', 'Candidate is missing title.', { index })
    if (!slug) pushIssue(errors, 'missing-slug', 'Candidate is missing slug.', { index, title })

    if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
      pushIssue(errors, 'unexpected-media-type', 'Unexpected mediaType.', { index, title, mediaType })
    }

    if (!ALLOWED_FORMATS.has(format)) {
      pushIssue(errors, 'unexpected-format', 'Unexpected format.', { index, title, format })
    }

    if (!ALLOWED_MEDIA_GROUPS.has(mediaGroup)) {
      pushIssue(errors, 'unexpected-media-group', 'Unexpected mediaGroup.', { index, title, mediaGroup })
    }

    if (!subjectId) {
      pushIssue(errors, 'missing-bangumi-subject-id', 'Candidate is missing Bangumi subject id.', { index, title })
    } else if (seenIds.has(subjectId)) {
      pushIssue(errors, 'duplicate-bangumi-subject-id', 'Duplicate Bangumi subject id.', {
        id: subjectId,
        firstIndex: seenIds.get(subjectId),
        index,
      })
    } else {
      seenIds.set(subjectId, index)
    }

    if (!hasBangumiSource(candidate)) {
      pushIssue(errors, 'missing-bangumi-source', 'Candidate must include a Bangumi candidate source.', { index, title })
    }

    if (candidate?.siteId !== null && candidate?.siteId !== undefined) {
      pushIssue(errors, 'unexpected-site-id', 'Normalize preview candidates should not have a siteId yet.', { index, title })
    }

    if (candidate?.status !== 'draft') {
      pushIssue(errors, 'unexpected-status', 'Normalize preview candidates should stay draft.', { index, title, status: candidate?.status })
    }

    if (candidate?.isLiteVisible !== false || candidate?.isFullVisible !== false) {
      pushIssue(errors, 'unexpected-visibility', 'Normalize preview candidates should not be visible.', { index, title })
    }

    if (candidate?.hasEvidence !== false) {
      pushIssue(errors, 'unexpected-evidence-flag', 'Normalize preview candidates should not mark hasEvidence true.', { index, title })
    }

    if (Array.isArray(candidate?.externalCoverImages) && candidate.externalCoverImages.length > 0) rowsWithCovers += 1
    if (Array.isArray(candidate?.creatorCreditHints) && candidate.creatorCreditHints.length > 0) rowsWithCreatorHints += 1
    if (Array.isArray(candidate?.organizationCreditHints) && candidate.organizationCreditHints.length > 0) rowsWithOrganizationHints += 1
  }

  if (rows.length > 0 && rowsWithCovers === 0) {
    pushIssue(warnings, 'no-cover-refs', 'No candidates have external cover references.')
  }

  if (rows.length > 0 && rowsWithCreatorHints === 0) {
    pushIssue(infos, 'no-creator-hints', 'No candidates have creator credit hints.')
  }

  if (rows.length > 0 && rowsWithOrganizationHints === 0) {
    pushIssue(infos, 'no-organization-hints', 'No candidates have organization credit hints.')
  }

  return {
    source: 'bangumi-media-normalize-preview-audit',
    mode: 'audit-only-no-payload-write',
    generatedAt: new Date().toISOString(),
    status: errors.length === 0 ? 'pass' : 'fail',
    stats: {
      candidatesTotal: rows.length,
      uniqueBangumiSubjectIdsTotal: seenIds.size,
      rowsWithCovers,
      rowsWithCreatorHints,
      rowsWithOrganizationHints,
      mediaGroupCounts: countBy(rows, (candidate) => candidate.mediaGroup),
      mediaTypeCounts: countBy(rows, (candidate) => candidate.mediaType),
      formatCounts: countBy(rows, (candidate) => candidate.format),
      externalCoverImagesTotal: sumBy(rows, (candidate) => candidate.externalCoverImages?.length),
      localizedTitlesTotal: sumBy(rows, (candidate) => candidate.localizedTitles?.length),
      aliasesTotal: sumBy(rows, (candidate) => candidate.aliases?.length),
      creatorCreditHintsTotal: sumBy(rows, (candidate) => candidate.creatorCreditHints?.length),
      organizationCreditHintsTotal: sumBy(rows, (candidate) => candidate.organizationCreditHints?.length),
    },
    errors,
    warnings,
    infos,
  }
}

export function createBangumiMediaNormalizePreviewAuditReport(audit, { inputPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const stats = audit?.stats || {}
  const lines = [
    '# Bangumi media normalize preview audit',
    '',
    '## Summary',
    '',
    `- source: ${audit.source}`,
    `- mode: ${audit.mode}`,
    `- status: ${audit.status}`,
    `- generatedAt: ${audit.generatedAt}`,
    inputPath ? `- input: ${inputPath}` : '',
    `- candidatesTotal: ${stats.candidatesTotal}`,
    `- uniqueBangumiSubjectIdsTotal: ${stats.uniqueBangumiSubjectIdsTotal}`,
    `- rowsWithCovers: ${stats.rowsWithCovers}`,
    `- rowsWithCreatorHints: ${stats.rowsWithCreatorHints}`,
    `- rowsWithOrganizationHints: ${stats.rowsWithOrganizationHints}`,
    `- externalCoverImagesTotal: ${stats.externalCoverImagesTotal}`,
    `- localizedTitlesTotal: ${stats.localizedTitlesTotal}`,
    `- aliasesTotal: ${stats.aliasesTotal}`,
    `- creatorCreditHintsTotal: ${stats.creatorCreditHintsTotal}`,
    `- organizationCreditHintsTotal: ${stats.organizationCreditHintsTotal}`,
    `- errors: ${(audit.errors || []).length}`,
    `- warnings: ${(audit.warnings || []).length}`,
    `- infos: ${(audit.infos || []).length}`,
    '',
    '## Safety',
    '',
    '- Audit only.',
    '- No Payload connection.',
    '- No database writes.',
    '- No works patch.',
    '- No media upload.',
    '- Outputs should stay under data_local and must not be committed.',
    '',
    '## Media type counts',
    '',
  ].filter((line) => line !== '')

  for (const [key, value] of Object.entries(stats.mediaTypeCounts || {})) {
    lines.push(`- ${key}: ${value}`)
  }

  lines.push('', '## Format counts', '')
  for (const [key, value] of Object.entries(stats.formatCounts || {})) {
    lines.push(`- ${key}: ${value}`)
  }

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
    for (const item of items.slice(0, topLimit)) {
      lines.push(`- ${item.code}: ${item.message}`)
    }
    if (items.length > topLimit) lines.push(`- ... ${items.length - topLimit} more`)
  }

  return `${REPORT_UTF8_BOM}${lines.join('\n')}\n`
}

async function readJsonl(filePath) {
  const text = await readFile(filePath, 'utf8')
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
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

  const candidates = await readJsonl(input)
  const audit = auditBangumiMediaNormalizePreview(candidates)

  await writeJson(output, audit)
  await writeText(report, createBangumiMediaNormalizePreviewAuditReport(audit, { inputPath: input, topLimit }))

  console.log(`Wrote Bangumi media normalize preview audit -> ${output}`)
  console.log(`Wrote Bangumi media normalize preview audit report -> ${report}`)
  console.log(`Audit status: ${audit.status}; errors: ${audit.errors.length}; warnings: ${audit.warnings.length}; infos: ${audit.infos.length}`)

  if (audit.status !== 'pass') process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
