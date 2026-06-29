#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_INPUT = path.join('data_local', 'payload', 'bangumi-media-subject-preview.json')
const DEFAULT_OUTPUT = path.join('data_local', 'reports', 'bangumi-media-subject-preview-audit.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-media-subject-preview-audit.md')
const DEFAULT_TOP_LIMIT = 100
const REPORT_UTF8_BOM = '\uFEFF'
const ALLOWED_TYPES = new Set([1, 4])
const ALLOWED_TYPE_NAMES = new Set(['book', 'game'])

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
  if (value === undefined || value === null) return ''
  return String(value).trim().replace(/\s+/gu, ' ')
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function pushIssue(list, code, message, extra = {}) {
  list.push({ code, message, ...extra })
}

function countBy(items, keyFn) {
  const counts = new Map()
  for (const item of items) {
    const key = keyFn(item)
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}

export function auditBangumiMediaSubjectPreview(preview) {
  const errors = []
  const warnings = []
  const infos = []
  const meta = preview?.meta || {}
  const subjects = Array.isArray(preview?.subjects) ? preview.subjects : []
  const failedSubjects = Array.isArray(preview?.failedSubjects) ? preview.failedSubjects : []
  const searchBatches = Array.isArray(preview?.searchBatches) ? preview.searchBatches : []

  if (!preview || typeof preview !== 'object') {
    pushIssue(errors, 'preview-not-object', 'Preview JSON must be an object.')
  }

  if (meta.source !== 'bangumi-media-subject-preview') {
    pushIssue(errors, 'unexpected-source', 'Preview source must be bangumi-media-subject-preview.', { value: meta.source })
  }

  if (meta.mode !== 'preview-only-no-payload-write') {
    pushIssue(errors, 'unexpected-mode', 'Preview mode must be preview-only-no-payload-write.', { value: meta.mode })
  }

  const safety = meta.safety || {}
  for (const key of ['payloadWrite', 'databaseWrite', 'worksPatch', 'mediaUpload']) {
    if (safety[key] !== false) {
      pushIssue(errors, 'unsafe-flag', `Safety flag ${key} must be false.`, { key, value: safety[key] })
    }
  }

  if (!Array.isArray(preview?.subjects)) {
    pushIssue(errors, 'subjects-not-array', 'Preview subjects must be an array.')
  }

  if (numberOrNull(meta.subjectsTotal) !== subjects.length) {
    pushIssue(errors, 'subjects-total-mismatch', 'meta.subjectsTotal must equal subjects.length.', {
      metaSubjectsTotal: meta.subjectsTotal,
      actual: subjects.length,
    })
  }

  if (numberOrNull(meta.failedSubjectsTotal) !== failedSubjects.length) {
    pushIssue(errors, 'failed-total-mismatch', 'meta.failedSubjectsTotal must equal failedSubjects.length.', {
      metaFailedSubjectsTotal: meta.failedSubjectsTotal,
      actual: failedSubjects.length,
    })
  }

  if (failedSubjects.length > 0) {
    pushIssue(warnings, 'failed-subjects-present', 'Preview has failed subjects; inspect failedSubjects before normalization.', {
      count: failedSubjects.length,
    })
  }

  if (subjects.length === 0) {
    pushIssue(warnings, 'no-subjects', 'Preview contains no subjects.')
  }

  const seenIds = new Map()
  const typeCounts = {}
  const transportCounts = countBy([meta], (item) => cleanText(item.searchTransport || item.requestedTransport))
  let rawSubjectsTotal = 0
  let subjectsWithImages = 0
  let subjectsWithTags = 0
  let subjectsWithInfobox = 0
  let missingTitleTotal = 0
  let missingRawTotal = 0

  for (const [index, subject] of subjects.entries()) {
    const id = cleanText(subject?.bangumiSubjectId || subject?.id)
    const type = numberOrNull(subject?.type)
    const typeName = cleanText(subject?.typeName)
    const title = cleanText(subject?.title || subject?.nameCn || subject?.name)

    if (!id) {
      pushIssue(errors, 'missing-subject-id', 'Subject is missing bangumiSubjectId/id.', { index })
    } else if (seenIds.has(id)) {
      pushIssue(errors, 'duplicate-subject-id', 'Duplicate Bangumi subject id in preview subjects.', {
        id,
        firstIndex: seenIds.get(id),
        index,
      })
    } else {
      seenIds.set(id, index)
    }

    if (!ALLOWED_TYPES.has(type)) {
      pushIssue(errors, 'unexpected-subject-type', 'Subject type must be Bangumi book(1) or game(4).', { id, type, index })
    }

    if (!ALLOWED_TYPE_NAMES.has(typeName)) {
      pushIssue(errors, 'unexpected-type-name', 'Subject typeName must be book or game.', { id, typeName, index })
    }

    if (!title) {
      missingTitleTotal += 1
      pushIssue(warnings, 'missing-title', 'Subject has no title/name.', { id, index })
    }

    typeCounts[typeName || `type-${type}`] = (typeCounts[typeName || `type-${type}`] || 0) + 1

    if (subject?.raw && typeof subject.raw === 'object') {
      rawSubjectsTotal += 1
    } else {
      missingRawTotal += 1
    }

    if (subject?.images?.hasImages) subjectsWithImages += 1
    if (Array.isArray(subject?.tags) && subject.tags.length > 0) subjectsWithTags += 1
    if (Array.isArray(subject?.infobox) && subject.infobox.length > 0) subjectsWithInfobox += 1
  }

  if (subjects.length > 0 && missingRawTotal === subjects.length) {
    pushIssue(warnings, 'no-raw-subjects', 'Preview subjects have no raw details; later normalization may need --include-raw true and --fetch-details true.')
  } else if (missingRawTotal > 0) {
    pushIssue(warnings, 'some-raw-subjects-missing', 'Some preview subjects have no raw details.', { count: missingRawTotal })
  }

  if (subjects.length > 0 && subjectsWithInfobox === 0) {
    pushIssue(infos, 'no-infobox-data', 'No subjects include infobox entries; relationship extraction may be limited.')
  }

  if (subjects.length > 0 && subjectsWithTags === 0) {
    pushIssue(infos, 'no-tag-data', 'No subjects include tags.')
  }

  if (subjects.length > 0 && subjectsWithImages === 0) {
    pushIssue(infos, 'no-image-data', 'No subjects include image metadata.')
  }

  return {
    source: 'bangumi-media-subject-preview-audit',
    mode: 'audit-only-no-payload-write',
    generatedAt: new Date().toISOString(),
    status: errors.length === 0 ? 'pass' : 'fail',
    input: {
      source: meta.source,
      mode: meta.mode,
      generatedAt: meta.generatedAt,
      tags: meta.tags || [],
      media: meta.media || [],
      types: meta.types || [],
      fetchDetails: meta.fetchDetails,
      includeRaw: meta.includeRaw,
      requestedTransport: meta.requestedTransport,
      searchTransport: meta.searchTransport,
      detailTransport: meta.detailTransport,
    },
    stats: {
      subjectsTotal: subjects.length,
      failedSubjectsTotal: failedSubjects.length,
      searchBatchesTotal: searchBatches.length,
      rawSubjectsTotal,
      missingRawTotal,
      subjectsWithImages,
      subjectsWithTags,
      subjectsWithInfobox,
      missingTitleTotal,
      typeCounts,
      transportCounts,
    },
    errors,
    warnings,
    infos,
  }
}

export function createBangumiMediaSubjectPreviewAuditReport(audit, { inputPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const stats = audit?.stats || {}
  const lines = [
    '# Bangumi media subject preview audit',
    '',
    '## Summary',
    '',
    `- source: ${audit.source}`,
    `- mode: ${audit.mode}`,
    `- status: ${audit.status}`,
    `- generatedAt: ${audit.generatedAt}`,
    inputPath ? `- input: ${inputPath}` : '',
    `- subjectsTotal: ${stats.subjectsTotal}`,
    `- failedSubjectsTotal: ${stats.failedSubjectsTotal}`,
    `- rawSubjectsTotal: ${stats.rawSubjectsTotal}`,
    `- missingRawTotal: ${stats.missingRawTotal}`,
    `- subjectsWithImages: ${stats.subjectsWithImages}`,
    `- subjectsWithTags: ${stats.subjectsWithTags}`,
    `- subjectsWithInfobox: ${stats.subjectsWithInfobox}`,
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
    '## Type counts',
    '',
  ].filter((line) => line !== '')

  const typeCounts = stats.typeCounts || {}
  for (const [key, value] of Object.entries(typeCounts)) {
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
  const audit = auditBangumiMediaSubjectPreview(preview)

  await writeJson(output, audit)
  await writeText(report, createBangumiMediaSubjectPreviewAuditReport(audit, { inputPath: input, topLimit }))

  console.log(`Wrote Bangumi media subject preview audit -> ${output}`)
  console.log(`Wrote Bangumi media subject preview audit report -> ${report}`)
  console.log(`Audit status: ${audit.status}; errors: ${audit.errors.length}; warnings: ${audit.warnings.length}; infos: ${audit.infos.length}`)

  if (audit.status !== 'pass') process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
