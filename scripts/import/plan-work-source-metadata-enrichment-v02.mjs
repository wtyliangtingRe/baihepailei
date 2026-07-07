#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const VERSION = 'work-source-metadata-enrichment-plan-v0.2'
const DEFAULT_OUT_DIR = 'data_local/staging/work-source-metadata'
const PAGE_LIMIT = 200
const SOURCE_NAMES = ['bangumi', 'anilist', 'vndb', 'wikidata', 'mangadex', 'steam']
const DEFAULT_ROOTS = [
  'data_local/raw',
  'data_local/normalized',
  'data_local/import_ready',
  'data_local/staging',
  'E:/data/baihepailei/data_local/raw',
  'E:/data/baihepailei/data_local/normalized',
  'E:/data/baihepailei/data_local/import_ready',
  'E:/data/baihepailei/data_local/staging',
]

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

function clean(value) {
  return String(value ?? '').replaceAll('\r', ' ').replaceAll('\n', ' ').split(' ').map((x) => x.trim()).filter(Boolean).join(' ')
}

function lower(value) { return clean(value).toLowerCase() }

function unique(values) {
  const seen = new Set()
  const out = []
  for (const value of values.flat(Infinity).map(clean).filter(Boolean)) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function countBy(rows, getKey) {
  const out = {}
  for (const row of rows) {
    const key = String(typeof getKey === 'function' ? getKey(row) : row[getKey] || 'missing')
    out[key] = (out[key] || 0) + 1
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

async function* readRecords(file) {
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
  for (const key of ['data', 'items', 'subjects', 'docs', 'results', 'media', 'records']) {
    if (Array.isArray(json?.[key])) {
      for (const item of json[key]) yield item
      return
    }
  }
  yield json
}

function sourceFromPath(file) {
  const key = lower(file).replaceAll('\\', '/')
  return SOURCE_NAMES.find((name) => key.includes(name)) || ''
}

function inferSource(file, record) {
  const fromPath = sourceFromPath(file)
  if (fromPath) return fromPath
  if ('name_cn' in record || 'subject_id' in record || 'air_date' in record || ('rating' in record && 'collection' in record)) return 'bangumi'
  if (record.title && typeof record.title === 'object' && ('romaji' in record.title || 'native' in record.title || 'english' in record.title)) return 'anilist'
  if (String(record.id || '').startsWith('v') || ('released' in record && 'aliases' in record)) return 'vndb'
  if (String(record.id || '').startsWith('Q') || 'wikidataQid' in record || 'labels' in record) return 'wikidata'
  return 'unknown'
}

function recordId(source, record) {
  if (source === 'bangumi') return clean(record.id || record.subject_id || record.subjectId || record.bangumiSubjectId)
  if (source === 'anilist') return clean(record.id || record.mediaId || record.anilistMediaId)
  if (source === 'vndb') return clean(record.id || record.vndbId)
  if (source === 'wikidata') return clean(record.id || record.qid || record.wikidataQid)
  if (source === 'mangadex') return clean(record.id || record.mangadexId)
  if (source === 'steam') return clean(record.id || record.appid || record.appId || record.steamAppId)
  return clean(record.id)
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
    for (const key of ['title', 'name', 'value', 'text', 'label', 'native', 'romaji', 'english', 'chinese', 'japanese', 'zh', 'ja', 'en', 'name_cn', 'name_en']) {
      if (key in value) textValues(value[key], out)
    }
  }
  return out
}

function uniqueLocalized(rows) {
  const seen = new Set()
  const out = []
  for (const row of rows) {
    const title = clean(row.title)
    if (!title) continue
    const key = [title.toLowerCase(), row.language || 'unknown', row.kind || 'alias', row.source || ''].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...row, title })
  }
  return out
}

