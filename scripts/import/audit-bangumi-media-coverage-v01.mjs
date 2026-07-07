#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const VERSION = 'bangumi-media-coverage-audit-v0.1'
const DEFAULT_OUT_DIR = 'data_local/staging/work-source-metadata'
const PAGE_LIMIT = 200
const DEFAULT_ROOTS = [
  'data_local/raw/bangumi',
  'E:/data/baihepailei/data_local/raw/bangumi',
]

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      i += 1
    }
  }
  return args
}

function clean(value) {
  return String(value ?? '')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
}

function key(value) { return clean(value).toLowerCase() }

function uniqueStrings(values) {
  const seen = new Set()
  const out = []
  for (const value of values.flat(Infinity).map(clean).filter(Boolean)) {
    const k = value.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(value)
  }
  return out
}

function countBy(rows, getKey) {
  const out = {}
  for (const row of rows) {
    const k = String(typeof getKey === 'function' ? getKey(row) : row[getKey] || 'missing')
    out[k] = (out[k] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.next'].includes(item.name)) continue
    const full = path.join(dir, item.name)
    if (item.isDirectory()) walk(full, out)
    else if (/\.(json|jsonl|ndjson)$/i.test(item.name)) out.push(full)
  }
  return out
}

async function* readRows(file) {
  if (/\.(jsonl|ndjson)$/i.test(file)) {
    const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
    for await (const line of rl) {
      const body = line.trim()
      if (!body) continue
      try { yield JSON.parse(body) } catch {}
    }
    return
  }
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return
  let json = null
  try { json = JSON.parse(raw) } catch { return }
  if (Array.isArray(json)) {
    for (const item of json) yield item
    return
  }
  for (const k of ['data', 'items', 'subjects', 'docs', 'results', 'records']) {
    if (Array.isArray(json?.[k])) {
      for (const item of json[k]) yield item
      return
    }
  }
  yield json
}

function isSubjectLike(value) {
  if (!value || typeof value !== 'object') return false
  const hasId = 'id' in value || 'subject_id' in value || 'subjectId' in value || 'sourceRecordId' in value
  const hasCore = 'name' in value || 'name_cn' in value || 'summary' in value || 'date' in value || 'air_date' in value
  return hasId && hasCore
}

function unwrapCandidates(row) {
  const out = []
  const push = (value, pathName, wrapper) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((item, index) => push(item, `${pathName}[${index}]`, wrapper))
      return
    }
    if (isSubjectLike(value)) out.push({ record: value, pathName, wrapper: wrapper || value })
    for (const k of ['raw', 'subject', 'candidate', 'data', 'item']) {
      if (value[k]) push(value[k], `${pathName}.${k}`, value)
    }
  }
  push(row, '$', row)
  return out
}

function recordId(record, wrapper = {}) {
  return clean(record.id || record.subject_id || record.subjectId || record.bangumiSubjectId || wrapper.sourceRecordId)
}

function textValues(value, out = []) {
  if (!value) return out
  if (typeof value === 'string' || typeof value === 'number') {
    const text = clean(value)
    if (text) out.push(text)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) textValues(item, out)
    return out
  }
  if (typeof value === 'object') {
    for (const k of ['title', 'name', 'value', 'text', 'label', 'native', 'romaji', 'english', 'chinese', 'japanese', 'zh', 'ja', 'en']) {
      if (k in value) textValues(value[k], out)
    }
  }
  return out
}

function rawTitles(record) {
  const infobox = Array.isArray(record.infobox) ? record.infobox : []
  const fromInfobox = []
  for (const row of infobox) {
    if (/中文名|别名|別名|别称|別稱|alias/i.test(clean(row?.key))) fromInfobox.push(...textValues(row?.value))
  }
  return uniqueStrings([record.name, record.name_cn, record.name_jp, record.name_en, Array.isArray(record.aliases) ? record.aliases : [], fromInfobox])
}

