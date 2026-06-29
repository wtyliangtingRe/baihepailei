#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  fetchBangumiSubject,
  normalizeBangumiKeywordMode,
  normalizeBangumiRetryCount,
  normalizeBangumiRetryDelayMs,
  normalizeBangumiStopAfterEmptyPages,
  searchBangumiTaggedSubjectCandidates,
} from './fetch-bangumi-tagged-subjects.mjs'

const API_BASE_URL = 'https://api.bgm.tv'
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
const DEFAULT_TRANSPORT = 'auto'
const REPORT_UTF8_BOM = '\uFEFF'
const POWERSHELL_MAX_BUFFER_BYTES = 20 * 1024 * 1024

const execFileAsync = promisify(execFile)

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

const TRANSPORTS = new Set(['auto', 'node', 'powershell'])

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
  const text = String(value).trim()
  if (!text) return [...fallback]
  const separator = text.includes(',') ? /,/u : /\s+/u

  return text
    .split(separator)
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

function normalizeTransport(value, fallback = DEFAULT_TRANSPORT) {
  const normalized = String(value || '').trim().toLowerCase()
  return TRANSPORTS.has(normalized) ? normalized : fallback
}

function uniqueById(subjects) {
  const seen = new Set()
  const result = []

  for (const subject of subjects) {
    const id = subjectId(subject)
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(subject)
  }

  return result
}

function nextEmptyPageStreak(returned, currentStreak = 0) {
  return Number(returned) > 0 ? 0 : currentStreak + 1
}

function shouldStopAfterEmptyPages({ emptyPageStreak, stopAfterEmptyPages }) {
  const threshold = normalizeBangumiStopAfterEmptyPages(stopAfterEmptyPages)
  return threshold > 0 && emptyPageStreak >= threshold
}

function requestHeaders({ userAgent, token }) {
  return {
    'User-Agent': userAgent,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function createSearchBody({ tag, type, sort, keywordMode }) {
  const normalizedKeywordMode = normalizeBangumiKeywordMode(keywordMode)
  const body = {
    sort,
    filter: {
      tag: [tag],
      type: [type],
    },
  }

  if (normalizedKeywordMode === 'tag') {
    body.keyword = tag
  } else if (normalizedKeywordMode === 'empty') {
    body.keyword = ''
  }

  return body
}

function searchBatchSummary({
  tag,
  type,
  page,
  offset,
  limit,
  sort,
  keywordMode,
  subjects,
  emptyPageStreak = 0,
  stoppedAfterThisBatch = false,
}) {
  return {
    tag,
    type,
    page,
    offset,
    limit,
    sort,
    keywordMode,
    returned: subjects.length,
    emptyPageStreak,
    stoppedAfterThisBatch,
    subjectIds: subjects.map(subjectId).filter(Boolean),
  }
}

async function requestJsonWithPowerShell(url, { method = 'GET', headers = {}, body } = {}) {
  const request = {
    url: String(url),
    method,
    headers,
    body: body || '',
  }
  const encodedRequest = Buffer.from(JSON.stringify(request), 'utf8').toString('base64')
  const script = `
$ErrorActionPreference = "Stop"
$payload = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:BGM_PREVIEW_REQUEST))
$request = $payload | ConvertFrom-Json
$headers = @{}
if ($null -ne $request.headers) {
  foreach ($property in $request.headers.PSObject.Properties) {
    if ($null -ne $property.Value -and [string]$property.Value -ne "") {
      $headers[$property.Name] = [string]$property.Value
    }
  }
}
$params = @{
  Uri = [string]$request.url
  Method = [string]$request.method
  Headers = $headers
}
if ($request.body) {
  $params.Body = [string]$request.body
  $params.ContentType = "application/json"
}
$response = Invoke-RestMethod @params
$response | ConvertTo-Json -Depth 80
`.trim()

  const env = {
    ...process.env,
    BGM_PREVIEW_REQUEST: encodedRequest,
  }

  try {
    const { stdout } = await execFileAsync('pwsh', ['-NoProfile', '-Command', script], {
      env,
      maxBuffer: POWERSHELL_MAX_BUFFER_BYTES,
      windowsHide: true,
    })
    return JSON.parse(stdout)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error

    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      env,
      maxBuffer: POWERSHELL_MAX_BUFFER_BYTES,
      windowsHide: true,
    })
    return JSON.parse(stdout)
  }
}

async function requestJsonWithPowerShellRetries(url, options, { retries = DEFAULT_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS } = {}) {
  const normalizedRetries = normalizeBangumiRetryCount(retries)
  const normalizedRetryDelayMs = normalizeBangumiRetryDelayMs(retryDelayMs)

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestJsonWithPowerShell(url, options)
    } catch (error) {
      if (attempt >= normalizedRetries) throw error
      await sleep(normalizedRetryDelayMs)
    }
  }
}

async function searchBangumiSubjectsWithPowerShell({
  tag,
  type,
  limit,
  offset,
  sort,
  keywordMode,
  userAgent,
  token,
  retries,
  retryDelayMs,
}) {
  const url = new URL('/v0/search/subjects', API_BASE_URL)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('offset', String(offset))

  const json = await requestJsonWithPowerShellRetries(
    url,
    {
      method: 'POST',
      headers: requestHeaders({ userAgent, token }),
      body: JSON.stringify(createSearchBody({ tag, type, sort, keywordMode })),
    },
    { retries, retryDelayMs },
  )

  return Array.isArray(json?.data) ? json.data : []
}

