#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const VERSION = 'bangumi-credits-plan-v0.1'
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
    else { args[key] = next; i += 1 }
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
  if (Array.isArray(json)) { for (const item of json) yield item; return }
  for (const k of ['data', 'items', 'subjects', 'docs', 'results', 'records']) {
    if (Array.isArray(json?.[k])) { for (const item of json[k]) yield item; return }
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
    if (Array.isArray(value)) { value.forEach((item, index) => push(item, `${pathName}[${index}]`, wrapper)); return }
    if (isSubjectLike(value)) out.push({ record: value, pathName, wrapper: wrapper || value })
    for (const k of ['raw', 'subject', 'candidate', 'data', 'item']) if (value[k]) push(value[k], `${pathName}.${k}`, value)
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
  if (Array.isArray(value)) { for (const item of value) textValues(item, out); return out }
  if (typeof value === 'object') {
    for (const k of ['title', 'name', 'value', 'text', 'label', 'native', 'romaji', 'english', 'chinese', 'japanese', 'zh', 'ja', 'en']) {
      if (k in value) textValues(value[k], out)
    }
  }
  return out
}

function splitNames(values) {
  const out = []
  for (const value of values) {
    const text = clean(value)
    if (!text) continue
    const parts = text
      .replaceAll('，', '、')
      .replaceAll(',', '、')
      .replaceAll(';', '、')
      .replaceAll('；', '、')
      .replaceAll('／', '/')
      .split(/[、/]/u)
      .map((x) => clean(x.replace(/^\[|\]$/g, '')))
      .filter(Boolean)
    out.push(...parts)
  }
  return uniqueStrings(out).filter((name) => !isBadName(name))
}