function inferRawMedia(record, file) {
  const p = file.replaceAll('\\', '/').toLowerCase()
  const type = Number(record.type || record.subject_type || record.subjectType || 0)
  if (type === 2) return 'anime'
  if (type === 1) return 'book'
  if (type === 4) return 'game'
  if (type === 6) return 'real'
  if (/game|games|游戏|遊戲/.test(p)) return 'game'
  if (/book|books|manga|comic|漫画|漫畫|novel|小说|小說/.test(p)) return 'book'
  if (/anime|animation|动画|動畫/.test(p)) return 'anime'
  return 'unknown'
}

function inferBookSubtype(record, file) {
  if (inferRawMedia(record, file) !== 'book') return ''
  const haystack = [file, record.name, record.name_cn, record.summary, JSON.stringify(record.infobox || [])].join(' ').toLowerCase()
  if (/novel|小说|小說|light novel|ライトノベル|小説/.test(haystack)) return 'novel'
  if (/manga|comic|漫画|漫畫|コミック|まんが/.test(haystack)) return 'manga'
  return 'book_unknown'
}

function bangumiIdsOfWork(doc) {
  const ids = []
  const ext = doc.externalIds || {}
  if (ext.bangumiSubjectId) ids.push(clean(ext.bangumiSubjectId))
  for (const source of Array.isArray(doc.candidateSources) ? doc.candidateSources : []) {
    if (clean(source?.source).toLowerCase() === 'bangumi' && clean(source?.externalId)) ids.push(clean(source.externalId))
    ids.push(...bangumiIdsFromString(source?.url))
  }
  for (const link of Array.isArray(doc.sourceLinks) ? doc.sourceLinks : []) ids.push(...bangumiIdsFromString(link?.url || link))
  ids.push(...bangumiIdsFromString(doc.siteId))
  ids.push(...bangumiIdsFromString(doc.slug))
  return uniqueStrings(ids)
}

function bangumiIdsFromString(value) {
  const text = clean(value)
  if (!text) return []
  const out = []
  const patterns = [/^bangumi[-_:](\d+)$/i, /(?:^|[-_])bangumi[-_:](\d+)$/i, /(?:^|[-_])bgm[-_:](\d+)$/i, /bgm\.tv\/subject\/(\d+)/i, /bangumi\.tv\/subject\/(\d+)/i]
  for (const pattern of patterns) {
    const m = text.match(pattern)
    if (m?.[1]) out.push(m[1])
  }
  return uniqueStrings(out)
}

