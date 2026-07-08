#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'vndb-yuri-create-works-apply-v0.1'
const DEFAULT_INPUT = 'data_local/staging/vndb-yuri-create-works/vndb-yuri-create-works-v01-ready.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/vndb-yuri-create-works'
const CONFIRM = 'apply-vndb-yuri-create-works-v01'
const ALLOWED_ACTIONS = new Set(['create_vndb_yuri_first_wave_work_candidate'])
const TITLE_SEPARATOR_RE = /[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu
const INVISIBLE_TITLE_RE = /[\u200b\u200c\u200d\u2060\ufeff]/gu
const CJKISH_TITLE_RE = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af]/u

function val(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return Array.isArray(value) ? value : []
}

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

function cleanLine(value) {
  return val(value)
    .normalize('NFKC')
    .replace(INVISIBLE_TITLE_RE, '')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(TITLE_SEPARATOR_RE, ' ')
    .trim()
}

function normalizeText(value) {
  return cleanLine(value).normalize('NFKC').toLowerCase()
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))]
}

function suspiciousTitleSpaceScore(value) {
  const text = cleanLine(value)
  let score = 0
  score += (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af][\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af]/gu) || []).length
  score += (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af][\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+[）》」』】、。！？：；,.!?]/gu) || []).length
  return score
}

function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