function isBadName(name) {
  const text = clean(name)
  if (!text || text.length < 2) return true
  if (/^(unknown|n\/a|none|无|なし|不明|待定|tba)$/i.test(text)) return true
  if (/^\d{4}([-.年/]|$)/.test(text)) return true
  if (/^https?:\/\//i.test(text)) return true
  if (/[\[\]{}]/.test(text)) return true
  return false
}

function rawTitles(record) {
  const infobox = Array.isArray(record.infobox) ? record.infobox : []
  const fromInfobox = []
  for (const row of infobox) {
    if (/中文名|别名|別名|别称|別稱|alias/i.test(clean(row?.key))) fromInfobox.push(...textValues(row?.value))
  }
  return uniqueStrings([record.name, record.name_cn, record.name_jp, record.name_en, Array.isArray(record.aliases) ? record.aliases : [], fromInfobox])
}

function creatorRoleFor(rawKey) {
  const k = clean(rawKey)
  if (/总监督|總監督|総監督/.test(k)) return 'chief_director'
  if (/系列监督|系列監督|シリーズディレクター/.test(k)) return 'series_director'
  if (/监督|監督|导演|導演/.test(k)) return 'director'
  if (/系列构成|系列構成|シリーズ構成/.test(k)) return 'series_composition'
  if (/脚本|劇本|シナリオ/.test(k)) return 'script'
  if (/角色原案|人物原案|キャラクター原案/.test(k)) return 'character_original_design'
  if (/角色设计|人物设定|人物設定|キャラクターデザイン/.test(k)) return 'character_design'
  if (/原案/.test(k)) return 'original_concept'
  if (/原作|作者|作画|漫画|漫畫|著者|イラスト|插图|插畫|绘|绘制|画/.test(k)) return 'original_creator'
  if (/制作人|製作人|プロデューサー/.test(k)) return 'producer'
  return 'other'
}

function organizationRoleFor(rawKey) {
  const k = clean(rawKey)
  if (/动画制作|動畫製作|动画制片|アニメーション制作|制作会社/.test(k)) return 'animation_studio'
  if (/出版社|出版/.test(k)) return 'publisher'
  if (/发行|發行|配給|发行商|發行商/.test(k)) return 'distributor'
  if (/开发|開發|开发商|開発元|デベロッパー/.test(k)) return 'game_developer'
  if (/品牌|ブランド/.test(k)) return 'brand'
  if (/平台|掲載誌|连载杂志|連載雑誌|連載誌|放送|电视台|電視台/.test(k)) return 'platform'
  if (/音乐制作|音楽制作|音乐|音樂/.test(k)) return 'music_label'
  if (/制作委员会|製作委員会/.test(k)) return 'committee'
  if (/制作|製作|企画|企劃/.test(k)) return 'production_company'
  return 'other'
}

function organizationTypeFor(role) {
  if (role === 'publisher') return 'publisher'
  if (role === 'animation_studio') return 'animation_studio'
  if (role === 'game_developer') return 'game_company'
  if (role === 'distributor') return 'distributor'
  if (role === 'brand') return 'brand'
  if (role === 'platform') return 'platform'
  if (role === 'committee') return 'committee'
  if (role === 'production_company') return 'production_company'
  return 'other'
}

function isCreatorKey(rawKey) {
  return /原作|原案|作者|作画|漫画|漫畫|著者|イラスト|插图|插畫|监督|監督|导演|導演|脚本|劇本|系列构成|系列構成|角色原案|人物原案|角色设计|人物设定|人物設定|キャラクター|制作人|製作人|プロデューサー/.test(clean(rawKey))
}

function isOrganizationKey(rawKey) {
  return /出版社|出版|动画制作|動畫製作|アニメーション制作|制作会社|制作|製作|发行|發行|配給|开发|開發|開発元|品牌|ブランド|平台|掲載誌|连载杂志|連載雑誌|連載誌|放送|电视台|電視台|音乐制作|音楽制作|制作委员会|製作委員会/.test(clean(rawKey))
}

function extractCredits(record) {
  const creators = []
  const organizations = []
  const infobox = Array.isArray(record.infobox) ? record.infobox : []
  for (const row of infobox) {
    const rawKey = clean(row?.key)
    if (!rawKey) continue
    const names = splitNames(textValues(row?.value))
    if (!names.length) continue
    if (isCreatorKey(rawKey)) {
      const role = creatorRoleFor(rawKey)
      for (const name of names) creators.push({ name, role, originalRole: rawKey, source: 'bangumi' })
    }
    if (isOrganizationKey(rawKey)) {
      const role = organizationRoleFor(rawKey)
      const type = organizationTypeFor(role)
      for (const name of names) organizations.push({ name, role, type, originalRole: rawKey, source: 'bangumi' })
    }
  }
  return {
    creators: uniqueBy(creators, (x) => `${key(x.name)}|${x.role}|${key(x.originalRole)}`),
    organizations: uniqueBy(organizations, (x) => `${key(x.name)}|${x.role}|${key(x.originalRole)}`),
  }
}

function uniqueBy(rows, keyFn) {
  const seen = new Set()
  const out = []
  for (const row of rows) {
    const k = keyFn(row)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(row)
  }
  return out
}

function bangumiIdsFromString(value) {
  const text = clean(value)
  if (!text) return []
  const out = []
  const patterns = [/^bangumi[-_:](\d+)$/i, /(?:^|[-_])bangumi[-_:](\d+)$/i, /(?:^|[-_])bgm[-_:](\d+)$/i, /bgm\.tv\/subject\/(\d+)/i, /bangumi\.tv\/subject\/(\d+)/i]
  for (const pattern of patterns) { const m = text.match(pattern); if (m?.[1]) out.push(m[1]) }
  return uniqueStrings(out)
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

function entityNameKeys(doc) {
  return uniqueStrings([
    doc.name,
    Array.isArray(doc.aliases) ? doc.aliases.map((x) => typeof x === 'string' ? x : x?.value) : [],
    Array.isArray(doc.localizedNames) ? doc.localizedNames.map((x) => typeof x === 'string' ? x : x?.name) : [],
  ]).map(key).filter(Boolean)
}

function workTitleKeys(doc) {
  return uniqueStrings([
    doc.title,
    doc.originalTitle,
    Array.isArray(doc.localizedTitles) ? doc.localizedTitles.map((x) => typeof x === 'string' ? x : x?.title) : [],
    Array.isArray(doc.aliases) ? doc.aliases.map((x) => typeof x === 'string' ? x : x?.value) : [],
  ]).map(key).filter((x) => x.length >= 2)
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

async function fetchCollection(baseUrl, token, collection, includeDrafts) {
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
    const result = await requestJson(`${baseUrl}/api/${collection}?${params.toString()}`, { headers: authHeaders(token) })
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

  const rawById = new Map()
  const rawByTitle = new Map()
  const fileStats = []
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
        const credits = extractCredits(record)
        const row = { id, titles, file, pathName, creators: credits.creators, organizations: credits.organizations }
        if (!rawById.has(id)) rawById.set(id, row)
        else {
          const prev = rawById.get(id)
          prev.titles = uniqueStrings([prev.titles, titles])
          prev.creators = uniqueBy([...prev.creators, ...credits.creators], (x) => `${key(x.name)}|${x.role}|${key(x.originalRole)}`)
          prev.organizations = uniqueBy([...prev.organizations, ...credits.organizations], (x) => `${key(x.name)}|${x.role}|${key(x.originalRole)}`)
        }
        for (const title of titles) {
          const k = key(title)
          if (!rawByTitle.has(k)) rawByTitle.set(k, new Set())
          rawByTitle.get(k).add(id)
        }
        accepted += 1
      }
    }
    if (read || accepted) fileStats.push({ file, read, accepted })
  }
  return { scanRoots, files, rawById, rawByTitle, fileStats }
}

