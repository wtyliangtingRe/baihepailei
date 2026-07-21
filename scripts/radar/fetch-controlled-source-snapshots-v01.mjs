#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const VERSION = 'controlled-source-online-fetch-v0.1'
const DEFAULT_ROOT = 'data_local/staging/ai-radar/controlled-source-fetch-v01'
const DEFAULT_USER_AGENT = 'BaihepaileiSourceRefresh/0.1 (+https://github.com/wtyliangtingRe/baihepailei)'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 1_500
const DEFAULT_DELAY_MS = 900
const SOURCE_KEYS = ['bangumi', 'yurizukan', 'vndb', 'steam']

const VNDB_API = 'https://api.vndb.org/kana'
const YURIZUKAN_BASE = 'https://www.yurizukan.com'
const STEAM_STORE = 'https://store.steampowered.com'

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; i += 1 }
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
function parseNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.floor(number)))
}
function parseCsv(value, fallback = []) {
  if (!value) return fallback
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}
function assertUnderDataLocal(target) {
  const root = path.resolve('data_local')
  const resolved = path.resolve(target)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Controlled online source snapshots must remain below ignored data_local/.')
  }
}
function unique(values) { return [...new Set(values.filter(Boolean))] }
function uniqueBy(rows, keyBuilder) {
  const seen = new Set()
  const output = []
  for (const row of rows) {
    const key = keyBuilder(row)
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(row)
  }
  return output
}
function cleanText(value) {
  return val(value).normalize('NFKC').replace(/\r\n?/gu, '\n').replace(/[\t\f\v]+/gu, ' ').replace(/[ \u3000]+/gu, ' ').trim()
}
function htmlDecode(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
}
function stripHtml(value) {
  return cleanText(htmlDecode(String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|section|article|tr|dt|dd)>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')))
}

async function fetchWithRetry(url, options = {}, settings = {}) {
  const retries = parseNumber(settings.retries, DEFAULT_RETRIES, { min: 0, max: 8 })
  const retryDelayMs = parseNumber(settings.retryDelayMs, DEFAULT_RETRY_DELAY_MS, { min: 0, max: 60_000 })
  const timeoutMs = parseNumber(settings.timeoutMs, DEFAULT_TIMEOUT_MS, { min: 1_000, max: 180_000 })
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent': settings.userAgent || DEFAULT_USER_AGENT,
          Accept: options.headers?.Accept || '*/*',
          ...(options.headers || {}),
        },
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`)
      return { response, text }
    } catch (error) {
      lastError = error
      if (attempt >= retries) break
      await sleep(retryDelayMs * (attempt + 1))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError
}
async function fetchJson(url, options = {}, settings = {}) {
  const { text } = await fetchWithRetry(url, options, settings)
  try { return JSON.parse(text) } catch (error) { throw new Error(`Invalid JSON from ${url}: ${error.message}`) }
}

export function parseYurizukanArticleIds(html) {
  return unique([...String(html || '').matchAll(/\/articles\/articleDetail\/(\d+)/giu)].map((match) => match[1]))
}
export function parseYurizukanArticle(html, articleId, fetchedAt = new Date().toISOString()) {
  const sourceUrl = `${YURIZUKAN_BASE}/articles/articleDetail/${articleId}`
  const h1 = String(html || '').match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1] || ''
  const title = stripHtml(h1)
  const bodyText = stripHtml(html)
  const lines = bodyText.split(/\n+/u).map(cleanText).filter(Boolean)
  const mediaIndex = lines.findIndex((line) => line === '媒体')
  const mediaText = mediaIndex >= 0 ? lines[mediaIndex + 1] || '' : ''
  let mediaGroup = 'unknown'
  let mediaType = 'unknown'
  let format = 'unknown'
  if (/漫画|コミック|manga/iu.test(mediaText)) { mediaGroup = 'manga'; mediaType = 'manga'; format = 'manga_series' }
  else if (/アニメ|anime|映画|OVA|ONA/iu.test(mediaText)) { mediaGroup = 'anime'; mediaType = 'anime'; format = /映画/u.test(mediaText) ? 'anime_movie' : 'tv_anime' }
  else if (/ライトノベル/iu.test(mediaText)) { mediaGroup = 'novel'; mediaType = 'light_novel'; format = 'light_novel_series' }
  else if (/小説|novel/iu.test(mediaText)) { mediaGroup = 'novel'; mediaType = 'novel'; format = 'novel_series' }
  else if (/ゲーム|game/iu.test(mediaText)) { mediaGroup = 'game'; mediaType = 'game'; format = 'pc_game' }
  const externalLinks = uniqueBy([...String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)]
    .map((match) => ({ url: htmlDecode(match[1]), text: stripHtml(match[2]) }))
    .filter((item) => /^https?:\/\//iu.test(item.url) && !/yurizukan\.com/iu.test(item.url)), (item) => item.url)
  return {
    action: 'yurizukan_create_work',
    planStatus: 'online_discovery_candidate',
    key: `yurizukan-online-${articleId}`,
    yurizukanIds: [String(articleId)],
    firstYurizukanId: String(articleId),
    title,
    mediaGroup,
    mediaType,
    format,
    sourceSnapshotAt: fetchedAt,
    sourceLinks: [{ label: `Yurizukan #${articleId}`, url: sourceUrl, fetchedAt }],
    candidateSources: [{ source: 'yurizukan', label: 'Yurizukan', externalId: String(articleId), url: sourceUrl, fetchedAt, note: 'Online discovery from Yurizukan new articles.' }],
    groupPreview: {
      sourceLinks: [{ label: `Yurizukan #${articleId}`, url: sourceUrl, fetchedAt }],
      candidateSources: [{ source: 'yurizukan', label: 'Yurizukan', externalId: String(articleId), url: sourceUrl, fetchedAt }],
      evidenceNoteAppend: 'Yurizukan lists this work as yuri-related. Metadata remains AI/code-generated and pending human review.',
      rawTextLines: lines,
      externalLinks,
      mediaText,
    },
  }
}

