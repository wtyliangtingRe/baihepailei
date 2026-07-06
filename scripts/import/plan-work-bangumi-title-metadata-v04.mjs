#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const VERSION = 'work-bangumi-title-metadata-plan-v0.4'
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

function titleKey(value) {
  return clean(value).toLowerCase()
}

function uniqueStrings(values) {
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

async function* readRows(file) {
  if (/\.(jsonl|ndjson)$/i.test(file)) {
    const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
    for await (const line of rl) {
      const body = line.trim()
      if (!body) continue
      try {
        yield JSON.parse(body)
      } catch {}
    }
    return
  }

  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return
  let json = null
  try {
    json = JSON.parse(raw)
  } catch {
    return
  }
  if (Array.isArray(json)) {
    for (const item of json) yield item
    return
  }
  for (const key of ['data', 'items', 'subjects', 'docs', 'results', 'records']) {
    if (Array.isArray(json?.[key])) {
      for (const item of json[key]) yield item
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
    for (const key of ['raw', 'subject', 'candidate', 'data', 'item']) {
      if (value[key]) push(value[key], `${pathName}.${key}`, value)
    }
  }
  push(row, '$', row)
  return out
}

function recordId(record, wrapper = {}) {
  return clean(record.id || record.subject_id || record.subjectId || record.bangumiSubjectId || wrapper.sourceRecordId)
}

function sourceUrl(id, wrapper = {}, record = {}) {
  const explicit = clean(wrapper.sourceUrl || record.url || record.siteUrl || record.site_url)
  if (explicit) return explicit
  return id ? `https://bgm.tv/subject/${id}` : ''
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
    for (const key of ['title', 'name', 'value', 'text', 'label', 'native', 'romaji', 'english', 'chinese', 'japanese', 'zh', 'ja', 'en']) {
      if (key in value) textValues(value[key], out)
    }
  }
  return out
}

function infoboxRows(record, keyPattern) {
  const rows = Array.isArray(record.infobox) ? record.infobox : []
  return rows.filter((row) => keyPattern.test(clean(row?.key)))
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

function localizedTitlesOf(record) {
  const rows = []
  const add = (title, language, kind, note) => {
    const value = clean(title)
    if (!value || isMojibake(value)) return
    rows.push({ title: value, language, kind, source: 'bangumi', note })
  }

  add(record.name, 'ja', 'original', 'Bangumi name')
  add(record.name_jp, 'ja', 'original', 'Bangumi name_jp')
  add(record.name_cn, 'zh-Hans', 'localized', 'Bangumi name_cn')
  add(record.name_en, 'en', 'localized', 'Bangumi name_en')

  for (const row of infoboxRows(record, /中文名/i)) add(row?.value, 'zh-Hans', 'localized', 'Bangumi infobox 中文名')
  for (const row of infoboxRows(record, /别名|別名|别称|別稱|alias/i)) {
    for (const value of textValues(row?.value)) add(value, 'unknown', 'alias', 'Bangumi infobox alias')
  }
  for (const alias of Array.isArray(record.aliases) ? record.aliases : []) add(alias, 'unknown', 'alias', 'Bangumi alias')

  return uniqueLocalized(rows)
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

function normalizeRecord(file, wrapper, record, pathName) {
  const id = recordId(record, wrapper)
  if (!id) return null
  const localizedTitles = localizedTitlesOf(record)
  const summary = clean(record.summary)
  return {
    source: 'bangumi',
    externalId: id,
    key: `bangumi:${id}`,
    file,
    pathName,
    sourceLink: sourceUrl(id, wrapper, record),
    titles: uniqueStrings(localizedTitles.map((row) => row.title)),
    localizedTitles,
    aliases: uniqueStrings(localizedTitles.filter((row) => ['alias', 'romanized'].includes(row.kind)).map((row) => row.title)),
    summary: isMojibake(summary) ? '' : summary,
    date: normalizeDate(record.date || record.air_date || record.airDate),
    skippedMojibake: {
      name: Boolean(record.name && isMojibake(record.name)),
      name_cn: Boolean(record.name_cn && isMojibake(record.name_cn)),
      summary: Boolean(summary && isMojibake(summary)),
    },
  }
}

function uniqueRecords(records) {
  const seen = new Set()
  const out = []
  for (const record of records.filter(Boolean)) {
    if (!record || typeof record !== 'object') continue
    const key = [record.key, record.sourceLink, record.file, record.pathName].map(clean).join('|').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(record)
  }
  return out
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

function bangumiKeysFromString(value) {
  const text = clean(value)
  const keys = []
  if (!text) return keys
  const patterns = [/^bangumi[-_:](\d+)$/i, /(?:^|[-_])bangumi[-_:](\d+)$/i, /(?:^|[-_])bgm[-_:](\d+)$/i, /bgm\.tv\/subject\/(\d+)/i, /bangumi\.tv\/subject\/(\d+)/i]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) keys.push(`bangumi:${match[1]}`)
  }
  return uniqueStrings(keys)
}

function workKeys(doc) {
  const keys = []
  const ext = doc.externalIds || {}
  if (ext.bangumiSubjectId) keys.push(`bangumi:${clean(ext.bangumiSubjectId)}`)
  for (const source of Array.isArray(doc.candidateSources) ? doc.candidateSources : []) {
    if (clean(source?.source).toLowerCase() === 'bangumi' && clean(source?.externalId)) keys.push(`bangumi:${clean(source.externalId)}`)
    keys.push(...bangumiKeysFromString(source?.url))
  }
  for (const link of Array.isArray(doc.sourceLinks) ? doc.sourceLinks : []) keys.push(...bangumiKeysFromString(link?.url || link))
  keys.push(...bangumiKeysFromString(doc.siteId))
  keys.push(...bangumiKeysFromString(doc.slug))
  return uniqueStrings(keys)
}

function currentLocalizedTitles(doc) {
  return Array.isArray(doc.localizedTitles) ? doc.localizedTitles.map((x) => clean(typeof x === 'string' ? x : x?.title)).filter(Boolean) : []
}

function currentAliases(doc) {
  return Array.isArray(doc.aliases) ? doc.aliases.map((x) => clean(typeof x === 'string' ? x : x?.value)).filter(Boolean) : []
}

function titleKeysOfWork(doc) {
  return uniqueStrings([doc.title, doc.originalTitle, currentLocalizedTitles(doc), currentAliases(doc)])
    .map((x) => x.toLowerCase())
    .filter((x) => x.length >= 2 && !isMojibake(x))
}

function planForWork(doc, records, matchMode) {
  const safeRecords = uniqueRecords(records)
  const existing = new Set(titleKeysOfWork(doc))
  const addLocalizedTitles = []
  const addAliases = []
  const addSourceLinks = []
  const addCandidateSources = []
  const summaries = []
  const dates = []

  for (const record of safeRecords) {
    for (const row of Array.isArray(record.localizedTitles) ? record.localizedTitles : []) {
      const key = titleKey(row.title)
      if (key && !existing.has(key)) addLocalizedTitles.push({ ...row, note: `${row.note}; match=${matchMode}` })
    }
    for (const alias of Array.isArray(record.aliases) ? record.aliases : []) {
      const key = titleKey(alias)
      if (key && !existing.has(key)) addAliases.push({ value: alias })
    }
    if (record.sourceLink) addSourceLinks.push({ label: `Bangumi:${record.externalId}`, url: record.sourceLink })
    addCandidateSources.push({ source: 'bangumi', label: `Bangumi:${record.externalId}`, externalId: record.externalId, url: record.sourceLink, note: `${VERSION}; match=${matchMode}` })
    if (record.summary) summaries.push({ source: 'bangumi', externalId: record.externalId, summary: record.summary })
    if (record.date) dates.push({ source: 'bangumi', externalId: record.externalId, ...record.date })
  }

  const additions = {
    localizedTitles: uniqueLocalized(addLocalizedTitles),
    aliases: uniqueStrings(addAliases.map((x) => x.value)).map((value) => ({ value })),
    sourceLinks: uniqueSourceLinks(addSourceLinks),
    candidateSources: uniqueCandidateSources(addCandidateSources),
    summary: summaries[0] || null,
    date: dates.find((x) => x.firstPublishedPrecision === 'day') || dates[0] || null,
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
    matchMode,
    keys: workKeys(doc),
    matchedRecords: safeRecords.map((record) => ({ source: 'bangumi', externalId: record.externalId, file: record.file, pathName: record.pathName, titles: record.titles.slice(0, 8), date: record.date, hasSummary: Boolean(record.summary), skippedMojibake: record.skippedMojibake })),
    additions,
    changedFields,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const includeDrafts = Boolean(args['include-drafts'])
  const explicitRoots = String(args.roots || '').split(';').map(clean).filter(Boolean)
  const scanRoots = (explicitRoots.length ? explicitRoots : DEFAULT_ROOTS).filter((root) => fs.existsSync(root))
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const maxFiles = Number(args['max-files'] || 0)
  const maxRecordsPerFile = Number(args['max-records-per-file'] || 0)
  const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const secret = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD

  let token = null
  if (email && secret) token = await login(baseUrl, email, secret)

  let files = scanRoots.flatMap((root) => walk(root)).filter((file) => /bangumi|bgm|subject/i.test(file)).sort((a, b) => a.localeCompare(b))
  if (maxFiles > 0) files = files.slice(0, maxFiles)

  const records = []
  const byId = new Map()
  const byTitle = new Map()
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
        const normalized = normalizeRecord(file, outer, record, pathName)
        if (!normalized) continue
        if (pathName !== '$') wrappedRecords += 1
        if (Object.values(normalized.skippedMojibake).some(Boolean)) mojibakeRecords += 1
        records.push(normalized)
        if (!byId.has(normalized.key)) byId.set(normalized.key, [])
        byId.get(normalized.key).push(normalized)
        for (const title of normalized.titles) {
          const key = titleKey(title)
          if (!key) continue
          if (!byTitle.has(key)) byTitle.set(key, [])
          byTitle.get(key).push(normalized)
        }
        accepted += 1
      }
    }
    if (read || accepted) fileStats.push({ file, read, unwrapped, accepted })
  }

  const works = await fetchWorks(baseUrl, token, includeDrafts)
  const plans = []
  const deferred = []
  const unmatched = []

  for (const doc of works.docs) {
    const keyMatches = uniqueRecords(workKeys(doc).flatMap((key) => byId.get(key) || []))
    if (keyMatches.length) {
      const plan = planForWork(doc, keyMatches, 'external_id')
      if (plan.changedFields.length) plans.push(plan)
      continue
    }

    const titleMatches = uniqueRecords(titleKeysOfWork(doc).flatMap((key) => byTitle.get(key) || []))
    if (titleMatches.length) {
      const ids = uniqueStrings(titleMatches.map((record) => record.externalId))
      const matchMode = ids.length === 1 ? 'title_exact' : 'title_exact_multi'
      const plan = planForWork(doc, titleMatches, matchMode)
      if (ids.length === 1) {
        if (plan.changedFields.length) plans.push(plan)
      } else {
        deferred.push({ ...plan, deferReason: 'title_exact_multi_external_ids' })
      }
      continue
    }

    unmatched.push({ id: doc.id, slug: doc.slug, title: doc.title, siteId: doc.siteId, keys: workKeys(doc), titleKeys: titleKeysOfWork(doc) })
  }

  const outputs = {
    plans: path.join(outDir, 'work-bangumi-title-metadata-v04-plans.jsonl'),
    deferred: path.join(outDir, 'work-bangumi-title-metadata-v04-deferred.jsonl'),
    unmatched: path.join(outDir, 'work-bangumi-title-metadata-v04-unmatched.jsonl'),
    files: path.join(outDir, 'work-bangumi-title-metadata-v04-files.json'),
    summary: path.join(outDir, 'work-bangumi-title-metadata-v04-summary.json'),
    json: path.join(outDir, 'work-bangumi-title-metadata-v04.json'),
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: true,
    payloadBaseUrl: baseUrl,
    mode: includeDrafts ? 'drafts-and-published' : 'published-only',
    scanRoots,
    filesScanned: files.length,
    bangumiRecords: records.length,
    wrappedRecords,
    mojibakeRecords,
    bangumiIdKeys: byId.size,
    bangumiTitleKeys: byTitle.size,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    plannedWorks: plans.length,
    deferredWorks: deferred.length,
    unmatchedWorks: unmatched.length,
    byMatchMode: countBy(plans, 'matchMode'),
    byChangedField: countBy(plans.flatMap((plan) => plan.changedFields), (value) => value),
    summaryCandidates: plans.filter((plan) => plan.additions.summary?.summary).length,
    dateCandidates: plans.filter((plan) => plan.additions.date).length,
    outputs,
    safety: { readOnly: true, localSourceRead: true, payloadRead: true, payloadWrite: false, directPostgresqlWrite: false, dataChanged: false },
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.plans, plans.map((item) => JSON.stringify(item)).join('\n') + (plans.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.deferred, deferred.map((item) => JSON.stringify(item)).join('\n') + (deferred.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.unmatched, unmatched.map((item) => JSON.stringify(item)).join('\n') + (unmatched.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.files, JSON.stringify(fileStats, null, 2), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify({ ok: true, summary, samples: { plans: plans.slice(0, 20), deferred: deferred.slice(0, 20), unmatched: unmatched.slice(0, 20), files: fileStats.slice(0, 20) } }, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