function workTitleKeys(doc) {
  const titles = uniqueStrings([
    doc.title,
    doc.originalTitle,
    Array.isArray(doc.localizedTitles) ? doc.localizedTitles.map((x) => typeof x === 'string' ? x : x?.title) : [],
    Array.isArray(doc.aliases) ? doc.aliases.map((x) => typeof x === 'string' ? x : x?.value) : [],
  ])
  return titles.map(key).filter((x) => x.length >= 2)
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}; url=${url}\n${JSON.stringify(payload, null, 2)}`)
  return payload
}

async function login(baseUrl, email, secret) {
  const result = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password: secret }) })
  if (!result?.token) throw new Error('Payload login succeeded but did not return a token.')
  return result.token
}

function authHeaders(token) { return token ? { Authorization: `JWT ${token}` } : {} }

async function fetchWorks(baseUrl, token, includeDrafts) {
  const docs = []
  let page = 1
  let totalPages = 1
  let totalDocs = 0
  do {
    const params = new URLSearchParams()
    params.set('limit', String(PAGE_LIMIT))
    params.set('depth', '1')
    params.set('page', String(page))
    if (includeDrafts) params.set('draft', 'true')
    else {
      params.set('where[status][equals]', 'published')
      params.set('where[isLiteVisible][not_equals]', 'false')
    }
    const result = await requestJson(`${baseUrl}/api/works?${params.toString()}`, { headers: authHeaders(token) })
    docs.push(...(Array.isArray(result?.docs) ? result.docs : []))
    totalPages = Number(result?.totalPages || 1)
    totalDocs = Number(result?.totalDocs || docs.length)
    page += 1
  } while (page <= totalPages)
  return { docs, totalDocs }
}

async function scanBangumi(args) {
  const explicitRoots = String(args.roots || '').split(';').map(clean).filter(Boolean)
  const scanRoots = (explicitRoots.length ? explicitRoots : DEFAULT_ROOTS).filter((root) => fs.existsSync(root))
  let files = scanRoots.flatMap((root) => walk(root)).filter((file) => /bangumi|bgm|subject/i.test(file)).sort((a, b) => a.localeCompare(b))
  const maxFiles = Number(args['max-files'] || 0)
  const maxRecordsPerFile = Number(args['max-records-per-file'] || 0)
  if (maxFiles > 0) files = files.slice(0, maxFiles)

  const byId = new Map()
  const byTitle = new Map()
  const rows = []
  const filesStats = []

  for (const file of files) {
    let read = 0
    let accepted = 0
    for await (const wrapper of readRows(file)) {
      read += 1
      if (maxRecordsPerFile && read > maxRecordsPerFile) break
      for (const { record, pathName } of unwrapCandidates(wrapper)) {
        const id = recordId(record, wrapper)
        if (!id) continue
        const titles = rawTitles(record)
        const mediaRaw = inferRawMedia(record, file)
        const bookSubtype = inferBookSubtype(record, file)
        const row = { id, titles, mediaRaw, bookSubtype, file, pathName, hasSummary: Boolean(clean(record.summary)), hasDate: Boolean(clean(record.date || record.air_date || record.airDate)) }
        rows.push(row)
        if (!byId.has(id)) byId.set(id, { id, titles: [], mediaRaw, bookSubtype, rows: 0, files: new Set(), hasSummary: false, hasDate: false })
        const bucket = byId.get(id)
        bucket.rows += 1
        bucket.titles.push(...titles)
        bucket.files.add(file)
        bucket.hasSummary = bucket.hasSummary || row.hasSummary
        bucket.hasDate = bucket.hasDate || row.hasDate
        if (bucket.mediaRaw === 'unknown' && mediaRaw !== 'unknown') bucket.mediaRaw = mediaRaw
        if (!bucket.bookSubtype && bookSubtype) bucket.bookSubtype = bookSubtype
        for (const title of titles) {
          const k = key(title)
          if (!k) continue
          if (!byTitle.has(k)) byTitle.set(k, new Set())
          byTitle.get(k).add(id)
        }
        accepted += 1
      }
    }
    if (read || accepted) filesStats.push({ file, read, accepted })
  }

  for (const bucket of byId.values()) {
    bucket.titles = uniqueStrings(bucket.titles)
    bucket.files = Array.from(bucket.files)
  }
  return { scanRoots, files, rows, byId, byTitle, filesStats }
}

function rawBucketLabel(row) {
  if (row.mediaRaw === 'book') return row.bookSubtype || 'book_unknown'
  return row.mediaRaw || 'unknown'
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const includeDrafts = Boolean(args['include-drafts'])
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const secret = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !secret) throw new Error('Missing PAYLOAD_EXPORT_EMAIL/PAYLOAD_EXPORT_PASSWORD or PAYLOAD_SEED_EMAIL/PAYLOAD_SEED_PASSWORD.')
  const token = await login(baseUrl, email, secret)

  const bangumi = await scanBangumi(args)
  const works = await fetchWorks(baseUrl, token, includeDrafts)

  const coverage = new Map()
  for (const raw of bangumi.byId.values()) {
    coverage.set(raw.id, { bangumiId: raw.id, titles: raw.titles, mediaRaw: raw.mediaRaw, bookSubtype: raw.bookSubtype, rawBucket: rawBucketLabel(raw), rawRows: raw.rows, rawFiles: raw.files.slice(0, 8), matchedWorks: [], status: 'unmatched' })
  }

  for (const doc of works.docs) {
    const externalIds = bangumiIdsOfWork(doc)
    for (const id of externalIds) {
      const row = coverage.get(id)
      if (!row) continue
      row.matchedWorks.push({ id: doc.id, title: doc.title, slug: doc.slug, mediaGroup: doc.mediaGroup || 'unknown', mediaType: doc.mediaType || 'unknown', format: doc.format || 'unknown', status: doc.status, isLiteVisible: doc.isLiteVisible, match: 'external_id' })
    }
    for (const title of workTitleKeys(doc)) {
      for (const id of bangumi.byTitle.get(title) || []) {
        const row = coverage.get(id)
        if (!row) continue
        if (row.matchedWorks.some((x) => x.id === doc.id)) continue
        row.matchedWorks.push({ id: doc.id, title: doc.title, slug: doc.slug, mediaGroup: doc.mediaGroup || 'unknown', mediaType: doc.mediaType || 'unknown', format: doc.format || 'unknown', status: doc.status, isLiteVisible: doc.isLiteVisible, match: 'title_exact' })
      }
    }
  }

  for (const row of coverage.values()) {
    const external = row.matchedWorks.filter((x) => x.match === 'external_id')
    const title = row.matchedWorks.filter((x) => x.match === 'title_exact')
    if (external.length) row.status = 'external_id_matched'
    else if (title.length === 1) row.status = 'title_exact_unique'
    else if (title.length > 1) row.status = 'title_exact_multi'
    else row.status = 'unmatched'
  }

  const rows = Array.from(coverage.values()).sort((a, b) => a.rawBucket.localeCompare(b.rawBucket) || a.status.localeCompare(b.status) || Number(a.bangumiId) - Number(b.bangumiId))
  const byRawBucket = {}
  for (const row of rows) {
    const bucket = row.rawBucket || 'unknown'
    if (!byRawBucket[bucket]) byRawBucket[bucket] = { rawUniqueIds: 0, externalIdMatched: 0, titleExactUnique: 0, titleExactMulti: 0, unmatched: 0, payloadMediaGroup: {}, payloadMediaType: {}, payloadFormat: {}, liteVisibleMatches: 0, unknownTypeMatches: 0 }
    const s = byRawBucket[bucket]
    s.rawUniqueIds += 1
    if (row.status === 'external_id_matched') s.externalIdMatched += 1
    if (row.status === 'title_exact_unique') s.titleExactUnique += 1
    if (row.status === 'title_exact_multi') s.titleExactMulti += 1
    if (row.status === 'unmatched') s.unmatched += 1
    for (const work of row.matchedWorks) {
      s.payloadMediaGroup[work.mediaGroup] = (s.payloadMediaGroup[work.mediaGroup] || 0) + 1
      s.payloadMediaType[work.mediaType] = (s.payloadMediaType[work.mediaType] || 0) + 1
      s.payloadFormat[work.format] = (s.payloadFormat[work.format] || 0) + 1
      if (work.isLiteVisible !== false) s.liteVisibleMatches += 1
      if (work.mediaGroup === 'unknown' || work.mediaType === 'unknown' || work.format === 'unknown') s.unknownTypeMatches += 1
    }
  }

  const outputs = {
    rows: path.join(outDir, 'bangumi-media-coverage-audit-v01.rows.jsonl'),
    unmatched: path.join(outDir, 'bangumi-media-coverage-audit-v01-unmatched.rows.jsonl'),
    summary: path.join(outDir, 'bangumi-media-coverage-audit-v01-summary.json'),
    json: path.join(outDir, 'bangumi-media-coverage-audit-v01.json'),
    files: path.join(outDir, 'bangumi-media-coverage-audit-v01-files.json'),
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: true,
    payloadBaseUrl: baseUrl,
    mode: includeDrafts ? 'drafts-and-published' : 'published-only',
    scanRoots: bangumi.scanRoots,
    filesScanned: bangumi.files.length,
    bangumiRawRows: bangumi.rows.length,
    bangumiUniqueIds: bangumi.byId.size,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    rawCoverageByStatus: countBy(rows, 'status'),
    rawCoverageByMedia: byRawBucket,
    outputs,
    safety: { readOnly: true, localSourceRead: true, payloadRead: true, payloadWrite: false, directPostgresqlWrite: false, dataChanged: false },
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.rows, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.unmatched, rows.filter((row) => row.status === 'unmatched').map((row) => JSON.stringify(row)).join('\n') + (rows.some((row) => row.status === 'unmatched') ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.files, JSON.stringify(bangumi.filesStats, null, 2), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify({ ok: true, summary, samples: { rows: rows.slice(0, 50), unmatched: rows.filter((row) => row.status === 'unmatched').slice(0, 50) } }, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
