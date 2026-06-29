#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  fetchBangumiSubject,
  normalizeBangumiKeywordMode,
  normalizeBangumiRetryCount,
  normalizeBangumiRetryDelayMs,
  normalizeBangumiStopAfterEmptyPages,
  searchBangumiTaggedSubjectCandidates,
} from './fetch-bangumi-tagged-subjects.mjs'

const DEFAULT_TAGS = ['百合', '轻百合', 'GL']
const DEFAULT_MEDIA = ['book', 'game']
const DEFAULT_LIMIT = 20
const DEFAULT_PAGES = 1
const DEFAULT_SORT = 'rank'
const DEFAULT_DELAY_MS = 900
const DEFAULT_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 1000
const DEFAULT_OUT = path.join('data_local', 'payload', 'bangumi-media-subject-preview.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-media-subject-preview.md')
const DEFAULT_USER_AGENT = 'BaihepaileiMediaPreview/0.1 (https://github.com/wtyliangtingRe/baihepailei)'
const REPORT_UTF8_BOM = '\uFEFF'

const BANGUMI_MEDIA_TYPES = new Map([
  ['book', 1],
  ['books', 1],
  ['manga', 1],
  ['novel', 1],
  ['lightnovel', 1],
  ['light-novel', 1],
  ['game', 4],
  ['games', 4],
])

const BANGUMI_TYPE_NAMES = new Map([
  [1, 'book'],
  [4, 'game'],
])

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

function parseCsv(value, fallback = []) {
  if (!value) return [...fallback]
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value

  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false

  return fallback
}

function parseNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function cleanText(value) {
  if (value === undefined || value === null) return ''
  return String(value).trim().replace(/\s+/gu, ' ')
}

function subjectId(subject) {
  const id = subject?.id ?? subject?.subject_id
  return id === undefined || id === null || id === '' ? '' : String(id)
}

function bangumiTypeName(type) {
  return BANGUMI_TYPE_NAMES.get(Number(type)) || `type-${type}`
}

export function parseBangumiMediaTypes({ media, types } = {}) {
  if (types) {
    return parseCsv(types)
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item))
  }

  const mediaItems = parseCsv(media, DEFAULT_MEDIA)
  const parsed = []

  for (const item of mediaItems) {
    const normalized = item.toLowerCase().replace(/[\s_]+/gu, '-')
    const type = BANGUMI_MEDIA_TYPES.get(normalized)
    if (type && !parsed.includes(type)) parsed.push(type)
  }

  return parsed.length > 0 ? parsed : DEFAULT_MEDIA.map((item) => BANGUMI_MEDIA_TYPES.get(item))
}

function normalizeBangumiTags(tags) {
  if (!Array.isArray(tags)) return []

  return tags
    .map((tag) => {
      if (typeof tag === 'string') return { name: cleanText(tag), count: null }
      return {
        name: cleanText(tag?.name),
        count: Number.isFinite(Number(tag?.count)) ? Number(tag.count) : null,
      }
    })
    .filter((tag) => tag.name)
    .slice(0, 30)
}

function infoboxValueToText(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return cleanText(value)

  if (Array.isArray(value)) {
    return value
      .map((item) => infoboxValueToText(item))
      .filter(Boolean)
      .join(' / ')
  }

  if (typeof value === 'object') {
    return cleanText(value.v || value.name || value.value || value.title || JSON.stringify(value))
  }

  return cleanText(value)
}

function normalizeInfobox(infobox) {
  if (!Array.isArray(infobox)) return []

  return infobox
    .map((item) => ({
      key: cleanText(item?.key || item?.name),
      value: infoboxValueToText(item?.value),
    }))
    .filter((item) => item.key || item.value)
}

function imageSummary(images) {
  if (!images || typeof images !== 'object') return { hasImages: false, available: [] }

  const available = ['large', 'common', 'medium', 'grid', 'small']
    .filter((key) => cleanText(images[key]))

  return {
    hasImages: available.length > 0,
    available,
    primary: available[0] || '',
  }
}

export function createBangumiMediaSubjectSummary(subject, { source = 'search', includeRaw = true } = {}) {
  const id = subjectId(subject)
  const type = Number(subject?.type)
  const summary = {
    id,
    bangumiSubjectId: id,
    type,
    typeName: bangumiTypeName(type),
    name: subject?.name || '',
    nameCn: subject?.name_cn || '',
    title: cleanText(subject?.name_cn || subject?.name),
    date: subject?.date || '',
    rank: subject?.rank ?? null,
    score: subject?.score ?? null,
    summary: cleanText(subject?.summary || '').slice(0, 600),
    images: imageSummary(subject?.images),
    tags: normalizeBangumiTags(subject?.tags),
    infobox: normalizeInfobox(subject?.infobox),
    source,
  }

  if (includeRaw) summary.raw = subject

  return summary
}