export function classifyVndbRow(row) {
  const tags = list(row?.tags)
  const g97 = tags.find((tag) => val(tag?.id).toLowerCase() === 'g97' && Number(tag?.rating || 0) >= 1)
  const g82 = tags.find((tag) => val(tag?.id).toLowerCase() === 'g82' && Number(tag?.rating || 0) >= 1)
  const sensitiveReasons = []
  if (tags.some((tag) => val(tag?.category) === 'ero' && Number(tag?.rating || 0) >= 1)) sensitiveReasons.push('erotic_tag')
  if (Number(row?.image?.sexual || 0) >= 1.5) sensitiveReasons.push('image_sexual_high')
  if (Number(row?.image?.violence || 0) >= 1.5) sensitiveReasons.push('image_violence_high')
  let status = 'other_ordinary_yuri_review'
  if (g97 && sensitiveReasons.length === 0) status = 'ordinary_romance_create_review'
  else if (g97) status = 'sensitive_romance_create_review'
  else if (g82) status = 'lesbian_sex_only_review'
  else if (sensitiveReasons.length) status = 'other_sensitive_yuri_review'
  return { status, matchedTags: [g97, g82].filter(Boolean), sensitiveReasons }
}
export function vndbApiRowToCandidate(row, fetchedAt = new Date().toISOString()) {
  const classification = classifyVndbRow(row)
  const id = val(row?.id)
  const titleValues = unique([row?.title, row?.alttitle, ...list(row?.aliases), ...list(row?.titles).map((item) => item?.title)].map(cleanText))
  const title = cleanText(row?.title || row?.alttitle)
  const originalTitle = cleanText(row?.alttitle || title)
  const sourceUrl = `https://vndb.org/${id}`
  const payloadPreview = {
    title,
    originalTitle,
    aliases: titleValues.filter((item) => item !== title && item !== originalTitle),
    mediaGroup: 'game',
    mediaType: 'visual_novel',
    format: 'visual_novel',
    firstPublishedAt: val(row?.released),
    externalIds: { vndbId: id },
    sourceLinks: [{ label: `VNDB ${id}`, url: sourceUrl, fetchedAt }],
    candidateSources: [{ source: 'vndb', label: 'VNDB', externalId: id, url: sourceUrl, fetchedAt, note: `VNDB tag gate: ${classification.status}` }],
  }
  return {
    action: 'vndb_create_candidate_preview',
    matchBy: 'no_match',
    blockers: ['no_existing_work_match'],
    vndbId: id,
    titleCandidates: titleValues,
    raw: row,
    sourceSnapshotAt: fetchedAt,
    createCandidatePreview: { ...payloadPreview, payloadPreview },
    yuriCreateCandidate: {
      status: classification.status.includes('sensitive') ? 'sensitive_create_review' : 'ordinary_create_review',
      title,
      minTagRating: 1,
      matchedTags: classification.matchedTags,
      sensitiveReasons: classification.sensitiveReasons,
      note: 'Online VNDB Kana discovery. Report-only until unified dedupe and write eligibility checks pass.',
    },
    yuriCreateCandidateV2: {
      status: classification.status,
      hasRomanceTag: classification.matchedTags.some((tag) => val(tag?.id).toLowerCase() === 'g97'),
      hasSexOnlyTag: classification.matchedTags.some((tag) => val(tag?.id).toLowerCase() === 'g82'),
      sensitiveReasons: classification.sensitiveReasons,
    },
    yuriCreateCandidateV3: {
      status: classification.status,
      repairedTitleFields: false,
      suspiciousTitleValuesAfterRepair: [],
      firstWaveEligible: classification.status === 'ordinary_romance_create_review',
    },
  }
}