function titleCandidates(source, record) {
  const localized = []
  const add = (title, language, kind, note = '') => {
    const value = clean(title)
    if (!value) return
    localized.push({ title: value, language, kind, source, note })
  }

  if (source === 'bangumi') {
    add(record.name, 'ja', 'original', 'Bangumi name')
    add(record.name_cn, 'zh-Hans', 'localized', 'Bangumi name_cn')
    add(record.name_en, 'en', 'localized', 'Bangumi name_en')
    add(record.name_jp, 'ja', 'original', 'Bangumi name_jp')
    for (const alias of Array.isArray(record.aliases) ? record.aliases : []) add(alias, 'unknown', 'alias', 'Bangumi alias')
  } else if (source === 'anilist') {
    add(record.title?.native, 'ja', 'original', 'AniList title.native')
    add(record.title?.romaji, 'und', 'romanized', 'AniList title.romaji')
    add(record.title?.english, 'en', 'localized', 'AniList title.english')
    for (const s of Array.isArray(record.synonyms) ? record.synonyms : []) add(s, 'unknown', 'alias', 'AniList synonym')
  } else if (source === 'vndb') {
    add(record.original || record.originalTitle, 'ja', 'original', 'VNDB original')
    add(record.title || record.name, 'unknown', 'localized', 'VNDB title')
    for (const s of Array.isArray(record.aliases) ? record.aliases : []) add(s, 'unknown', 'alias', 'VNDB alias')
    for (const s of Array.isArray(record.titles) ? record.titles : []) add(s?.title || s?.latin || s?.official, clean(s?.lang || 'unknown'), 'localized', 'VNDB titles')
  } else if (source === 'wikidata') {
    textValues(record.labels).forEach((x) => add(x, 'unknown', 'localized', 'Wikidata label'))
    textValues(record.aliases).forEach((x) => add(x, 'unknown', 'alias', 'Wikidata alias'))
  } else {
    textValues([record.title, record.name, record.originalTitle, record.aliases, record.localizedTitles, record.titles, record.synonyms]).forEach((x) => add(x, 'unknown', 'alias', 'generic title field'))
  }

  const localizedTitles = uniqueLocalized(localized)
  return {
    titles: unique(localizedTitles.map((x) => x.title)),
    localizedTitles,
    aliases: unique(localizedTitles.filter((x) => ['alias', 'romanized'].includes(x.kind)).map((x) => x.title)),
  }
}

function normalizeDate(raw) {
  const value = clean(raw)
  if (!value || /^0000/.test(value) || /^unknown$/i.test(value)) return null
  const ymd = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (ymd) {
    const [, y, m, d] = ymd
    const label = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    return { firstPublishedAt: label, firstPublishedPrecision: 'day', firstPublishedLabel: label, rawDate: value }
  }
  const ym = value.match(/^(\d{4})[-/.](\d{1,2})$/)
  if (ym) {
    const [, y, m] = ym
    return { firstPublishedAt: `${y}-${String(m).padStart(2, '0')}-01`, firstPublishedPrecision: 'month', firstPublishedLabel: `${y}-${String(m).padStart(2, '0')}`, rawDate: value }
  }
  const y = value.match(/^(\d{4})$/)
  if (y) return { firstPublishedAt: `${y[1]}-01-01`, firstPublishedPrecision: 'year', firstPublishedLabel: y[1], rawDate: value }
  return { firstPublishedAt: '', firstPublishedPrecision: 'unknown', firstPublishedLabel: value, rawDate: value }
}

