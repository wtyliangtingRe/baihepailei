#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/work-merge/work-merge-plan-v02-review.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const PAGE_LIMIT = 200
const VERSION = 'work-merge-review-rerank-v0.1'
const EXPORT_EMAIL_ENV = 'PAYLOAD_EXPORT_EMAIL'
const EXPORT_SECRET_ENV = ['PAYLOAD_EXPORT', 'PASSWORD'].join('_')
const SEED_EMAIL_ENV = 'PAYLOAD_SEED_EMAIL'
const SEED_SECRET_ENV = ['PAYLOAD_SEED', 'PASSWORD'].join('_')

const val = (v) => String(v ?? '').trim()
const normUrl = (v) => val(v).replace(/\/$/u, '')
const compact = (v) => val(v).normalize('NFKC').toLowerCase().replace(/[\s\-_.:：・·~～!！?？'"“”‘’()[\]{}<>《》「」『』【】@＠&]+/gu, '').replace(/[^\p{L}\p{N}]+/gu, '')

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i]
    if (!k.startsWith('--')) continue
    const n = argv[i + 1]
    if (!n || n.startsWith('--')) args[k.slice(2)] = true
    else { args[k.slice(2)] = n; i += 1 }
  }
  return args
}

async function readJsonl(file) {
  const rows = []
  let read = 0
  let failed = 0
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    const body = line.trim()
    if (!body) continue
    read += 1
    try { rows.push(JSON.parse(body)) } catch { failed += 1 }
  }
  return { rows, read, failed }
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text } }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}\n${JSON.stringify(json, null, 2)}`)
  return json
}

async function login(baseUrl, email, password) {
  const r = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
  if (!r?.token) throw new Error('Payload login succeeded but did not return a token.')
  return r.token
}

async function fetchAllWorks(baseUrl, token) {
  const docs = []
  let page = 1
  let totalPages = 1
  let totalDocs = 0
  do {
    const qs = new URLSearchParams({ limit: String(PAGE_LIMIT), page: String(page), depth: '0', draft: 'true' })
    const r = await requestJson(`${baseUrl}/api/works?${qs}`, { headers: { Authorization: `JWT ${token}` } })
    docs.push(...(Array.isArray(r.docs) ? r.docs : []))
    totalPages = Number(r.totalPages || 1)
    totalDocs = Number(r.totalDocs || docs.length)
    page += 1
  } while (page <= totalPages)
  return { docs, totalDocs }
}

function byId(docs) {
  const m = new Map()
  for (const d of docs) if (val(d.id)) m.set(val(d.id), d)
  return m
}

function sourceOf(d) {
  const first = Array.isArray(d?.candidateSources) ? d.candidateSources[0] : null
  const c = val(first?.source || first?.label).toLowerCase()
  if (c) return c
  const siteId = val(d?.siteId).toLowerCase()
  if (siteId.includes('bangumi')) return 'bangumi'
  if (siteId.includes('anilist')) return 'anilist'
  return val(d?.source || d?.originalSource || 'unknown').toLowerCase()
}

function idsOf(d) {
  const ids = d?.externalIds
  if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}
  return Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, val(v)]).filter(([, v]) => v))
}

function linksOf(d) {
  return (Array.isArray(d?.sourceLinks) ? d.sourceLinks : []).map((x) => normUrl(typeof x === 'string' ? x : x?.url)).filter(Boolean)
}

function candidatesOf(d) {
  return (Array.isArray(d?.candidateSources) ? d.candidateSources : []).map((x) => `${val(x?.source)} ${val(x?.label)} ${normUrl(x?.url)}`.toLowerCase())
}

function titlesOf(...docs) {
  const out = []
  for (const d of docs.filter(Boolean)) {
    out.push(d.title)
    if (Array.isArray(d.titles)) out.push(...d.titles)
    if (Array.isArray(d.localizedTitles)) for (const x of d.localizedTitles) out.push(typeof x === 'string' ? x : x?.title)
  }
  return out.map(compact).filter((x) => x.length >= 2)
}

function trace(d, name) {
  const ids = idsOf(d)
  if (name === 'bangumi' && (ids.bangumiSubjectId || ids.bangumiId || ids.bangumi)) return true
  if (name === 'anilist' && (ids.anilistMediaId || ids.anilistId || ids.anilist)) return true
  if (val(d?.siteId).toLowerCase().includes(name)) return true
  if (linksOf(d).some((u) => u.toLowerCase().includes(name))) return true
  if (candidatesOf(d).some((x) => x.includes(name))) return true
  return false
}

function supplementsOf(row) {
  if (Array.isArray(row.supplements)) return row.supplements
  if (Array.isArray(row.supplementRows)) return row.supplementRows
  return row.supplement ? [row.supplement] : []
}

function classify(row, map) {
  const issues = []
  const park = []
  const ok = []
  const masterRow = row.master || row.canonical || row.base
  const suppRows = supplementsOf(row)
  const master = map.get(val(masterRow?.id))
  const supp = suppRows.length === 1 ? map.get(val(suppRows[0]?.id)) : null

  if (!master) issues.push('master_not_found')
  if (suppRows.length !== 1) issues.push('expected_one_supplement')
  if (suppRows.length === 1 && !supp) issues.push('supplement_not_found')
  if (master && sourceOf(master) !== 'bangumi') issues.push('master_source_not_bangumi')
  if (supp && sourceOf(supp) !== 'anilist') issues.push('supplement_source_not_anilist')

  if (!issues.length) {
    const mk = new Set(titlesOf(master, masterRow))
    const sk = new Set(titlesOf(supp, suppRows[0]))
    const titleOverlap = [...mk].some((x) => sk.has(x))
    const masterBangumi = trace(master, 'bangumi')
    const suppAni = trace(supp, 'anilist')
    const cross = trace(master, 'anilist') || trace(supp, 'bangumi')
    if (titleOverlap) ok.push('compact_title_key_overlap'); else park.push('no_compact_title_key_overlap')
    if (masterBangumi) ok.push('has_bangumi_master_trace'); else park.push('master_missing_bangumi_trace')
    if (suppAni) ok.push('has_anilist_supplement_trace'); else park.push('supplement_missing_anilist_trace')
    if (cross) ok.push('has_cross_source_trace'); else park.push('missing_cross_source_trace')
  }

  const bucket = issues.length ? 'blocked' : park.length ? 'defer' : 'auto_ready'
  return {
    mergeGroupId: val(row.mergeGroupId || row.groupId || row.id),
    bucket,
    stage3Bucket: bucket,
    autoReasons: [...new Set(ok)],
    deferReasons: [...new Set(park)],
    blockers: [...new Set(issues)],
    master: master ? { id: val(master.id), title: val(master.title), slug: val(master.slug), source: sourceOf(master), externalIds: idsOf(master) } : masterRow || null,
    supplements: supp ? [{ id: val(supp.id), title: val(supp.title), slug: val(supp.slug), source: sourceOf(supp), externalIds: idsOf(supp) }] : [],
    safety: { localReportReadOnly: true, payloadRead: true, payloadWrite: false, directPostgresqlWrite: false, dataChanged: false },
  }
}

function countBy(list, fn) {
  const out = {}
  for (const x of list) {
    const k = val(typeof fn === 'function' ? fn(x) : x[fn]) || 'missing'
    out[k] = (out[k] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputPath = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const password = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]

  if (!fs.existsSync(inputPath)) throw new Error(`stage 3 review input file not found: ${inputPath}\nUse --input <path> if needed.`)
  if (!email || !password) throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV}.`)

  const input = await readJsonl(inputPath)
  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token)
  const rows = input.rows.map((row) => classify(row, byId(works.docs)))
  const autoReady = rows.filter((r) => r.bucket === 'auto_ready')
  const defer = rows.filter((r) => r.bucket === 'defer')
  const blocked = rows.filter((r) => r.bucket === 'blocked')
  const autoReasons = rows.flatMap((r) => r.autoReasons || [])
  const deferReasons = rows.flatMap((r) => r.deferReasons || [])
  const blockers = rows.flatMap((r) => r.blockers || [])

  const outputs = {
    rows: path.join(outDir, 'work-merge-review-rerank-v01.rows.jsonl'),
    autoReady: path.join(outDir, 'work-merge-review-rerank-v01-auto-ready.groups.jsonl'),
    defer: path.join(outDir, 'work-merge-review-rerank-v01-defer.groups.jsonl'),
    blocked: path.join(outDir, 'work-merge-review-rerank-v01-blocked.groups.jsonl'),
    summary: path.join(outDir, 'work-merge-review-rerank-v01-summary.json'),
    json: path.join(outDir, 'work-merge-review-rerank-v01.json'),
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: input.failed === 0 && blocked.length === 0,
    payloadBaseUrl: baseUrl,
    inputFile: inputPath,
    groupsRead: input.read,
    groupsLoaded: input.rows.length,
    parseFailures: input.failed,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    autoReadyGroups: autoReady.length,
    deferGroups: defer.length,
    blockedGroups: blocked.length,
    byBucket: countBy(rows, 'bucket'),
    byAutoReason: countBy(autoReasons, (x) => x),
    byDeferReason: countBy(deferReasons, (x) => x),
    byBlocker: countBy(blockers, (x) => x),
    outputs,
    safety: { localReportReadOnly: true, payloadRead: true, payloadWrite: false, directPostgresqlWrite: false, dataChanged: false },
  }
  const report = { ok: summary.ok, summary, samples: { autoReady: autoReady.slice(0, 20), defer: defer.slice(0, 20), blocked: blocked.slice(0, 20) } }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.rows, rows.map((x) => JSON.stringify(x)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.autoReady, autoReady.map((x) => JSON.stringify(x)).join('\n') + (autoReady.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.defer, defer.map((x) => JSON.stringify(x)).join('\n') + (defer.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.blocked, blocked.map((x) => JSON.stringify(x)).join('\n') + (blocked.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