async function searchBangumiTaggedSubjectCandidatesWithPowerShell({
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
}) {
  const searched = []
  const searchBatches = []
  const normalizedStopAfterEmptyPages = normalizeBangumiStopAfterEmptyPages(stopAfterEmptyPages)

  for (const tag of tags) {
    for (const type of types) {
      let emptyPageStreak = 0

      for (let page = 0; page < pages; page += 1) {
        const offset = page * limit
        const subjects = await searchBangumiSubjectsWithPowerShell({
          tag,
          type,
          limit,
          offset,
          sort,
          keywordMode,
          userAgent,
          token,
          retries,
          retryDelayMs,
        })
        emptyPageStreak = nextEmptyPageStreak(subjects.length, emptyPageStreak)
        const stoppedAfterThisBatch = shouldStopAfterEmptyPages({
          emptyPageStreak,
          stopAfterEmptyPages: normalizedStopAfterEmptyPages,
        })

        searched.push(...subjects)
        searchBatches.push(searchBatchSummary({
          tag,
          type,
          page,
          offset,
          limit,
          sort,
          keywordMode,
          subjects,
          emptyPageStreak,
          stoppedAfterThisBatch,
        }))

        if (stoppedAfterThisBatch) break
        if (delayMs > 0) await sleep(delayMs)
      }
    }
  }

  return {
    searched,
    uniqueSubjects: uniqueById(searched),
    searchBatches,
  }
}

async function fetchBangumiSubjectWithPowerShell(subjectId, {
  userAgent,
  token,
  retries,
  retryDelayMs,
}) {
  const url = new URL(`/v0/subjects/${subjectId}`, API_BASE_URL)
  return requestJsonWithPowerShellRetries(
    url,
    {
      method: 'GET',
      headers: requestHeaders({ userAgent, token }),
    },
    { retries, retryDelayMs },
  )
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
      requestedTransport: options.transport || DEFAULT_TRANSPORT,
      searchTransport: options.searchTransport || options.transport || DEFAULT_TRANSPORT,
      detailTransport: options.detailTransport || options.searchTransport || options.transport || DEFAULT_TRANSPORT,
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

async function searchWithTransport(options) {
  const transport = normalizeTransport(options.transport)

  if (transport === 'powershell') {
    return {
      ...(await searchBangumiTaggedSubjectCandidatesWithPowerShell(options)),
      transportUsed: 'powershell',
    }
  }

  try {
    return {
      ...(await searchBangumiTaggedSubjectCandidates(options)),
      transportUsed: 'node',
    }
  } catch (error) {
    if (transport !== 'auto') throw error
    return {
      ...(await searchBangumiTaggedSubjectCandidatesWithPowerShell(options)),
      transportUsed: 'powershell',
    }
  }
}

async function fetchSubjectWithTransport(subjectIdValue, options) {
  const transport = normalizeTransport(options.transport)

  if (transport === 'powershell') {
    return {
      subject: await fetchBangumiSubjectWithPowerShell(subjectIdValue, options),
      transportUsed: 'powershell',
    }
  }

  try {
    return {
      subject: await fetchBangumiSubject(subjectIdValue, options),
      transportUsed: 'node',
    }
  } catch (error) {
    if (transport !== 'auto') throw error
    return {
      subject: await fetchBangumiSubjectWithPowerShell(subjectIdValue, options),
      transportUsed: 'powershell',
    }
  }
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
  transport = DEFAULT_TRANSPORT,
  userAgent = DEFAULT_USER_AGENT,
  token = process.env.BANGUMI_ACCESS_TOKEN || '',
  proxy = process.env.BANGUMI_PROXY || '',
  generatedAt = new Date().toISOString(),
} = {}) {
  const searchResult = await searchWithTransport({
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
    transport,
  })
  const { searched, uniqueSubjects, searchBatches } = searchResult
  const detailedSubjects = []
  const failedSubjects = []
  const detailTransports = new Set()

  if (fetchDetails) {
    for (const subject of uniqueSubjects) {
      const id = subjectId(subject)
      if (!id) continue

      try {
        const detailTransport = transport === 'auto' && searchResult.transportUsed === 'powershell'
          ? 'powershell'
          : transport
        const detail = await fetchSubjectWithTransport(id, {
          userAgent,
          token,
          proxy,
          retries,
          retryDelayMs,
          transport: detailTransport,
        })
        detailTransports.add(detail.transportUsed)
        detailedSubjects.push(detail.subject)
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
    detailTransports.add('not-used')
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
      transport,
      searchTransport: searchResult.transportUsed,
      detailTransport: [...detailTransports].join(',') || 'not-used',
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
    `- requestedTransport: ${meta.requestedTransport || ''}`,
    `- searchTransport: ${meta.searchTransport || ''}`,
    `- detailTransport: ${meta.detailTransport || ''}`,
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
  const transport = normalizeTransport(args.get('transport') || process.env.BANGUMI_TRANSPORT || DEFAULT_TRANSPORT)
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
    transport,
    userAgent,
    token,
    proxy,
  })

  await writeJson(out, preview)
  await writeText(report, createBangumiMediaSubjectPreviewReport(preview, { topLimit }))

  console.log(`Wrote Bangumi media subject preview -> ${out}`)
  console.log(`Wrote Bangumi media subject report -> ${report}`)
  console.log(`Preview subjects: ${preview.meta.subjectsTotal}; failed: ${preview.meta.failedSubjectsTotal}`)
  console.log(`Transport: requested=${preview.meta.requestedTransport}; search=${preview.meta.searchTransport}; detail=${preview.meta.detailTransport}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