function resolveEntity(name, byName) {
  const matches = byName.get(key(name)) || []
  if (matches.length === 1) return { status: 'existing', doc: matches[0] }
  if (matches.length > 1) return { status: 'ambiguous', docs: matches }
  return { status: 'create' }
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
  const works = await fetchCollection(baseUrl, token, 'works', includeDrafts)
  const creators = await fetchCollection(baseUrl, token, 'creators', includeDrafts)
  const organizations = await fetchCollection(baseUrl, token, 'organizations', includeDrafts)

  const creatorByName = new Map()
  for (const doc of creators.docs) for (const k of entityNameKeys(doc)) {
    if (!creatorByName.has(k)) creatorByName.set(k, [])
    creatorByName.get(k).push(doc)
  }
  const orgByName = new Map()
  for (const doc of organizations.docs) for (const k of entityNameKeys(doc)) {
    if (!orgByName.has(k)) orgByName.set(k, [])
    orgByName.get(k).push(doc)
  }

  const worksByBangumi = new Map()
  const worksByTitle = new Map()
  for (const doc of works.docs) {
    for (const id of bangumiIdsOfWork(doc)) {
      if (!worksByBangumi.has(id)) worksByBangumi.set(id, [])
      worksByBangumi.get(id).push(doc)
    }
    for (const t of workTitleKeys(doc)) {
      if (!worksByTitle.has(t)) worksByTitle.set(t, [])
      worksByTitle.get(t).push(doc)
    }
  }

  const rows = []
  const creatorsToCreate = new Map()
  const orgsToCreate = new Map()
  const blocked = []

  for (const raw of bangumi.rawById.values()) {
    const externalMatches = worksByBangumi.get(raw.id) || []
    const titleMatchSet = new Map()
    for (const title of raw.titles.map(key)) for (const doc of worksByTitle.get(title) || []) titleMatchSet.set(doc.id, doc)
    const titleMatches = Array.from(titleMatchSet.values())
    const matchedWorks = externalMatches.length ? externalMatches : titleMatches.length === 1 ? titleMatches : []
    const matchMode = externalMatches.length ? 'external_id' : titleMatches.length === 1 ? 'title_exact' : titleMatches.length > 1 ? 'title_exact_multi' : 'unmatched'
    if (!matchedWorks.length) {
      if (raw.creators.length || raw.organizations.length) blocked.push({ bangumiId: raw.id, titles: raw.titles, matchMode, creators: raw.creators, organizations: raw.organizations })
      continue
    }
    for (const work of matchedWorks) {
      const creatorCredits = []
      const organizationCredits = []
      for (const credit of raw.creators) {
        const resolved = resolveEntity(credit.name, creatorByName)
        if (resolved.status === 'create') creatorsToCreate.set(key(credit.name), { name: credit.name, source: 'bangumi', sampleRole: credit.originalRole })
        creatorCredits.push({ ...credit, resolvedStatus: resolved.status, existingId: resolved.doc?.id || '', existingName: resolved.doc?.name || '' })
      }
      for (const credit of raw.organizations) {
        const resolved = resolveEntity(credit.name, orgByName)
        if (resolved.status === 'create') orgsToCreate.set(key(credit.name), { name: credit.name, type: credit.type, source: 'bangumi', sampleRole: credit.originalRole })
        organizationCredits.push({ ...credit, resolvedStatus: resolved.status, existingId: resolved.doc?.id || '', existingName: resolved.doc?.name || '' })
      }
      if (creatorCredits.length || organizationCredits.length) rows.push({ workId: work.id, slug: work.slug, title: work.title, bangumiId: raw.id, matchMode, creatorCredits, organizationCredits })
    }
  }

  const outputs = {
    rows: path.join(outDir, 'bangumi-credits-plan-v01.rows.jsonl'),
    creatorsToCreate: path.join(outDir, 'bangumi-credits-plan-v01-creators-to-create.jsonl'),
    organizationsToCreate: path.join(outDir, 'bangumi-credits-plan-v01-organizations-to-create.jsonl'),
    blocked: path.join(outDir, 'bangumi-credits-plan-v01-blocked.jsonl'),
    summary: path.join(outDir, 'bangumi-credits-plan-v01-summary.json'),
    json: path.join(outDir, 'bangumi-credits-plan-v01.json'),
    files: path.join(outDir, 'bangumi-credits-plan-v01-files.json'),
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: true,
    payloadBaseUrl: baseUrl,
    mode: includeDrafts ? 'drafts-and-published' : 'published-only',
    filesScanned: bangumi.files.length,
    bangumiUniqueIds: bangumi.rawById.size,
    worksRead: works.docs.length,
    creatorsRead: creators.docs.length,
    organizationsRead: organizations.docs.length,
    plannedWorks: rows.length,
    creatorCreditRows: rows.flatMap((row) => row.creatorCredits).length,
    organizationCreditRows: rows.flatMap((row) => row.organizationCredits).length,
    creatorsToCreate: creatorsToCreate.size,
    organizationsToCreate: orgsToCreate.size,
    blockedRawSubjects: blocked.length,
    byWorkMatchMode: countBy(rows, 'matchMode'),
    byCreatorRole: countBy(rows.flatMap((row) => row.creatorCredits), 'role'),
    byOrganizationRole: countBy(rows.flatMap((row) => row.organizationCredits), 'role'),
    byCreatorResolveStatus: countBy(rows.flatMap((row) => row.creatorCredits), 'resolvedStatus'),
    byOrganizationResolveStatus: countBy(rows.flatMap((row) => row.organizationCredits), 'resolvedStatus'),
    outputs,
    safety: { readOnly: true, localSourceRead: true, payloadRead: true, payloadWrite: false, directPostgresqlWrite: false, dataChanged: false },
  }

  const createRows = Array.from(creatorsToCreate.values()).sort((a, b) => a.name.localeCompare(b.name))
  const orgRows = Array.from(orgsToCreate.values()).sort((a, b) => a.name.localeCompare(b.name))
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.rows, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.creatorsToCreate, createRows.map((row) => JSON.stringify(row)).join('\n') + (createRows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.organizationsToCreate, orgRows.map((row) => JSON.stringify(row)).join('\n') + (orgRows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.blocked, blocked.map((row) => JSON.stringify(row)).join('\n') + (blocked.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.files, JSON.stringify(bangumi.fileStats, null, 2), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify({ ok: true, summary, samples: { rows: rows.slice(0, 30), creatorsToCreate: createRows.slice(0, 30), organizationsToCreate: orgRows.slice(0, 30), blocked: blocked.slice(0, 30) } }, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
