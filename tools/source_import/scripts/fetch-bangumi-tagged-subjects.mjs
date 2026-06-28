#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { readJsonl, writeJsonl, writeJsonFile } from '../lib/jsonl.mjs'
import {
  annotateBangumiYuriSignal,
  bangumiSubjectToRawSource,
  subjectPassesYuriTagThreshold,
} from '../sources/bangumi.mjs'

const API_BASE_URL = 'https://api.bgm.tv'
const DEFAULT_TAGS = ['百合', '轻百合', 'GL']
const DEFAULT_TYPES = [1, 2, 4]
const DEFAULT_USER_AGENT = 'BaihepaileiSourceImport/0.1 (https://github.com/wtyliangtingRe/baihepailei)'
const DEFAULT_CURL_CONNECT_TIMEOUT_SECONDS = 30
const CURL_MAX_BUFFER_BYTES = 20 * 1024 * 1024
const DEFAULT_KEYWORD_MODE = 'tag'
const KEYWORD_MODES = new Set(['tag', 'empty', 'none'])

const execFileAsync = promisify(execFile)

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

function parseCsv(value, fallback) {
  if (!value) return fallback
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseNumberCsv(value, fallback) {
  return parseCsv(value, fallback.map(String))
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value

  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false

  return fallback
}

export function normalizeBangumiKeywordMode(value, fallback = DEFAULT_KEYWORD_MODE) {
  const normalized = String(value || '').trim().toLowerCase()
  return KEYWORD_MODES.has(normalized) ? normalized : fallback
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function uniqueById(subjects) {
  const seen = new Set()
  const result = []

  for (const subject of subjects) {
    const id = subject?.id ?? subject?.subject_id
    if (!id || seen.has(String(id))) continue

    seen.add(String(id))
    result.push(subject)
  }

  return result
}

function subjectId(subject) {
  const id = subject?.id ?? subject?.subject_id
  return id === undefined || id === null || id === '' ? '' : String(id)
}

export function bangumiRawSourceRecordSubjectId(record) {
  if (record?.source && record.source !== 'bangumi') return ''

  const id = record?.sourceRecordId ?? record?.raw?.id ?? record?.raw?.subject_id
  return id === undefined || id === null || id === '' ? '' : String(id)
}

function bangumiRawSourceRecordSummary(record) {
  const raw = record?.raw || {}
  return {
    id: bangumiRawSourceRecordSubjectId(record),
    name: raw.name,
    name_cn: raw.name_cn,
    type: raw.type,
    date: raw.date,
    yuriTagSignal: raw._baihepailei?.yuriTagSignal,
  }
}

function bangumiSearchSubjectSummary(subject) {
  return {
    id: subjectId(subject),
    name: subject?.name,
    name_cn: subject?.name_cn,
    type: subject?.type,
    date: subject?.date,
  }
}

function bangumiSearchBatchSummary({ tag, type, page, offset, limit, sort, keywordMode, subjects }) {
  return {
    tag,
    type,
    page,
    offset,
    limit,
    sort,
    keywordMode,
    returned: subjects.length,
    subjectIds: subjects.map(subjectId).filter(Boolean),
  }
}

export function existingBangumiSubjectIds(records) {
  return new Set(records.map(bangumiRawSourceRecordSubjectId).filter(Boolean))
}

export async function readBangumiResumeState(output) {
  try {
    const records = await readJsonl(output)
    return {
      records,
      ids: existingBangumiSubjectIds(records),
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        records: [],
        ids: new Set(),
      }
    }

    throw error
  }
}

async function appendJsonlRecord(filePath, record) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8')
}