function dateFromAniList(value) {
  if (!value || typeof value !== 'object') return null
  const year = Number(value.year || 0)
  const month = Number(value.month || 0)
  const day = Number(value.day || 0)
  if (!year) return null
  if (month && day) return normalizeDate(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  if (month) return normalizeDate(`${year}-${String(month).padStart(2, '0')}`)
  return normalizeDate(String(year))
}

function summaryCandidate(source, record) {
  if (source === 'bangumi') return clean(record.summary)
  if (source === 'anilist') return clean(record.description)
  if (source === 'vndb') return clean(record.description || record.summary)
  if (source === 'wikidata') return clean(record.description || record.descriptions)
  return clean(record.summary || record.description)
}

function dateCandidate(source, record) {
  if (source === 'bangumi') return normalizeDate(record.date || record.air_date || record.airDate)
  if (source === 'anilist') return dateFromAniList(record.startDate) || normalizeDate(record.startDate || record.date)
  if (source === 'vndb') return normalizeDate(record.released || record.date)
  return normalizeDate(record.date || record.releaseDate || record.startDate)
}

function sourceUrl(source, id, record) {
  const explicit = clean(record.url || record.siteUrl || record.site_url)
  if (explicit) return explicit
  if (source === 'bangumi' && id) return `https://bgm.tv/subject/${id}`
  if (source === 'anilist' && id) return `https://anilist.co/anime/${id}`
  if (source === 'vndb' && id) return `https://vndb.org/${id}`
  if (source === 'wikidata' && id) return `https://www.wikidata.org/wiki/${id}`
  return ''
}

function sampleRecord(record) {
  const out = {}
  for (const key of Object.keys(record || {}).slice(0, 30)) {
    const value = record[key]
    if (value == null || typeof value !== 'object') out[key] = value
    else if (Array.isArray(value)) out[key] = `[Array(${value.length})]`
    else out[key] = `{Object keys=${Object.keys(value).slice(0, 12).join(',')}}`
  }
  return out
}

function normalizedRecord(file, source, record) {
  const id = recordId(source, record)
  if (!id) return null
  const titles = titleCandidates(source, record)
  return {
    source,
    externalId: id,
    key: `${source}:${id}`,
    file,
    sourceLink: sourceUrl(source, id, record),
    titles: titles.titles,
    localizedTitles: titles.localizedTitles,
    aliases: titles.aliases,
    summary: summaryCandidate(source, record),
    date: dateCandidate(source, record),
    rawKeys: Object.keys(record || {}).slice(0, 80),
    rawSample: sampleRecord(record),
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}\n${JSON.stringify(payload, null, 2)}`)
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

function sourceKeysFromString(value) {
  const text = clean(value)
  const keys = []
  if (!text) return keys

  for (const source of SOURCE_NAMES) {
    const direct = text.match(new RegExp(`^${source}[-_:](.+)$`, 'i'))
    if (direct?.[1]) keys.push(`${source}:${direct[1]}`)
    const tail = text.match(new RegExp(`(?:^|[-_])${source}[-_:]([A-Za-z0-9]+)$`, 'i'))
    if (tail?.[1]) keys.push(`${source}:${tail[1]}`)
  }
  return keys
}

function workKeys(doc) {
  const keys = []
  const ext = doc.externalIds || {}
  if (ext.bangumiSubjectId) keys.push(`bangumi:${clean(ext.bangumiSubjectId)}`)
  if (ext.anilistMediaId) keys.push(`anilist:${clean(ext.anilistMediaId)}`)
  if (ext.vndbId) keys.push(`vndb:${clean(ext.vndbId)}`)
  if (ext.wikidataQid) keys.push(`wikidata:${clean(ext.wikidataQid)}`)
  if (ext.malId) keys.push(`mal:${clean(ext.malId)}`)
  for (const source of Array.isArray(doc.candidateSources) ? doc.candidateSources : []) {
    const name = clean(source?.source)
    const id = clean(source?.externalId)
    if (name && id) keys.push(`${name}:${id}`)
  }
  keys.push(...sourceKeysFromString(doc.siteId))
  keys.push(...sourceKeysFromString(doc.slug))
  return unique(keys)
}

function currentLocalizedTitles(doc) {
  return Array.isArray(doc.localizedTitles) ? doc.localizedTitles.map((x) => clean(typeof x === 'string' ? x : x?.title)).filter(Boolean) : []
}

function currentAliases(doc) {
  return Array.isArray(doc.aliases) ? doc.aliases.map((x) => clean(typeof x === 'string' ? x : x?.value)).filter(Boolean) : []
}

function uniqueSourceLinks(rows) {
  const seen = new Set()
  const out = []
  for (const row of rows) {
    const url = clean(row.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ label: clean(row.label), url })
  }
  return out
}

function uniqueCandidateSources(rows) {
  const seen = new Set()
  const out = []
  for (const row of rows) {
    const key = [row.source, row.externalId, row.url].map(clean).join('|').toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

function mergePlanForWork(doc, records) {
  const existingTitles = unique([doc.title, doc.originalTitle, currentLocalizedTitles(doc), currentAliases(doc)])
  const existingKey = new Set(existingTitles.map((x) => lower(x)))
  const addLocalizedTitles = []
  const addAliases = []
  const addSourceLinks = []
  const addCandidateSources = []
  const summaries = []
  const dates = []

  for (const record of records) {
    for (const title of record.localizedTitles) {
      if (!existingKey.has(lower(title.title))) addLocalizedTitles.push(title)
    }
    for (const title of record.aliases) {
      if (!existingKey.has(lower(title))) addAliases.push({ value: title })
    }
    if (record.sourceLink) addSourceLinks.push({ label: `${record.source}:${record.externalId}`, url: record.sourceLink })
    addCandidateSources.push({ source: record.source, label: `${record.source}:${record.externalId}`, externalId: record.externalId, url: record.sourceLink, note: `source metadata plan ${VERSION}` })
    if (record.summary) summaries.push({ source: record.source, externalId: record.externalId, summary: record.summary })
    if (record.date) dates.push({ source: record.source, externalId: record.externalId, ...record.date })
  }

  const preferredDate = dates.find((x) => x.source === 'bangumi' && x.firstPublishedPrecision === 'day')
    || dates.find((x) => x.firstPublishedPrecision === 'day')
    || dates.find((x) => x.firstPublishedPrecision === 'month')
    || dates.find((x) => x.firstPublishedPrecision === 'year')
    || dates[0]
    || null
  const preferredSummary = summaries.find((x) => x.source === 'bangumi') || summaries.find((x) => x.summary) || null

  const additions = {
    localizedTitles: uniqueLocalized(addLocalizedTitles),
    aliases: unique(addAliases.map((x) => x.value)).map((value) => ({ value })),
    sourceLinks: uniqueSourceLinks(addSourceLinks),
    candidateSources: uniqueCandidateSources(addCandidateSources),
    summary: preferredSummary,
    date: preferredDate,
  }
  const changedFields = []
  if (additions.localizedTitles.length) changedFields.push('localizedTitles')
  if (additions.aliases.length) changedFields.push('aliases')
  if (additions.sourceLinks.length) changedFields.push('sourceLinks')
  if (additions.candidateSources.length) changedFields.push('candidateSources')
  if (additions.summary?.summary) changedFields.push('summary')
  if (additions.date) changedFields.push('firstPublishedAt')

  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    siteId: doc.siteId,
    keys: workKeys(doc),
    matchedRecords: records.map((x) => ({ source: x.source, externalId: x.externalId, file: x.file, titles: x.titles.slice(0, 8), date: x.date, hasSummary: Boolean(x.summary) })),
    additions,
    changedFields,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const includeDrafts = Boolean(args['include-drafts'])
  const roots = String(args.roots || '').split(';').map(clean).filter(Boolean)
  const scanRoots = (roots.length ? roots : DEFAULT_ROOTS).filter((root) => fs.existsSync(root))
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const maxFiles = Number(args['max-files'] || 0)
  const maxRecordsPerFile = Number(args['max-records-per-file'] || 0)
  const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const secret = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD

  let token = null
  if (email && secret) token = await login(baseUrl, email, secret)

  let files = scanRoots.flatMap((root) => walk(root)).filter((file) => /bangumi|anilist|vndb|wikidata|mangadex|steam|subject|media/i.test(file))
  files = files.sort((a, b) => sourceFromPath(a).localeCompare(sourceFromPath(b)) || a.localeCompare(b))
  if (maxFiles > 0) files = files.slice(0, maxFiles)

  const sourceRecords = new Map()
  const sourceRecordRows = []
  const fileStats = []

  for (const file of files) {
    let read = 0
    let accepted = 0
    const bySource = {}
    for await (const rawRecord of readRecords(file)) {
      read += 1
      if (maxRecordsPerFile && read > maxRecordsPerFile) break
      if (!rawRecord || typeof rawRecord !== 'object') continue
      const source = inferSource(file, rawRecord)
      if (source === 'unknown') continue
      const normalized = normalizedRecord(file, source, rawRecord)
      if (!normalized) continue
      if (!sourceRecords.has(normalized.key)) sourceRecords.set(normalized.key, [])
      sourceRecords.get(normalized.key).push(normalized)
      sourceRecordRows.push(normalized)
      accepted += 1
      bySource[source] = (bySource[source] || 0) + 1
    }
    if (read || accepted) fileStats.push({ file, sourceFromPath: sourceFromPath(file) || 'unknown', read, accepted, bySource })
  }

  const works = await fetchWorks(baseUrl, token, includeDrafts)
  const plans = []
  const unmatchedWorks = []

  for (const doc of works.docs) {
    const keys = workKeys(doc)
    const matches = keys.flatMap((key) => sourceRecords.get(key) || [])
    if (!matches.length) {
      unmatchedWorks.push({ id: doc.id, slug: doc.slug, title: doc.title, siteId: doc.siteId, keys })
      continue
    }
    const plan = mergePlanForWork(doc, matches)
    if (plan.changedFields.length) plans.push(plan)
  }

  const outputs = {
    plans: path.join(outDir, 'work-source-metadata-enrichment-v02-plans.jsonl'),
    unmatched: path.join(outDir, 'work-source-metadata-enrichment-v02-unmatched.jsonl'),
    files: path.join(outDir, 'work-source-metadata-enrichment-v02-files.json'),
    summary: path.join(outDir, 'work-source-metadata-enrichment-v02-summary.json'),
    json: path.join(outDir, 'work-source-metadata-enrichment-v02.json'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: true,
    payloadBaseUrl: baseUrl,
    mode: includeDrafts ? 'drafts-and-published' : 'published-only',
    scanRoots,
    filesScanned: files.length,
    sourceRecordRows: sourceRecordRows.length,
    sourceRecordKeys: sourceRecords.size,
    bySourceRecord: countBy(sourceRecordRows, 'source'),
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    plannedWorks: plans.length,
    unmatchedWorks: unmatchedWorks.length,
    byChangedField: countBy(plans.flatMap((x) => x.changedFields), (x) => x),
    byMatchedSource: countBy(plans.flatMap((x) => x.matchedRecords.map((r) => r.source)), (x) => x),
    summaryCandidates: plans.filter((x) => x.additions.summary?.summary).length,
    dateCandidates: plans.filter((x) => x.additions.date).length,
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
  fs.writeFileSync(outputs.plans, plans.map((x) => JSON.stringify(x)).join('\n') + (plans.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.unmatched, unmatchedWorks.map((x) => JSON.stringify(x)).join('\n') + (unmatchedWorks.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.files, JSON.stringify(fileStats, null, 2), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify({ ok: true, summary, samples: { plans: plans.slice(0, 20), unmatched: unmatchedWorks.slice(0, 20), files: fileStats.slice(0, 20) } }, null, 2), 'utf8')

  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