function writeJsonl(file, rows) {
  fs.mkdirSync(DEFAULT_OUT_DIR, { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function countBy(rows, key) {
  const out = {}
  for (const row of rows) {
    const value = typeof key === 'function' ? key(row) : row?.[key]
    const name = val(value) || 'missing'
    out[name] = (out[name] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function externalIdsOf(doc) {
  const ids = doc?.externalIds
  if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}
  return Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, val(value)]).filter(([, value]) => value))
}

function exactTitleSet(work) {
  return new Set([
    work?.title,
    work?.originalTitle,
    ...(val(work?.searchText) ? val(work.searchText).split(/[\r\n|]+/u) : []),
  ].map(normalizeText).filter(Boolean))
}

function buildExistingIndexes(works) {
  const vndb = new Map()
  const qid = new Map()
  const slug = new Map()
  const siteId = new Map()
  const title = new Map()
  for (const work of works) {
    const ids = externalIdsOf(work)
    if (ids.vndbId) vndb.set(ids.vndbId.toLowerCase(), work)
    if (ids.wikidataQid) qid.set(ids.wikidataQid.toUpperCase(), work)
    if (val(work.slug)) slug.set(val(work.slug).toLowerCase(), work)
    if (val(work.siteId)) siteId.set(val(work.siteId).toUpperCase(), work)
    for (const key of exactTitleSet(work)) {
      if (!title.has(key)) title.set(key, [])
      title.get(key).push(work)
    }
  }
  return { vndb, qid, slug, siteId, title }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`)
  return payload
}

function authHeaders(token) {
  return token ? { Authorization: `JWT ${token}` } : {}
}

async function fetchAllWorks(baseUrl, token) {
  const docs = []
  let page = 1
  let totalPages = 1
  do {
    const params = new URLSearchParams()
    params.set('limit', '200')
    params.set('page', String(page))
    params.set('depth', '0')
    params.set('draft', 'true')
    const result = await requestJson(`${baseUrl}/api/works?${params.toString()}`, { headers: authHeaders(token) })
    docs.push(...(Array.isArray(result?.docs) ? result.docs : []))
    totalPages = Number(result?.totalPages || 1)
    page += 1
  } while (page <= totalPages)
  return docs
}

function validatePlan(plan) {
  const blockers = []
  const payload = plan?.payload || {}
  const vndbId = val(plan?.vndbId || payload?.externalIds?.vndbId).toLowerCase()
  const g97 = Number(plan?.sourceRow?.yuriCreateCandidateV2?.hasRomanceTag ? 1 : 0)
  const sensitiveReasons = list(plan?.sourceRow?.yuriCreateCandidateV2?.sensitiveReasons)
  const values = [payload.title, payload.originalTitle, payload.searchText, ...list(plan?.sourceRow?.titleCandidates)]

  if (!val(plan?.key)) blockers.push('missing_key')
  if (!vndbId) blockers.push('missing_vndb_id')
  if (!val(payload.title)) blockers.push('missing_title')
  if (!val(payload.slug)) blockers.push('missing_slug')
  if (!val(payload.siteId)) blockers.push('missing_site_id')
  if (!ALLOWED_ACTIONS.has(val(plan?.action))) blockers.push('unexpected_action')
  if (plan?.planStatus !== 'ready_for_create_dry_run') blockers.push('not_ready_for_create_dry_run')
  if (list(plan?.blockers).length) blockers.push('plan_blockers_present')
  if (plan?.createType !== 'ordinary_romance') blockers.push('unexpected_create_type')
  if (payload.status !== 'draft') blockers.push('not_draft_status')
  if (payload.mediaType !== 'visual_novel') blockers.push('not_visual_novel')
  if (payload.format !== 'visual_novel') blockers.push('not_visual_novel_format')
  if (payload.chosenBaseSource !== 'vndb') blockers.push('not_vndb_base_source')
  if (!g97) blockers.push('missing_vndb_g97_romance_marker')
  if (sensitiveReasons.length) blockers.push('sensitive_reasons_present')
  if (plan?.sourceRow?.yuriCreateCandidateV3?.firstWaveEligible !== true) blockers.push('not_first_wave_eligible')
  for (const item of values) {
    const clean = cleanLine(item)
    if (suspiciousTitleSpaceScore(clean) > 0) blockers.push('suspicious_title_spacing_after_cleaning')
    if (CJKISH_TITLE_RE.test(clean) && /^\s|\s$/u.test(clean)) blockers.push('suspicious_title_edge_spacing_after_cleaning')
  }
  return unique(blockers)
}

function duplicateBlockers(plan, indexes) {
  const blockers = []
  const payload = plan?.payload || {}
  const ids = externalIdsOf(payload)
  if (ids.vndbId && indexes.vndb.has(ids.vndbId.toLowerCase())) blockers.push('existing_vndb_id')
  if (ids.wikidataQid && indexes.qid.has(ids.wikidataQid.toUpperCase())) blockers.push('existing_wikidata_qid')
  if (payload.slug && indexes.slug.has(val(payload.slug).toLowerCase())) blockers.push('existing_slug')
  if (payload.siteId && indexes.siteId.has(val(payload.siteId).toUpperCase())) blockers.push('existing_site_id')
  const searchValues = [payload.title, payload.originalTitle, ...(val(payload.searchText) ? val(payload.searchText).split(/[\r\n|]+/u) : [])]
  if (searchValues.some((item) => indexes.title.has(normalizeText(item)))) blockers.push('existing_exact_title_or_search_text')
  return unique(blockers)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const apply = Boolean(args.apply)
  const confirmMatched = val(args.confirm) === CONFIRM
  const limit = Number(args.limit || 0)
  if (apply && !confirmMatched) throw new Error(`Need --apply --confirm ${CONFIRM}`)

  const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) throw new Error('Missing Payload login env vars')

  const allPlans = readJsonl(input)
  const plans = limit > 0 ? allPlans.slice(0, limit) : allPlans
  const login = await requestJson(`${base}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
  const token = login?.token
  if (!token) throw new Error('Payload login did not return a token')
  const auth = authHeaders(token)
  const indexes = buildExistingIndexes(await fetchAllWorks(base, token))

  const rows = []
  let wouldCreate = 0
  let created = 0
  let alreadyExists = 0
  let blocked = 0
  let failed = 0
  let payloadPostRequests = 0

  for (const plan of plans) {
    const row = {
      key: val(plan?.key),
      vndbId: val(plan?.vndbId),
      title: val(plan?.payload?.title),
      slug: val(plan?.payload?.slug),
      createType: val(plan?.createType),
      mode: apply ? 'apply' : 'dry-run',
      status: '',
      blockers: validatePlan(plan),
      createdWorkId: '',
    }
    try {
      const duplicateBlockersNow = duplicateBlockers(plan, indexes)
      if (duplicateBlockersNow.length) {
        if (duplicateBlockersNow.includes('existing_vndb_id') || duplicateBlockersNow.includes('existing_wikidata_qid') || duplicateBlockersNow.includes('existing_slug') || duplicateBlockersNow.includes('existing_site_id')) {
          row.status = 'already_exists'
          row.blockers = []
          alreadyExists += 1
        } else {
          row.blockers.push(...duplicateBlockersNow)
        }
      }
      if (!row.status && !row.blockers.length) {
        if (apply) {
          payloadPostRequests += 1
          const createdDoc = await requestJson(`${base}/api/works?draft=true`, {
            method: 'POST',
            headers: auth,
            body: JSON.stringify(plan.payload),
          })
          const doc = createdDoc?.doc || createdDoc
          row.createdWorkId = val(doc?.id)
          row.status = 'created'
          created += 1
          if (doc) {
            const ids = externalIdsOf(plan.payload)
            if (ids.vndbId) indexes.vndb.set(ids.vndbId.toLowerCase(), doc)
            if (ids.wikidataQid) indexes.qid.set(ids.wikidataQid.toUpperCase(), doc)
            indexes.slug.set(val(plan?.payload?.slug).toLowerCase(), doc)
            indexes.siteId.set(val(plan?.payload?.siteId).toUpperCase(), doc)
            for (const key of exactTitleSet(doc)) {
              if (!indexes.title.has(key)) indexes.title.set(key, [])
              indexes.title.get(key).push(doc)
            }
          }
        } else {
          row.status = 'would_create'
          wouldCreate += 1
        }
      }
      if (row.blockers.length && !row.status) {
        row.status = 'blocked'
        blocked += 1
      }
    } catch (error) {
      row.status = 'failed'
      row.blockers.push(String(error?.message || error).slice(0, 800))
      failed += 1
    }
    rows.push(row)
  }

  fs.mkdirSync(outDir, { recursive: true })
  const outputs = {
    rows: `${outDir}/vndb-yuri-create-works-apply-v01.rows.jsonl`,
    wouldCreate: `${outDir}/vndb-yuri-create-works-apply-v01-would-create.jsonl`,
    created: `${outDir}/vndb-yuri-create-works-apply-v01-created.jsonl`,
    blocked: `${outDir}/vndb-yuri-create-works-apply-v01-blocked.jsonl`,
    summary: `${outDir}/vndb-yuri-create-works-apply-v01-summary.json`,
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    mode: apply ? 'apply' : 'dry-run',
    payloadBaseUrl: base,
    input,
    planRowsRead: allPlans.length,
    planRowsProcessed: plans.length,
    wouldCreate,
    created,
    alreadyExists,
    blocked,
    failed,
    byStatus: countBy(rows, 'status'),
    byCreateType: countBy(rows, 'createType'),
    byBlocker: countBy(rows.flatMap((row) => row.blockers), (item) => item),
    outputs,
    safety: {
      applyRequested: apply,
      confirmMatched,
      payloadRead: true,
      payloadWrite: apply,
      payloadPostRequests,
      directPostgresqlWrite: false,
      createsWorks: apply,
      deletesWorks: false,
      createsOnlyDraftWorks: true,
      inputMustBeVndbYuriCreateWorksReadyPlan: true,
      blocksDuplicateVndbQidSlugSiteId: true,
      blocksExactTitleMatches: true,
      requiresG97GirlXGirlRomance: true,
      blocksSensitiveRows: true,
      doesNotWriteDates: true,
      doesNotDownloadImages: true,
      doesNotWriteCreatorsOrTags: true,
      confirmToken: CONFIRM,
    },
  }

  writeJsonl(outputs.rows, rows)
  writeJsonl(outputs.wouldCreate, rows.filter((row) => row.status === 'would_create'))
  writeJsonl(outputs.created, rows.filter((row) => row.status === 'created'))
  writeJsonl(outputs.blocked, rows.filter((row) => row.status === 'blocked' || row.status === 'failed'))
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: failed === 0, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