function requestHeaders({ userAgent, token }) {
  return {
    'User-Agent': userAgent,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export function createCurlJsonArgs(
  url,
  { method = 'GET', headers = {}, body } = {},
  { proxy = '', connectTimeoutSeconds = DEFAULT_CURL_CONNECT_TIMEOUT_SECONDS } = {},
) {
  const args = [
    '--silent',
    '--show-error',
    '--fail',
    '--location',
    '--connect-timeout',
    String(connectTimeoutSeconds),
    '--request',
    method,
  ]

  if (proxy) {
    args.push('--proxy', proxy)
  }

  for (const [key, value] of Object.entries(headers || {})) {
    if (value === undefined || value === null || value === '') continue
    args.push('--header', `${key}: ${value}`)
  }

  if (body !== undefined) {
    args.push('--data-binary', body)
  }

  args.push(String(url))
  return args
}

function formatCurlError(error) {
  const message = error?.message ? String(error.message) : String(error)
  const stderr = error?.stderr ? String(error.stderr).trim().slice(0, 800) : ''
  const stdout = error?.stdout ? String(error.stdout).trim().slice(0, 800) : ''
  return [message, stderr, stdout].filter(Boolean).join('\n')
}

async function requestJsonWithCurl(url, options, { proxy }) {
  const args = createCurlJsonArgs(url, options, { proxy })

  try {
    const { stdout } = await execFileAsync('curl', args, {
      maxBuffer: CURL_MAX_BUFFER_BYTES,
      windowsHide: true,
    })
    return JSON.parse(stdout)
  } catch (error) {
    throw new Error(`Bangumi curl request failed:\n${formatCurlError(error)}`)
  }
}

async function requestJson(url, options, { proxy = '' } = {}) {
  if (proxy) {
    return requestJsonWithCurl(url, options, { proxy })
  }

  const response = await fetch(url, options)

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Bangumi request failed ${response.status} ${response.statusText}: ${text.slice(0, 300)}`)
  }

  return response.json()
}

export function createBangumiSearchRequestBody({ tag, type, sort, keywordMode = DEFAULT_KEYWORD_MODE }) {
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

export async function searchBangumiSubjects({ tag, type, limit, offset, sort, keywordMode = DEFAULT_KEYWORD_MODE, userAgent, token, proxy }) {
  const url = new URL('/v0/search/subjects', API_BASE_URL)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('offset', String(offset))

  const body = createBangumiSearchRequestBody({ tag, type, sort, keywordMode })

  const json = await requestJson(
    url,
    {
      method: 'POST',
      headers: requestHeaders({ userAgent, token }),
      body: JSON.stringify(body),
    },
    { proxy },
  )

  return Array.isArray(json?.data) ? json.data : []
}

export async function fetchBangumiSubject(subjectId, { userAgent, token, proxy }) {
  const url = new URL(`/v0/subjects/${subjectId}`, API_BASE_URL)
  return requestJson(
    url,
    {
      method: 'GET',
      headers: requestHeaders({ userAgent, token }),
    },
    { proxy },
  )
}

export async function searchBangumiTaggedSubjectCandidates({
  tags = DEFAULT_TAGS,
  types = DEFAULT_TYPES,
  limit = 20,
  pages = 1,
  sort = 'rank',
  keywordMode = DEFAULT_KEYWORD_MODE,
  delayMs = 900,
  userAgent = DEFAULT_USER_AGENT,
  token = process.env.BANGUMI_ACCESS_TOKEN || '',
  proxy = process.env.BANGUMI_PROXY || '',
} = {}) {
  const normalizedKeywordMode = normalizeBangumiKeywordMode(keywordMode)
  const searched = []
  const searchBatches = []

  for (const tag of tags) {
    for (const type of types) {
      for (let page = 0; page < pages; page += 1) {
        const offset = page * limit
        const subjects = await searchBangumiSubjects({ tag, type, limit, offset, sort, keywordMode: normalizedKeywordMode, userAgent, token, proxy })
        searched.push(...subjects)
        searchBatches.push(bangumiSearchBatchSummary({ tag, type, page, offset, limit, sort, keywordMode: normalizedKeywordMode, subjects }))
        await sleep(delayMs)
      }
    }
  }

  return {
    searched,
    uniqueSubjects: uniqueById(searched),
    searchBatches,
  }
}

export async function fetchBangumiTaggedSubjects({
  tags = DEFAULT_TAGS,
  types = DEFAULT_TYPES,
  limit = 20,
  pages = 1,
  sort = 'rank',
  keywordMode = DEFAULT_KEYWORD_MODE,
  delayMs = 900,
  minWeightedScore = 5,
  minTopTagCount = 5,
  userAgent = DEFAULT_USER_AGENT,
  token = process.env.BANGUMI_ACCESS_TOKEN || '',
  proxy = process.env.BANGUMI_PROXY || '',
} = {}) {
  const { uniqueSubjects } = await searchBangumiTaggedSubjectCandidates({
    tags,
    types,
    limit,
    pages,
    sort,
    keywordMode,
    delayMs,
    userAgent,
    token,
    proxy,
  })

  const detailed = []

  for (const subject of uniqueSubjects) {
    const id = subject?.id ?? subject?.subject_id
    const detail = await fetchBangumiSubject(id, { userAgent, token, proxy })
    const annotated = annotateBangumiYuriSignal(detail)

    if (subjectPassesYuriTagThreshold(annotated, { minWeightedScore, minTopTagCount })) {
      detailed.push(annotated)
    }

    await sleep(delayMs)
  }

  detailed.sort((a, b) => {
    const aSignal = a?._baihepailei?.yuriTagSignal
    const bSignal = b?._baihepailei?.yuriTagSignal
    return (bSignal?.weightedScore || 0) - (aSignal?.weightedScore || 0)
  })

  return detailed
}

export async function fetchBangumiTaggedSubjectsToJsonl({
  output,
  fetchedAt = new Date().toISOString(),
  resume = false,
  tags = DEFAULT_TAGS,
  types = DEFAULT_TYPES,
  limit = 20,
  pages = 1,
  sort = 'rank',
  keywordMode = DEFAULT_KEYWORD_MODE,
  delayMs = 900,
  minWeightedScore = 5,
  minTopTagCount = 5,
  userAgent = DEFAULT_USER_AGENT,
  token = process.env.BANGUMI_ACCESS_TOKEN || '',
  proxy = process.env.BANGUMI_PROXY || '',
} = {}) {
  if (!output) throw new Error('Bangumi fetch output path is required')

  const normalizedKeywordMode = normalizeBangumiKeywordMode(keywordMode)
  const resumeState = resume
    ? await readBangumiResumeState(output)
    : {
        records: [],
        ids: new Set(),
      }

  const { searched, uniqueSubjects, searchBatches } = await searchBangumiTaggedSubjectCandidates({
    tags,
    types,
    limit,
    pages,
    sort,
    keywordMode: normalizedKeywordMode,
    delayMs,
    userAgent,
    token,
    proxy,
  })

  if (!resume) {
    await writeJsonl(output, [])
  }

  const existingIds = new Set(resumeState.ids)
  const fetchedRecords = []
  const skippedSubjects = []
  const failedSubjects = []
  const rejectedSubjects = []

  for (const subject of uniqueSubjects) {
    const id = subjectId(subject)
    if (!id) continue

    if (resume && existingIds.has(id)) {
      skippedSubjects.push(bangumiSearchSubjectSummary(subject))
      continue
    }

    try {
      const detail = await fetchBangumiSubject(id, { userAgent, token, proxy })
      const annotated = annotateBangumiYuriSignal(detail)

      if (subjectPassesYuriTagThreshold(annotated, { minWeightedScore, minTopTagCount })) {
        const record = bangumiSubjectToRawSource(annotated, { fetchedAt })
        await appendJsonlRecord(output, record)
        fetchedRecords.push(record)
        existingIds.add(id)
      } else {
        rejectedSubjects.push({
          ...bangumiSearchSubjectSummary(annotated),
          yuriTagSignal: annotated?._baihepailei?.yuriTagSignal,
        })
      }
    } catch (error) {
      failedSubjects.push({
        ...bangumiSearchSubjectSummary(subject),
        error: error?.message ? String(error.message).slice(0, 800) : String(error).slice(0, 800),
      })
    }

    await sleep(delayMs)
  }

  const outputRecords = resume ? [...resumeState.records, ...fetchedRecords] : fetchedRecords

  return {
    records: outputRecords,
    report: {
      fetchedAt,
      tags,
      types,
      limit,
      pages,
      sort,
      keywordMode: normalizedKeywordMode,
      minWeightedScore,
      minTopTagCount,
      proxyUsed: Boolean(proxy),
      resume,
      existingCount: resumeState.records.length,
      searched: searched.length,
      uniqueSearched: uniqueSubjects.length,
      searchBatches,
      fetched: fetchedRecords.length,
      skipped: skippedSubjects.length,
      failed: failedSubjects.length,
      rejectedBelowThreshold: rejectedSubjects.length,
      count: outputRecords.length,
      subjects: outputRecords.map(bangumiRawSourceRecordSummary),
      skippedSubjects,
      failedSubjects,
      rejectedSubjects,
    },
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const output = args.get('out') || 'data_local/raw/bangumi/bangumi-yuri-tagged.jsonl'
  const reportOutput = args.get('report') || 'data_local/reports/bangumi-yuri-tagged-summary.json'
  const fetchedAt = new Date().toISOString()
  const tags = parseCsv(args.get('tags'), DEFAULT_TAGS)
  const types = parseNumberCsv(args.get('types'), DEFAULT_TYPES)
  const limit = Number(args.get('limit') || 20)
  const pages = Number(args.get('pages') || 1)
  const delayMs = Number(args.get('delay-ms') || 900)
  const minWeightedScore = Number(args.get('min-weighted-score') || 5)
  const minTopTagCount = Number(args.get('min-top-tag-count') || 5)
  const sort = args.get('sort') || 'rank'
  const keywordMode = normalizeBangumiKeywordMode(args.get('keyword-mode') || process.env.BANGUMI_KEYWORD_MODE || DEFAULT_KEYWORD_MODE)
  const userAgent = args.get('user-agent') || process.env.BANGUMI_USER_AGENT || DEFAULT_USER_AGENT
  const token = args.get('token') || process.env.BANGUMI_ACCESS_TOKEN || ''
  const proxy = args.get('proxy') || process.env.BANGUMI_PROXY || ''
  const resume = parseBoolean(args.get('resume'), false)

  if (proxy) {
    console.log('Using proxy for Bangumi requests.')
  }

  if (resume) {
    console.log(`Resuming Bangumi fetch output from ${output}.`)
  }

  if (keywordMode !== DEFAULT_KEYWORD_MODE) {
    console.log(`Using Bangumi keyword mode: ${keywordMode}.`)
  }

  const { report } = await fetchBangumiTaggedSubjectsToJsonl({
    output,
    fetchedAt,
    resume,
    tags,
    types,
    limit,
    pages,
    sort,
    keywordMode,
    delayMs,
    minWeightedScore,
    minTopTagCount,
    userAgent,
    token,
    proxy,
  })

  await writeJsonFile(reportOutput, report)

  console.log(`Fetched ${report.fetched} new Bangumi yuri-tagged subjects -> ${output}`)
  console.log(`Output contains ${report.count} total records; skipped ${report.skipped}; failed ${report.failed}.`)
  console.log(`Wrote summary -> ${reportOutput}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
