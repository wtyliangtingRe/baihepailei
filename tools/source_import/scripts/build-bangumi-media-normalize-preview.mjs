#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCandidateWork } from '../lib/source-record.mjs'
import {
  bangumiSubjectToCandidateInput,
  bangumiSubjectToRawSource,
} from '../sources/bangumi.mjs'

const DEFAULT_PREVIEW_INPUT = path.join('data_local', 'payload', 'bangumi-media-subject-preview.json')
const DEFAULT_AUDIT_INPUT = path.join('data_local', 'reports', 'bangumi-media-subject-preview-audit.json')
const DEFAULT_OUTPUT = path.join('data_local', 'normalized', 'bangumi-media-subjects.candidate-works.jsonl')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-media-subject-normalize-preview.md')
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

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value

  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false

  return fallback
}

function cleanText(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ')
}

function subjectId(subject) {
  const id = subject?.id ?? subject?.subject_id ?? subject?.bangumiSubjectId
  return id === undefined || id === null || id === '' ? '' : String(id)
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

function previewSubjectRaw(subject) {
  if (subject?.raw && typeof subject.raw === 'object') return subject.raw

  if (subject && typeof subject === 'object') {
    return {
      id: subject.bangumiSubjectId || subject.id,
      type: subject.type,
      name: subject.name,
      name_cn: subject.nameCn || subject.name_cn || subject.title,
      date: subject.date,
      summary: subject.summary,
      images: subject.rawImages || undefined,
      tags: subject.tags || [],
      infobox: subject.infobox || [],
    }
  }

  return null
}

function normalizePreviewSubject(subject, { fetchedAt } = {}) {
  const raw = previewSubjectRaw(subject)
  const id = subjectId(raw)
  if (!raw || !id) {
    return {
      candidate: null,
      skipped: {
        id: subjectId(subject),
        title: subject?.title || subject?.nameCn || subject?.name || '',
        reason: 'missing-raw-or-id',
      },
    }
  }

  const rawSource = bangumiSubjectToRawSource(raw, { fetchedAt })
  const candidateInput = bangumiSubjectToCandidateInput(raw)
  const candidate = createCandidateWork({
    ...candidateInput,
    candidateSources: candidateInput.candidateSources.map((source) => ({
      ...source,
      fetchedAt: rawSource.fetchedAt || null,
    })),
    sourceRecord: rawSource,
  })

  if (!candidate.title) {
    return {
      candidate: null,
      skipped: {
        id,
        title: subject?.title || raw?.name_cn || raw?.name || '',
        reason: 'missing-title',
      },
    }
  }

  return { candidate, skipped: null }
}

function assertPreviewReady(preview, audit, { requireAuditPass = true } = {}) {
  const errors = []
  const previewMeta = preview?.meta || {}

  if (previewMeta.source !== 'bangumi-media-subject-preview') {
    errors.push(`Preview source must be bangumi-media-subject-preview, got ${previewMeta.source || '(empty)'}.`)
  }

  if (previewMeta.mode !== 'preview-only-no-payload-write') {
    errors.push(`Preview mode must be preview-only-no-payload-write, got ${previewMeta.mode || '(empty)'}.`)
  }

  const safety = previewMeta.safety || {}
  for (const key of ['payloadWrite', 'databaseWrite', 'worksPatch', 'mediaUpload']) {
    if (safety[key] !== false) errors.push(`Preview safety flag ${key} must be false.`)
  }

  if (!Array.isArray(preview?.subjects)) {
    errors.push('Preview subjects must be an array.')
  }

  if (requireAuditPass) {
    if (!audit || typeof audit !== 'object') {
      errors.push('Preview audit JSON is required unless --require-audit-pass false is used.')
    } else if (audit.status !== 'pass') {
      errors.push(`Preview audit status must be pass, got ${audit.status || '(empty)'}.`)
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }
}

export function buildBangumiMediaNormalizePreview(preview, audit = null, {
  generatedAt = new Date().toISOString(),
  requireAuditPass = true,
} = {}) {
  assertPreviewReady(preview, audit, { requireAuditPass })

  const fetchedAt = preview?.meta?.generatedAt || generatedAt
  const candidates = []
  const skippedSubjects = []
  const seenIds = new Set()
  const duplicateSubjects = []

  for (const subject of preview.subjects || []) {
    const id = subjectId(subject)
    if (id && seenIds.has(id)) {
      duplicateSubjects.push({ id, title: subject?.title || subject?.nameCn || subject?.name || '' })
      continue
    }
    if (id) seenIds.add(id)

    const { candidate, skipped } = normalizePreviewSubject(subject, { fetchedAt })
    if (candidate) candidates.push(candidate)
    if (skipped) skippedSubjects.push(skipped)
  }

  const stats = {
    subjectsTotal: Array.isArray(preview?.subjects) ? preview.subjects.length : 0,
    candidatesTotal: candidates.length,
    skippedSubjectsTotal: skippedSubjects.length,
    duplicateSubjectsTotal: duplicateSubjects.length,
    mediaGroupCounts: countBy(candidates, (candidate) => candidate.mediaGroup),
    mediaTypeCounts: countBy(candidates, (candidate) => candidate.mediaType),
    formatCounts: countBy(candidates, (candidate) => candidate.format),
    externalCoverImagesTotal: sumBy(candidates, (candidate) => candidate.externalCoverImages?.length),
    localizedTitlesTotal: sumBy(candidates, (candidate) => candidate.localizedTitles?.length),
    creatorCreditHintsTotal: sumBy(candidates, (candidate) => candidate.creatorCreditHints?.length),
    organizationCreditHintsTotal: sumBy(candidates, (candidate) => candidate.organizationCreditHints?.length),
  }

  return {
    meta: {
      source: 'bangumi-media-normalize-preview',
      mode: 'normalize-preview-only-no-payload-write',
      generatedAt,
      input: {
        previewSource: preview?.meta?.source || '',
        previewGeneratedAt: preview?.meta?.generatedAt || '',
        auditSource: audit?.source || '',
        auditStatus: audit?.status || '',
      },
      safety: {
        payloadWrite: false,
        databaseWrite: false,
        worksPatch: false,
        mediaUpload: false,
      },
      stats,
    },
    candidates,
    skippedSubjects,
    duplicateSubjects,
  }
}

export function createBangumiMediaNormalizePreviewReport(result, { topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const meta = result?.meta || {}
  const stats = meta.stats || {}
  const lines = [
    '# Bangumi media normalize preview',
    '',
    '## Summary',
    '',
    `- source: ${meta.source}`,
    `- mode: ${meta.mode}`,
    `- generatedAt: ${meta.generatedAt}`,
    `- previewGeneratedAt: ${meta.input?.previewGeneratedAt || ''}`,
    `- auditStatus: ${meta.input?.auditStatus || ''}`,
    `- subjectsTotal: ${stats.subjectsTotal}`,
    `- candidatesTotal: ${stats.candidatesTotal}`,
    `- skippedSubjectsTotal: ${stats.skippedSubjectsTotal}`,
    `- duplicateSubjectsTotal: ${stats.duplicateSubjectsTotal}`,
    `- externalCoverImagesTotal: ${stats.externalCoverImagesTotal}`,
    `- localizedTitlesTotal: ${stats.localizedTitlesTotal}`,
    `- creatorCreditHintsTotal: ${stats.creatorCreditHintsTotal}`,
    `- organizationCreditHintsTotal: ${stats.organizationCreditHintsTotal}`,
    '',
    '## Safety',
    '',
    '- Normalize preview only.',
    '- No Payload connection.',
    '- No database writes.',
    '- No works patch.',
    '- No media upload.',
    '- Outputs should stay under data_local and must not be committed.',
    '',
    '## Media type counts',
    '',
  ]

  for (const [key, value] of Object.entries(stats.mediaTypeCounts || {})) {
    lines.push(`- ${key}: ${value}`)
  }

  lines.push('', '## Format counts', '')
  for (const [key, value] of Object.entries(stats.formatCounts || {})) {
    lines.push(`- ${key}: ${value}`)
  }

  lines.push('', '## Sample candidates', '')
  for (const candidate of (result.candidates || []).slice(0, topLimit)) {
    lines.push(`- ${candidate.mediaType}/${candidate.format}: ${candidate.title} (${candidate.externalIds?.bangumiSubjectId || 'no-id'})`)
  }

  if ((result.skippedSubjects || []).length > 0) {
    lines.push('', '## Skipped subjects', '')
    for (const skipped of result.skippedSubjects.slice(0, topLimit)) {
      lines.push(`- #${skipped.id || 'no-id'} ${skipped.title || '(untitled)'} — ${skipped.reason}`)
    }
  }

  if ((result.duplicateSubjects || []).length > 0) {
    lines.push('', '## Duplicate subjects', '')
    for (const duplicate of result.duplicateSubjects.slice(0, topLimit)) {
      lines.push(`- #${duplicate.id}: ${duplicate.title || '(untitled)'}`)
    }
  }

  return `${REPORT_UTF8_BOM}${lines.join('\n')}\n`
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function writeJsonl(filePath, rows) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, value, 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const previewInput = args.get('in') || args.get('preview') || DEFAULT_PREVIEW_INPUT
  const auditInput = args.get('audit') || DEFAULT_AUDIT_INPUT
  const output = args.get('out') || DEFAULT_OUTPUT
  const report = args.get('report') || DEFAULT_REPORT
  const topLimit = Number(args.get('top') || DEFAULT_TOP_LIMIT)
  const requireAuditPass = parseBoolean(args.get('require-audit-pass'), true)

  const preview = await readJson(previewInput)
  const audit = await readJsonIfExists(auditInput)
  const result = buildBangumiMediaNormalizePreview(preview, audit, { requireAuditPass })

  await writeJsonl(output, result.candidates)
  await writeText(report, createBangumiMediaNormalizePreviewReport(result, { topLimit }))

  console.log(`Wrote Bangumi media normalize preview candidates -> ${output}`)
  console.log(`Wrote Bangumi media normalize preview report -> ${report}`)
  console.log(`Candidates: ${result.meta.stats.candidatesTotal}; skipped: ${result.meta.stats.skippedSubjectsTotal}; duplicates: ${result.meta.stats.duplicateSubjectsTotal}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
