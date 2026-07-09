#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'rollback-anilist-adult-markers-v0.1'
const DEFAULT_INPUT = 'data_local/staging/anilist-adult-marked/anilist-adult-marked-v01-ready-existing.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/anilist-adult-marked-rollback'
const CONFIRM = 'rollback-anilist-adult-markers-v01'
const ADULT_MARKER_PATTERNS = [
  /contentVisibility\s*[:=]\s*adult/iu,
  /adultOrMarkedContent\s*[:=]\s*true/iu,
  /sourcePolicy\s*=\s*AniList adult marked content flow/iu,
  /adult marked content flow/iu,
]

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function parseArgs(argv) { const args = {}; for (let i = 0; i < argv.length; i += 1) { const item = argv[i]; if (!item.startsWith('--')) continue; const key = item.slice(2); const next = argv[i + 1]; if (!next || next.startsWith('--')) args[key] = true; else { args[key] = next; i += 1 } } return args }
function cleanLine(value) { return val(value).normalize('NFKC').replace(/[\r\n\t]+/gu, ' ').replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu, ' ').trim() }
function readJsonl(file) { if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`); const raw = fs.readFileSync(file, 'utf8').trim(); if (!raw) return []; return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)) }
function writeJsonl(file, rows) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8') }
function countBy(rows, key) { const out = {}; for (const row of rows) { const value = typeof key === 'function' ? key(row) : row?.[key]; const name = val(value) || 'missing'; out[name] = (out[name] || 0) + 1 } return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) }
function hasMarker(value) { const text = val(value); return ADULT_MARKER_PATTERNS.some((pattern) => pattern.test(text)) }
function splitSearchText(value) { return val(value).split(/[\r\n|]+/u).map(cleanLine).filter(Boolean) }
function normalizeSourceLink(item) { return { label: cleanLine(item?.label), url: val(item?.url).replace(/\s+/gu, '').replace(/\/+$/u, '') } }
function normalizeCandidateSource(item) { return { source: val(item?.source), label: cleanLine(item?.label), externalId: val(item?.externalId), url: val(item?.url).replace(/\s+/gu, '').replace(/\/+$/u, ''), fetchedAt: item?.fetchedAt, note: cleanLine(item?.note) } }
function normalizedCandidateSources(value) { return list(value).map(normalizeCandidateSource).filter((item) => item.source || item.label || item.externalId || item.url || item.note) }
function shallowEqual(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null) }
async function requestJson(url, options = {}) { const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); const text = await response.text(); let payload = null; try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } } if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`); return payload }
function authHeaders(token) { return token ? { Authorization: `JWT ${token}` } : {} }
async function login(baseUrl) { const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL; const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD; if (!email || !password) throw new Error('Missing Payload login env vars'); const result = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) }); if (!result?.token) throw new Error('Payload login did not return a token'); return result.token }
async function fetchWork(baseUrl, token, id) { return requestJson(`${baseUrl}/api/works/${id}?depth=0&draft=true`, { headers: authHeaders(token) }) }
function buildPatch(work) {
  const patch = {}
  const currentSearchLines = splitSearchText(work?.searchText)
  const nextSearchLines = currentSearchLines.filter((line) => !hasMarker(line))
  if (nextSearchLines.length !== currentSearchLines.length) patch.searchText = nextSearchLines.join('\n')

  const currentCandidateSources = normalizedCandidateSources(work?.candidateSources)
  const nextCandidateSources = currentCandidateSources.filter((item) => !hasMarker([item.note, item.source, item.label].join('; ')))
  if (!shallowEqual(currentCandidateSources, nextCandidateSources)) patch.candidateSources = nextCandidateSources

  return patch
}
function changedFields(patch) { return Object.keys(patch).filter((key) => ['candidateSources', 'searchText'].includes(key)) }

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const apply = Boolean(args.apply)
  const confirmMatched = val(args.confirm) === CONFIRM
  const limit = Number(args.limit || 0)
  if (apply && !confirmMatched) throw new Error(`Need --apply --confirm ${CONFIRM}`)

  const allPlans = readJsonl(input).filter((row) => val(row?.work?.id))
  const plans = limit > 0 ? allPlans.slice(0, limit) : allPlans
  const token = await login(base)
  const auth = authHeaders(token)
  const rows = []
  let payloadPatchRequests = 0
  for (const plan of plans) {
    const row = { key: val(plan?.key), anilistMediaId: val(plan?.anilistMediaId), workId: val(plan?.work?.id), title: val(plan?.title || plan?.work?.title), mode: apply ? 'apply' : 'dry-run', status: '', blockers: [], changedFields: [] }
    try {
      const work = await fetchWork(base, token, row.workId)
      const patch = buildPatch(work)
      row.changedFields = changedFields(patch)
      if (!row.changedFields.length) row.status = 'already_clean'
      else if (apply) {
        payloadPatchRequests += 1
        await requestJson(`${base}/api/works/${row.workId}?draft=true`, { method: 'PATCH', headers: auth, body: JSON.stringify(patch) })
        row.status = 'cleaned'
      } else row.status = 'would_clean'
    } catch (error) {
      row.status = 'failed'
      row.blockers.push(String(error?.message || error).slice(0, 800))
    }
    rows.push(row)
  }
  const outputs = {
    rows: `${outDir}/rollback-anilist-adult-markers-v01.rows.jsonl`,
    wouldClean: `${outDir}/rollback-anilist-adult-markers-v01-would-clean.jsonl`,
    cleaned: `${outDir}/rollback-anilist-adult-markers-v01-cleaned.jsonl`,
    failed: `${outDir}/rollback-anilist-adult-markers-v01-failed.jsonl`,
    summary: `${outDir}/rollback-anilist-adult-markers-v01-summary.json`,
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    mode: apply ? 'apply' : 'dry-run',
    payloadBaseUrl: base,
    input,
    planRowsRead: allPlans.length,
    planRowsProcessed: plans.length,
    wouldClean: rows.filter((row) => row.status === 'would_clean').length,
    cleaned: rows.filter((row) => row.status === 'cleaned').length,
    alreadyClean: rows.filter((row) => row.status === 'already_clean').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    byStatus: countBy(rows, 'status'),
    byChangedField: countBy(rows.flatMap((row) => row.changedFields), (x) => x),
    outputs,
    safety: {
      applyRequested: apply,
      confirmMatched,
      payloadRead: true,
      payloadWrite: apply,
      payloadPatchRequests,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      removesOnlyAniListAdultMarkerLinesFromSearchText: true,
      removesOnlyCandidateSourcesWithAdultMarkerNotes: true,
      preservesExternalIds: true,
      preservesSourceLinks: true,
      doesNotWriteDates: true,
      doesNotDownloadImages: true,
      doesNotWriteCreatorsOrTags: true,
      confirmToken: CONFIRM,
    },
  }
  fs.mkdirSync(outDir, { recursive: true })
  writeJsonl(outputs.rows, rows)
  writeJsonl(outputs.wouldClean, rows.filter((row) => row.status === 'would_clean'))
  writeJsonl(outputs.cleaned, rows.filter((row) => row.status === 'cleaned'))
  writeJsonl(outputs.failed, rows.filter((row) => row.status === 'failed'))
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: summary.failed === 0, summary, outputs }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