const STRONG_YURI_PATTERNS = [/\byuri\b/iu, /\bgirls?\s*love\b/iu, /\blesbian\b/iu, /\bsapphic\b/iu, /\bGL\b/u, /百合/u, /女同/u]
const FEMALE_ROMANCE_PATTERNS = [/\bromance\b/iu, /\bdating\b/iu, /\blove\b/iu, /恋爱|戀愛|恋愛|爱情|愛情/u]
const FEMALE_SUBJECT_PATTERNS = [/\bgirls?\b/iu, /\bwom[ae]n\b|\bfemale\b/iu, /少女|女孩|女生|女性|女主|女の子|女子/u]
const SENSITIVE_PATTERNS = [/\badult\b|\bsexual\b|\bsex\b|\berotic\b|\bnudity\b/iu, /性内容|性暗示|性爱|裸露|成人向|成人内容/u]
function patternHits(text, patterns) { return unique(patterns.flatMap((pattern) => text.match(pattern)?.[0] || []).map(cleanText)) }
export function classifySteamApp(app, searchTerms = []) {
  const text = cleanText([app?.name, app?.short_description, app?.about_the_game, app?.detailed_description, list(app?.genres).map((item) => item?.description).join(' '), list(app?.categories).map((item) => item?.description).join(' ')].join('\n'))
  const strongYuriHits = patternHits(text, STRONG_YURI_PATTERNS)
  const romanceHits = patternHits(text, FEMALE_ROMANCE_PATTERNS)
  const femaleHits = patternHits(text, FEMALE_SUBJECT_PATTERNS)
  const sensitiveHits = patternHits(cleanText([app?.content_descriptors?.notes, text].join('\n')), SENSITIVE_PATTERNS)
  const requiredAge = Number(app?.required_age || 0)
  const strong = strongYuriHits.length > 0
  const femaleRomance = romanceHits.length > 0 && femaleHits.length > 0
  const sensitive = sensitiveHits.length > 0 || requiredAge >= 18
  let bucket = 'p9-other-review'
  if (strong && !sensitive) bucket = 'p1-strong-yuri-nonadult'
  else if (strong) bucket = 'p2-strong-yuri-sensitive'
  else if (femaleRomance && !sensitive) bucket = 'p3-female-romance-nonadult'
  else if (femaleRomance) bucket = 'p4-female-romance-sensitive'
  else if (sensitive) bucket = 'p8-sensitive-review'
  return { bucket, strongYuriHits, romanceHits, femaleHits, sensitiveHits, requiredAge }
}
export function steamAppToCandidate(appId, app, searchTerms, fetchedAt = new Date().toISOString()) {
  const classification = classifySteamApp(app, searchTerms)
  const sourceUrl = `${STEAM_STORE}/app/${appId}`
  const payloadPreview = {
    title: cleanText(app?.name),
    originalTitle: cleanText(app?.name),
    mediaGroup: 'game',
    mediaType: 'game',
    format: /visual novel|ビジュアルノベル|视觉小说|視覺小說/iu.test(cleanText([app?.short_description, app?.about_the_game, list(app?.genres).map((item) => item?.description).join(' ')].join('\n'))) ? 'visual_novel' : 'pc_game',
    firstPublishedAt: val(app?.release_date?.date),
    externalIds: { steamAppId: String(appId) },
    sourceLinks: [{ label: `Steam ${appId}`, url: sourceUrl, fetchedAt }],
    candidateSources: [{ source: 'steam', label: 'Steam', externalId: String(appId), url: sourceUrl, fetchedAt, note: `Steam online discovery bucket: ${classification.bucket}; search terms: ${searchTerms.join(', ')}` }],
    yuriCandidateScore: classification.bucket.startsWith('p1-') ? 0.8 : classification.bucket.startsWith('p2-') ? 0.7 : classification.bucket.startsWith('p3-') ? 0.55 : 0.45,
  }
  return {
    action: 'steam_create_candidate_preview',
    planStatus: 'create_candidate_review',
    key: `steam-online-${appId}`,
    bucket: classification.bucket,
    steamDiscoveryBucket: classification.bucket,
    steamAppId: String(appId),
    steamUrl: sourceUrl,
    title: payloadPreview.title,
    raw: app,
    sourceSnapshotAt: fetchedAt,
    searchTerms,
    discoveryClassification: classification,
    createCandidatePreview: { ...payloadPreview, payloadPreview },
  }
}
export function parseSteamSearchAppIds(payload) {
  const html = typeof payload === 'string' ? payload : val(payload?.results_html)
  return unique([
    ...[...html.matchAll(/data-ds-appid=["'](\d+)["']/giu)].map((match) => match[1]),
    ...[...html.matchAll(/\/app\/(\d+)/giu)].map((match) => match[1]),
  ])
}

async function fetchVndb({ outDir, delayMs, retries, retryDelayMs, timeoutMs, userAgent, maxPages, resultsPerPage }) {
  const fetchedAt = new Date().toISOString()
  const rows = []
  const batches = []
  for (let page = 1; page <= maxPages; page += 1) {
    const body = {
      filters: ['or', ['tag', '=', ['g97', 2, 1]], ['tag', '=', ['g82', 2, 1]]],
      fields: 'title,alttitle,titles{title,lang,official,main},aliases,released,description,languages,platforms,image{url,sexual,violence},tags{id,rating,spoiler,lie,name,category},developers{id,name,original}',
      sort: 'id',
      reverse: false,
      results: resultsPerPage,
      page,
      count: false,
    }
    const json = await fetchJson(`${VNDB_API}/vn`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }, { retries, retryDelayMs, timeoutMs, userAgent })
    const pageRows = list(json?.results)
    rows.push(...pageRows.map((row) => vndbApiRowToCandidate(row, fetchedAt)))
    batches.push({ page, returned: pageRows.length, more: Boolean(json?.more) })
    if (!json?.more) break
    await sleep(delayMs)
  }
  const output = path.join(outDir, 'vndb', 'vndb-yuri-online-v01.jsonl')
  writeJsonl(output, uniqueBy(rows, (row) => row.vndbId))
  return { source: 'vndb', output, fetchedAt, count: rows.length, batches }
}

async function fetchYurizukan({ outDir, delayMs, retries, retryDelayMs, timeoutMs, userAgent, pages, maxArticles }) {
  const fetchedAt = new Date().toISOString()
  const ids = []
  const listPages = []
  for (let page = 1; page <= pages; page += 1) {
    const url = page === 1 ? `${YURIZUKAN_BASE}/articles/newArticlesList` : `${YURIZUKAN_BASE}/articles/newArticlesList?page=${page}`
    const { text } = await fetchWithRetry(url, { headers: { Accept: 'text/html,application/xhtml+xml' } }, { retries, retryDelayMs, timeoutMs, userAgent })
    const pageIds = parseYurizukanArticleIds(text)
    ids.push(...pageIds)
    listPages.push({ page, url, articleIds: pageIds })
    if (!pageIds.length) break
    await sleep(delayMs)
  }
  const selectedIds = unique(ids).slice(0, maxArticles)
  const rows = []
  const failed = []
  for (const id of selectedIds) {
    const url = `${YURIZUKAN_BASE}/articles/articleDetail/${id}`
    try {
      const { text } = await fetchWithRetry(url, { headers: { Accept: 'text/html,application/xhtml+xml' } }, { retries, retryDelayMs, timeoutMs, userAgent })
      const row = parseYurizukanArticle(text, id, fetchedAt)
      if (!row.title) throw new Error('Article title not found')
      rows.push(row)
    } catch (error) {
      failed.push({ id, url, error: String(error?.message || error).slice(0, 800) })
    }
    await sleep(delayMs)
  }
  const output = path.join(outDir, 'yurizukan', 'yurizukan-yuri-online-v01.jsonl')
  writeJsonl(output, rows)
  return { source: 'yurizukan', output, fetchedAt, count: rows.length, listPages, failed }
}

async function fetchSteam({ outDir, delayMs, retries, retryDelayMs, timeoutMs, userAgent, searchTerms, pagesPerTerm, countPerPage, maxApps }) {
  const fetchedAt = new Date().toISOString()
  const termByAppId = new Map()
  const searchBatches = []
  for (const term of searchTerms) {
    for (let page = 0; page < pagesPerTerm; page += 1) {
      const start = page * countPerPage
      const url = new URL('/search/results/', STEAM_STORE)
      url.searchParams.set('query', '')
      url.searchParams.set('term', term)
      url.searchParams.set('start', String(start))
      url.searchParams.set('count', String(countPerPage))
      url.searchParams.set('infinite', '1')
      url.searchParams.set('cc', 'us')
      url.searchParams.set('l', 'english')
      const json = await fetchJson(url, { headers: { Accept: 'application/json' } }, { retries, retryDelayMs, timeoutMs, userAgent })
      const ids = parseSteamSearchAppIds(json)
      for (const id of ids) {
        if (!termByAppId.has(id)) termByAppId.set(id, new Set())
        termByAppId.get(id).add(term)
      }
      searchBatches.push({ term, page, start, returnedIds: ids.length, totalCount: Number(json?.total_count || 0) })
      if (ids.length < countPerPage) break
      await sleep(delayMs)
    }
  }
  const selected = [...termByAppId.entries()].slice(0, maxApps)
  const rows = []
  const failed = []
  for (const [appId, terms] of selected) {
    const url = new URL('/api/appdetails', STEAM_STORE)
    url.searchParams.set('appids', appId)
    url.searchParams.set('cc', 'us')
    url.searchParams.set('l', 'english')
    try {
      const json = await fetchJson(url, { headers: { Accept: 'application/json' } }, { retries, retryDelayMs, timeoutMs, userAgent })
      const wrapper = json?.[appId]
      if (!wrapper?.success || !wrapper?.data) throw new Error('Steam appdetails returned no successful data')
      rows.push(steamAppToCandidate(appId, wrapper.data, [...terms], fetchedAt))
    } catch (error) {
      failed.push({ appId, terms: [...terms], error: String(error?.message || error).slice(0, 800) })
    }
    await sleep(delayMs)
  }
  const output = path.join(outDir, 'steam', 'steam-yuri-online-v01.jsonl')
  writeJsonl(output, rows)
  return { source: 'steam', output, fetchedAt, count: rows.length, searchBatches, failed, byBucket: Object.fromEntries([...new Set(rows.map((row) => row.bucket))].map((bucket) => [bucket, rows.filter((row) => row.bucket === bucket).length])) }
}

function fetchBangumi({ outDir, profile, pages, delayMs }) {
  const output = path.join(outDir, 'bangumi', 'bangumi-yuri-tagged.jsonl')
  const report = path.join(outDir, 'bangumi', 'bangumi-yuri-tagged-summary.json')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const args = [
    path.resolve('tools/source_import/scripts/fetch-bangumi-tagged-subjects.mjs'),
    '--out', output,
    '--report', report,
    '--tags', profile === 'quick' ? '百合,GL' : '百合,轻百合,GL',
    '--types', '1,2,4',
    '--limit', '20',
    '--pages', String(pages),
    '--delay-ms', String(delayMs),
    '--stop-after-empty-pages', profile === 'quick' ? '1' : '3',
    '--retries', '2',
    '--retry-delay-ms', '1500',
  ]
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Bangumi fetcher failed with exit code ${result.status}`)
  const summary = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : {}
  return { source: 'bangumi', output, report, fetchedAt: summary.fetchedAt, count: Number(summary.count || 0), upstreamSummary: summary }
}

export async function fetchControlledSourceSnapshots(options = {}) {
  const runId = options.runId || `${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${randomUUID().slice(0, 8)}`
  const outDir = options.outDir || path.join(DEFAULT_ROOT, runId)
  assertUnderDataLocal(outDir)
  if (fs.existsSync(outDir)) throw new Error(`Refusing to reuse existing source fetch directory: ${outDir}`)
  fs.mkdirSync(outDir, { recursive: true })

  const profile = options.profile === 'full' ? 'full' : 'quick'
  const sources = options.sources?.length ? options.sources : SOURCE_KEYS
  const delayMs = parseNumber(options.delayMs, DEFAULT_DELAY_MS, { min: 0, max: 60_000 })
  const retries = parseNumber(options.retries, DEFAULT_RETRIES, { min: 0, max: 8 })
  const retryDelayMs = parseNumber(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS, { min: 0, max: 60_000 })
  const timeoutMs = parseNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS, { min: 1_000, max: 180_000 })
  const userAgent = options.userAgent || DEFAULT_USER_AGENT
  const results = []

  for (const source of sources) {
    if (!SOURCE_KEYS.includes(source)) throw new Error(`Unsupported controlled source: ${source}`)
    if (source === 'bangumi') {
      results.push(fetchBangumi({ outDir, profile, pages: options.bangumiPages || (profile === 'full' ? 30 : 4), delayMs }))
    } else if (source === 'vndb') {
      results.push(await fetchVndb({ outDir, delayMs, retries, retryDelayMs, timeoutMs, userAgent, maxPages: options.vndbPages || (profile === 'full' ? 100 : 5), resultsPerPage: 100 }))
    } else if (source === 'yurizukan') {
      results.push(await fetchYurizukan({ outDir, delayMs, retries, retryDelayMs, timeoutMs, userAgent, pages: options.yurizukanPages || (profile === 'full' ? 20 : 3), maxArticles: options.yurizukanMaxArticles || (profile === 'full' ? 2000 : 100) }))
    } else if (source === 'steam') {
      results.push(await fetchSteam({ outDir, delayMs, retries, retryDelayMs, timeoutMs, userAgent, searchTerms: options.steamTerms || ['yuri', 'girls love', 'lesbian', 'sapphic', '百合'], pagesPerTerm: options.steamPages || (profile === 'full' ? 10 : 2), countPerPage: 50, maxApps: options.steamMaxApps || (profile === 'full' ? 2000 : 250) }))
    }
  }

  const summary = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    runId,
    outDir,
    profile,
    requestedSources: sources,
    results,
    outputs: Object.fromEntries(results.map((result) => [result.source, result.output])),
    safety: {
      externalFetch: true,
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      updatesWorks: false,
      publishesWorks: false,
      mutatesHumanAssessment: false,
      mutatesRadarAssessment: false,
      rawSnapshotsOnly: true,
      firstErrorStopsSource: true,
    },
    nextStep: 'Pass these immutable source snapshots to the controlled normalization and candidate planner. Network responses still cannot write Works directly.',
  }
  writeJson(path.join(outDir, 'summary.json'), summary)
  return summary
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.apply || args.execute || args.confirm || args.write || args.patch || args.publish) {
    throw new Error('Online source fetching only creates local snapshots. It cannot apply, create, update, assess, or publish Works.')
  }
  const sources = parseCsv(args.sources, SOURCE_KEYS)
  const summary = await fetchControlledSourceSnapshots({
    outDir: val(args['out-dir']) || undefined,
    profile: val(args.profile || 'quick'),
    sources,
    delayMs: args['delay-ms'],
    retries: args.retries,
    retryDelayMs: args['retry-delay-ms'],
    timeoutMs: args['timeout-ms'],
    userAgent: val(args['user-agent'] || process.env.BAIHEPAILEI_SOURCE_USER_AGENT || DEFAULT_USER_AGENT),
    bangumiPages: parseNumber(args['bangumi-pages'], undefined, { min: 1, max: 500 }),
    vndbPages: parseNumber(args['vndb-pages'], undefined, { min: 1, max: 1000 }),
    yurizukanPages: parseNumber(args['yurizukan-pages'], undefined, { min: 1, max: 500 }),
    yurizukanMaxArticles: parseNumber(args['yurizukan-max-articles'], undefined, { min: 1, max: 100_000 }),
    steamPages: parseNumber(args['steam-pages'], undefined, { min: 1, max: 100 }),
    steamMaxApps: parseNumber(args['steam-max-apps'], undefined, { min: 1, max: 100_000 }),
    steamTerms: parseCsv(args['steam-terms'], ['yuri', 'girls love', 'lesbian', 'sapphic', '百合']),
  })
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
