#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const VERSION = 'bangumi-coverage-audit-v0.1'
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

function key(value) {
  return clean(value).toLowerCase()
}

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

function uniqueObjects(rows, keyFn) {
  const seen = new Set()
  const out = []
  for (const row of rows.filter(Boolean)) {
    const k = keyFn(row)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(row)
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

function mojibakeScore(value) {
  const text = clean(value)
  if (!text) return 0
  const bad = (text.match(/[ÃÂãäåæçèéêëìíîïðñòóôõöøùúûüýþ�]/g) || []).length
  return bad / Math.max(1, text.length)
}

function isMojibake(value) {
  const text = clean(value)
  if (!text) return false
  const badCount = (text.match(/[ÃÂãäåæçèéêëìíîïðñòóôõöøùúûüýþ�]/g) || []).length
  return badCount >= 3 && mojibakeScore(text) > 0.08
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

function infoboxTitles(record) {
  const rows = Array.isArray(record.infobox) ? record.infobox : []
  const out = []
  for (const row of rows) {
    const k = clean(row?.key)
    if (/中文名|别名|別名|别称|別稱|alias/i.test(k)) out.push(...textValues(row?.value))
  }
  return out
}

function rawTitles(record) {
  return uniqueStrings([
    record.name,
    record.name_jp,
    record.name_cn,
    record.name_en,
    Array.isArray(record.aliases) ? record.aliases : [],
    infoboxTitles(record),
  ]).filter((value) => !isMojibake(value))
}

function sourceUrlFromId(id, wrapper = {}, record = {}) {
  const explicit = clean(wrapper.sourceUrl || record.url || record.siteUrl || record.site_url)
  if (explicit) return explicit
  return id ? `https://bgm.tv/subject/${id}` : ''
}

function bangumiKeysFromString(value) {
  const text = clean(value)
  const keys = []
  if (!text) return keys
  const patterns = [/^bangumi[-_:](\d+)$/i, /(?:^|[-_])bangumi[-_:](\d+)$/i, /(?:^|[-_])bgm[-_:](\d+)$/i, /bgm\.tv\/subject\/(\d+)/i, /bangumi\.tv\/subject\/(\d+)/i]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) keys.push(match[1])
  }
  return uniqueStrings(keys)
}

function currentLocalizedTitles(doc) {
  return Array.isArray(doc.localizedTitles) ? doc.localizedTitles.map((x) => clean(typeof x === 'string' ? x : x?.title)).filter(Boolean) : []
}

function currentAliases(doc) {
  return Array.isArray(doc.aliases) ? doc.aliases.map((x) => clean(typeof x === 'string' ? x : x?.value)).filter(Boolean) : []
}

function workTitleKeys(doc) {
  return uniqueStrings([doc.title, doc.originalTitle, currentLocalizedTitles(doc), currentAliases(doc)])
    .map(key)
    .filter((x) => x.length >= 2 && !isMojibake(x))
}

function workBangumiIds(doc) {
  const ids = []
  const ext = doc.externalIds || {}
  if (ext.bangumiSubjectId) ids.push(clean(ext.bangumiSubjectId))
  for (const source of Array.isArray(doc.candidateSources) ? doc.candidateSources : []) {
    if (clean(source?.source).toLowerCase() === 'bangumi' && clean(source?.externalId)) ids.push(clean(source.externalId))
    ids.push(...bangumiKeysFromString(source?.url))
  }
  for (const link of Array.isArray(doc.sourceLinks) ? doc.sourceLinks : []) ids.push(...bangumiKeysFromString(link?.url || link))
  ids.push(...bangumiKeysFromString(doc.siteId))
  ids.push(...bangumiKeysFromString(doc.slug))
  return uniqueStrings(ids)
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
  const maxFiles = Number(args['max-files'] || 0)
  const maxRecordsPerFile = Number(args['max-records-per-file'] || 0)
  let files = scanRoots.flatMap((root) => walk(root)).filter((file) => /bangumi|bgm|subject/i.test(file)).sort((a, b) => a.localeCompare(b))
  if (maxFiles > 0) files = files.slice(0, maxFiles)

  const rawRows = []
  const rawById = new Map()
  const rawByTitle = new Map()
  const fileStats = []
  let wrappedRecords = 0
  let mojibakeRecords = 0

  for (const file of files) {
    let read = 0
    let unwrapped = 0
    let accepted = 0
    for await (const wrapper of readRows(file)) {
      read += 1
      if (maxRecordsPerFile && read > maxRecordsPerFile) break
      for (const { record, pathName, wrapper: outer } of unwrapCandidates(wrapper)) {
        unwrapped += 1
        const id = recordId(record, outer)
        if (!id) continue
        const titles = rawTitles(record)
        const row = {
          id,
          sourceUrl: sourceUrlFromId(id, outer, record),
          titles,
          hasSummary: Boolean(clean(record.summary) && !isMojibake(record.summary)),
          hasDate: Boolean(clean(record.date || record.air_date || record.airDate)),
          file,
          pathName,
          mojibake: Boolean(isMojibake(record.name) || isMojibake(record.name_cn) || isMojibake(record.summary)),
        }
        rawRows.push(row)
        if (pathName !== '$') wrappedRecords += 1
        if (row.mojibake) mojibakeRecords += 1
        if (!rawById.has(id)) rawById.set(id, { id, titles: [], files: new Set(), rows: 0, hasSummary: false, hasDate: false, mojibakeRows: 0 })
        const bucket = rawById.get(id)
        bucket.rows += 1
        bucket.titles.push(...titles)
        bucket.files.add(file)
        bucket.hasSummary = bucket.hasSummary || row.hasSummary
        bucket.hasDate = bucket.hasDate || row.hasDate
        bucket.mojibakeRows += row.mojibake ? 1 : 0
        for (const title of titles) {
          const k = key(title)
          if (!k) continue
          if (!rawByTitle.has(k)) rawByTitle.set(k, new Set())
          rawByTitle.get(k).add(id)
        }
        accepted += 1
      }
    }
    if (read || accepted) fileStats.push({ file, read, unwrapped, accepted })
  }

  for (const bucket of rawById.values()) {
    bucket.titles = uniqueStrings(bucket.titles)
    bucket.files = Array.from(bucket.files)
  }

  return { scanRoots, files, rawRows, rawById, rawByTitle, fileStats, wrappedRecords, mojibakeRecords }
}

function workRef(doc, matchReason) {
  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    siteId: doc.siteId,
    status: doc.status,
    isLiteVisible: doc.isLiteVisible,
    isFullVisible: doc.isFullVisible,
    matchReason,
  }
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

  const rawCoverage = new Map()
  for (const [id, raw] of bangumi.rawById.entries()) {
    rawCoverage.set(id, {
      bangumiId: id,
      titles: raw.titles,
      rawRows: raw.rows,
      rawFiles: raw.files.slice(0, 8),
      hasSummary: raw.hasSummary,
      hasDate: raw.hasDate,
      mojibakeRows: raw.mojibakeRows,
      externalMatches: [],
      titleExactMatches: [],
      status: 'unmatched',
    })
  }

  const siteBangumiExternalWorks = new Set()
  const siteBangumiTitleWorks = new Set()

  for (const doc of works.docs) {
    for (const id of workBangumiIds(doc)) {
      const row = rawCoverage.get(id)
      if (!row) continue
      row.externalMatches.push(workRef(doc, 'external_id'))
      siteBangumiExternalWorks.add(doc.id)
    }
    const titleMatchedRawIds = new Set()
    for (const title of workTitleKeys(doc)) {
      for (const id of bangumi.rawByTitle.get(title) || []) titleMatchedRawIds.add(id)
    }
    for (const id of titleMatchedRawIds) {
      const row = rawCoverage.get(id)
      if (!row) continue
      row.titleExactMatches.push(workRef(doc, 'title_exact'))
      siteBangumiTitleWorks.add(doc.id)
    }
  }

  for (const row of rawCoverage.values()) {
    row.externalMatches = uniqueObjects(row.externalMatches, (x) => x.id)
    row.titleExactMatches = uniqueObjects(row.titleExactMatches, (x) => x.id)
    if (row.externalMatches.length) row.status = 'external_id_matched'
    else if (row.titleExactMatches.length === 1) row.status = 'title_exact_unique'
    else if (row.titleExactMatches.length > 1) row.status = 'title_exact_multi'
    else row.status = 'unmatched'
  }

  const rows = Array.from(rawCoverage.values()).sort((a, b) => a.status.localeCompare(b.status) || Number(a.bangumiId) - Number(b.bangumiId))
  const outputs = {
    rows: path.join(outDir, 'bangumi-coverage-audit-v01.rows.jsonl'),
    unmatched: path.join(outDir, 'bangumi-coverage-audit-v01-unmatched.rows.jsonl'),
    summary: path.join(outDir, 'bangumi-coverage-audit-v01-summary.json'),
    json: path.join(outDir, 'bangumi-coverage-audit-v01.json'),
    files: path.join(outDir, 'bangumi-coverage-audit-v01-files.json'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: true,
    payloadBaseUrl: baseUrl,
    mode: includeDrafts ? 'drafts-and-published' : 'published-only',
    scanRoots: bangumi.scanRoots,
    filesScanned: bangumi.files.length,
    bangumiRawRows: bangumi.rawRows.length,
    bangumiWrappedRows: bangumi.wrappedRecords,
    bangumiMojibakeRows: bangumi.mojibakeRecords,
    bangumiUniqueIds: bangumi.rawById.size,
    bangumiTitleKeys: bangumi.rawByTitle.size,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    worksLiteVisible: works.docs.filter((doc) => doc.isLiteVisible !== false).length,
    worksFullVisible: works.docs.filter((doc) => doc.isFullVisible !== false).length,
    rawCoverage: {
      byStatus: countBy(rows, 'status'),
      matchedAny: rows.filter((row) => row.status !== 'unmatched').length,
      unmatched: rows.filter((row) => row.status === 'unmatched').length,
      externalIdMatched: rows.filter((row) => row.status === 'external_id_matched').length,
      titleExactUnique: rows.filter((row) => row.status === 'title_exact_unique').length,
      titleExactMulti: rows.filter((row) => row.status === 'title_exact_multi').length,
    },
    siteCoverage: {
      worksWithBangumiExternalMatch: siteBangumiExternalWorks.size,
      worksWithBangumiTitleMatch: siteBangumiTitleWorks.size,
    },
    outputs,
    safety: {
      readOnly: true,
      localSourceRead: true,
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      dataChanged: false,
    },
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.rows, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.unmatched, rows.filter((row) => row.status === 'unmatched').map((row) => JSON.stringify(row)).join('\n') + (rows.some((row) => row.status === 'unmatched') ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.files, JSON.stringify(bangumi.fileStats, null, 2), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify({ ok: true, summary, samples: { rows: rows.slice(0, 50), unmatched: rows.filter((row) => row.status === 'unmatched').slice(0, 50) } }, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