export function buildBangumiMediaSubjectPreview({
  searched = [],
  uniqueSubjects = [],
  searchBatches = [],
  detailedSubjects = [],
  failedSubjects = [],
  options = {},
} = {}) {
  const includeRaw = options.includeRaw !== false
  const subjects = detailedSubjects.map((subject) => createBangumiMediaSubjectSummary(subject, {
    source: options.fetchDetails === false ? 'search' : 'detail',
    includeRaw,
  }))

  return {
    meta: {
      source: 'bangumi-media-subject-preview',
      mode: 'preview-only-no-payload-write',
      generatedAt: options.generatedAt || new Date().toISOString(),
      tags: options.tags || DEFAULT_TAGS,
      media: options.media || DEFAULT_MEDIA,
      types: options.types || DEFAULT_MEDIA.map((item) => BANGUMI_MEDIA_TYPES.get(item)),
      typeNames: (options.types || []).map((type) => bangumiTypeName(type)),
      limit: options.limit ?? DEFAULT_LIMIT,
      pages: options.pages ?? DEFAULT_PAGES,
      sort: options.sort || DEFAULT_SORT,
      keywordMode: options.keywordMode || 'tag',
      stopAfterEmptyPages: options.stopAfterEmptyPages || 0,
      fetchDetails: options.fetchDetails !== false,
      includeRaw,
      searchedTotal: searched.length,
      uniqueSubjectsTotal: uniqueSubjects.length,
      subjectsTotal: subjects.length,
      failedSubjectsTotal: failedSubjects.length,
      safety: {
        payloadWrite: false,
        databaseWrite: false,
        worksPatch: false,
        mediaUpload: false,
      },
    },
    searchBatches,
    subjects,
    failedSubjects,
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchBangumiMediaSubjectPreview({
  tags = DEFAULT_TAGS,
  media = DEFAULT_MEDIA,
  types = parseBangumiMediaTypes({ media }),
  limit = DEFAULT_LIMIT,
  pages = DEFAULT_PAGES,
  sort = DEFAULT_SORT,
  keywordMode = 'tag',
  stopAfterEmptyPages = 0,
  delayMs = DEFAULT_DELAY_MS,
  retries = DEFAULT_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  fetchDetails = true,
  includeRaw = true,
  userAgent = DEFAULT_USER_AGENT,
  token = process.env.BANGUMI_ACCESS_TOKEN || '',
  proxy = process.env.BANGUMI_PROXY || '',
  generatedAt = new Date().toISOString(),
} = {}) {
  const { searched, uniqueSubjects, searchBatches } = await searchBangumiTaggedSubjectCandidates({
    tags,
    types,
    limit,
    pages,
    sort,
    keywordMode,
    stopAfterEmptyPages,
    delayMs,
    retries,
    retryDelayMs,
    userAgent,
    token,
    proxy,
  })

  const detailedSubjects = []
  const failedSubjects = []

  if (fetchDetails) {
    for (const subject of uniqueSubjects) {
      const id = subjectId(subject)
      if (!id) continue

      try {
        const detail = await fetchBangumiSubject(id, {
          userAgent,
          token,
          proxy,
          retries,
          retryDelayMs,
        })
        detailedSubjects.push(detail)
      } catch (error) {
        failedSubjects.push({
          ...createBangumiMediaSubjectSummary(subject, { source: 'search', includeRaw: false }),
          error: error?.message ? String(error.message).slice(0, 800) : String(error).slice(0, 800),
        })
      }

      if (delayMs > 0) await sleep(delayMs)
    }
  } else {
    detailedSubjects.push(...uniqueSubjects)
  }

  return buildBangumiMediaSubjectPreview({
    searched,
    uniqueSubjects,
    searchBatches,
    detailedSubjects,
    failedSubjects,
    options: {
      generatedAt,
      tags,
      media,
      types,
      limit,
      pages,
      sort,
      keywordMode,
      stopAfterEmptyPages,
      fetchDetails,
      includeRaw,
    },
  })
}

export function createBangumiMediaSubjectPreviewReport(preview, { topLimit = 80 } = {}) {
  const meta = preview?.meta || {}
  const lines = [
    '# Bangumi media subject preview',
    '',
    '## Summary',
    '',
    `- source: ${meta.source}`,
    `- mode: ${meta.mode}`,
    `- generatedAt: ${meta.generatedAt}`,
    `- tags: ${(meta.tags || []).join(', ')}`,
    `- media: ${(meta.media || []).join(', ')}`,
    `- types: ${(meta.types || []).join(', ')}`,
    `- searchedTotal: ${meta.searchedTotal}`,
    `- uniqueSubjectsTotal: ${meta.uniqueSubjectsTotal}`,
    `- subjectsTotal: ${meta.subjectsTotal}`,
    `- failedSubjectsTotal: ${meta.failedSubjectsTotal}`,
    '',
    '## Safety',
    '',
    '- Preview only.',
    '- No Payload connection.',
    '- No database writes.',
    '- No works patch.',
    '- No media upload.',
    '- Outputs should stay under data_local and must not be committed.',
    '',
    '## Sample subjects',
    '',
  ]

  for (const subject of (preview.subjects || []).slice(0, topLimit)) {
    lines.push(`- ${subject.typeName} #${subject.id}: ${subject.title || subject.name || subject.nameCn || '(untitled)'}`)
  }

  if ((preview.failedSubjects || []).length > 0) {
    lines.push('', '## Failed subjects', '')
    for (const subject of preview.failedSubjects.slice(0, topLimit)) {
      lines.push(`- #${subject.id}: ${subject.title || '(untitled)'} — ${subject.error || 'unknown error'}`)
    }
  }

  return `${REPORT_UTF8_BOM}${lines.join('\n')}\n`
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
  const tags = parseCsv(args.get('tags'), DEFAULT_TAGS)
  const media = parseCsv(args.get('media'), DEFAULT_MEDIA)
  const types = parseBangumiMediaTypes({ media, types: args.get('types') })
  const limit = parseNumber(args.get('limit'), DEFAULT_LIMIT)
  const pages = parseNumber(args.get('pages'), DEFAULT_PAGES)
  const sort = args.get('sort') || DEFAULT_SORT
  const keywordMode = normalizeBangumiKeywordMode(args.get('keyword-mode') || process.env.BANGUMI_KEYWORD_MODE || 'tag')
  const stopAfterEmptyPages = normalizeBangumiStopAfterEmptyPages(args.get('stop-after-empty-pages') || process.env.BANGUMI_STOP_AFTER_EMPTY_PAGES || 0)
  const delayMs = parseNumber(args.get('delay-ms'), DEFAULT_DELAY_MS)
  const retries = normalizeBangumiRetryCount(args.get('retries') || process.env.BANGUMI_RETRIES || DEFAULT_RETRIES)
  const retryDelayMs = normalizeBangumiRetryDelayMs(args.get('retry-delay-ms') || process.env.BANGUMI_RETRY_DELAY_MS || DEFAULT_RETRY_DELAY_MS)
  const fetchDetails = parseBoolean(args.get('fetch-details'), true)
  const includeRaw = parseBoolean(args.get('include-raw'), true)
  const out = args.get('out') || DEFAULT_OUT
  const report = args.get('report') || DEFAULT_REPORT
  const topLimit = parseNumber(args.get('top'), 80)
  const userAgent = args.get('user-agent') || process.env.BANGUMI_USER_AGENT || DEFAULT_USER_AGENT
  const token = args.get('token') || process.env.BANGUMI_ACCESS_TOKEN || ''
  const proxy = args.get('proxy') || process.env.BANGUMI_PROXY || ''

  const preview = await fetchBangumiMediaSubjectPreview({
    tags,
    media,
    types,
    limit,
    pages,
    sort,
    keywordMode,
    stopAfterEmptyPages,
    delayMs,
    retries,
    retryDelayMs,
    fetchDetails,
    includeRaw,
    userAgent,
    token,
    proxy,
  })

  await writeJson(out, preview)
  await writeText(report, createBangumiMediaSubjectPreviewReport(preview, { topLimit }))

  console.log(`Wrote Bangumi media subject preview -> ${out}`)
  console.log(`Wrote Bangumi media subject report -> ${report}`)
  console.log(`Preview subjects: ${preview.meta.subjectsTotal}; failed: ${preview.meta.failedSubjectsTotal}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
