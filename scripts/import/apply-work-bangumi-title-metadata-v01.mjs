#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'work-bangumi-title-metadata-apply-v0.1'
const DEFAULT_INPUT = 'data_local/staging/work-source-metadata/work-bangumi-title-metadata-v04-plans.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-source-metadata'
const CONFIRM_TOKEN = 'apply-bangumi-metadata-v01'
const PAGE_LIMIT = 100

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

function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

function countBy(rows, getKey) {
  const out = {}
  for (const row of rows) {
    const k = String(typeof getKey === 'function' ? getKey(row) : row[getKey] || 'missing')
    out[k] = (out[k] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}; url=${url}\n${JSON.stringify(payload, null, 2)}`)
  return payload
}

async function login(baseUrl, email, secret) {
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password: secret }),
  })
  if (!result?.token) throw new Error('Payload login succeeded but did not return a token.')
  return result.token
}

function authHeaders(token) {
  return token ? { Authorization: `JWT ${token}` } : {}
}

async function fetchWork(baseUrl, token, id) {
  const params = new URLSearchParams()
  params.set('depth', '0')
  params.set('draft', 'true')
  return requestJson(`${baseUrl}/api/works/${id}?${params.toString()}`, { headers: authHeaders(token) })
}

async function patchWork(baseUrl, token, id, patch) {
  const params = new URLSearchParams()
  params.set('draft', 'true')
  return requestJson(`${baseUrl}/api/works/${id}?${params.toString()}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  })
}

function textNode(text) {
  return { detail: 0, format: 0, mode: 'normal', style: '', text, type: 'text', version: 1 }
}

function paragraphNode(text) {
  return { children: text ? [textNode(text)] : [], direction: null, format: '', indent: 0, type: 'paragraph', version: 1 }
}

function plainTextToLexical(text) {
  const paragraphs = String(text || '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split(/\n{2,}/u)
    .map((part) => part.trim())
    .filter(Boolean)
  return {
    root: {
      children: (paragraphs.length ? paragraphs : ['']).map(paragraphNode),
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  }
}

function stable(value) {
  return JSON.stringify(value ?? null)
}

function localizedTitleKey(row) {
  return [row?.title, row?.language, row?.kind, row?.source].map(key).join('|')
}

function mergeLocalizedTitles(doc, additions) {
  const existing = Array.isArray(doc.localizedTitles) ? doc.localizedTitles : []
  const seen = new Set(existing.map(localizedTitleKey))
  const visibleTitleKeys = new Set(uniqueStrings([
    doc.title,
    doc.originalTitle,
    existing.map((row) => row?.title),
    Array.isArray(doc.aliases) ? doc.aliases.map((row) => row?.value) : [],
  ]).map(key))
  const next = [...existing]
  let added = 0
  for (const row of Array.isArray(additions) ? additions : []) {
    const title = clean(row?.title)
    if (!title) continue
    const candidate = {
      title,
      language: clean(row.language) || 'unknown',
      region: clean(row.region),
      kind: clean(row.kind) || 'alias',
      isPrimary: Boolean(row.isPrimary),
      source: clean(row.source) || 'bangumi',
      note: clean(row.note),
    }
    const lk = key(title)
    const rk = localizedTitleKey(candidate)
    if (seen.has(rk) || visibleTitleKeys.has(lk)) continue
    seen.add(rk)
    visibleTitleKeys.add(lk)
    next.push(candidate)
    added += 1
  }
  return { value: next, added }
}

function mergeAliases(doc, additions) {
  const existing = Array.isArray(doc.aliases) ? doc.aliases : []
  const seen = new Set(uniqueStrings([
    doc.title,
    doc.originalTitle,
    existing.map((row) => row?.value),
    Array.isArray(doc.localizedTitles) ? doc.localizedTitles.map((row) => row?.title) : [],
  ]).map(key))
  const next = [...existing]
  let added = 0
  for (const row of Array.isArray(additions) ? additions : []) {
    const value = clean(row?.value || row)
    if (!value) continue
    const k = key(value)
    if (seen.has(k)) continue
    seen.add(k)
    next.push({ value })
    added += 1
  }
  return { value: next, added }
}

function mergeSourceLinks(doc, additions) {
  const existing = Array.isArray(doc.sourceLinks) ? doc.sourceLinks : []
  const seen = new Set(existing.map((row) => key(row?.url || row)).filter(Boolean))
  const next = [...existing]
  let added = 0
  for (const row of Array.isArray(additions) ? additions : []) {
    const url = clean(row?.url)
    if (!url) continue
    const k = key(url)
    if (seen.has(k)) continue
    seen.add(k)
    next.push({ label: clean(row.label) || url, url })
    added += 1
  }
  return { value: next, added }
}

function mergeCandidateSources(doc, additions) {
  const existing = Array.isArray(doc.candidateSources) ? doc.candidateSources : []
  const seen = new Set(existing.map((row) => [row?.source, row?.externalId, row?.url].map(key).join('|')))
  const next = [...existing]
  let added = 0
  for (const row of Array.isArray(additions) ? additions : []) {
    const source = clean(row?.source) || 'bangumi'
    const externalId = clean(row?.externalId)
    const url = clean(row?.url)
    const k = [source, externalId, url].map(key).join('|')
    if (!externalId || seen.has(k)) continue
    seen.add(k)
    next.push({
      source,
      label: clean(row.label) || `${source}:${externalId}`,
      externalId,
      url,
      note: clean(row.note),
    })
    added += 1
  }
  return { value: next, added }
}

function planBangumiId(plan) {
  const ids = uniqueStrings([
    Array.isArray(plan?.additions?.candidateSources) ? plan.additions.candidateSources.map((row) => row.externalId) : [],
    Array.isArray(plan?.matchedRecords) ? plan.matchedRecords.map((row) => row.externalId) : [],
  ])
  return ids.length === 1 ? ids[0] : ''
}

function buildPatch(doc, plan, options) {
  const blockers = []
  const patch = {}
  const stats = {}
  const additions = plan.additions || {}
  const bangumiId = planBangumiId(plan)

  if (!bangumiId) blockers.push('missing_single_bangumi_id')
  const existingExternalIds = doc.externalIds || {}
  const currentBangumiId = clean(existingExternalIds.bangumiSubjectId)
  if (currentBangumiId && bangumiId && currentBangumiId !== bangumiId) blockers.push('bangumi_id_conflict')
  else if (bangumiId && !currentBangumiId) {
    patch.externalIds = { ...existingExternalIds, bangumiSubjectId: bangumiId }
    stats.externalIds = 1
  }

  const localized = mergeLocalizedTitles(doc, additions.localizedTitles)
  if (localized.added > 0) {
    patch.localizedTitles = localized.value
    stats.localizedTitles = localized.added
  }

  const aliases = mergeAliases(doc, additions.aliases)
  if (aliases.added > 0) {
    patch.aliases = aliases.value
    stats.aliases = aliases.added
  }

  const sourceLinks = mergeSourceLinks(doc, additions.sourceLinks)
  if (sourceLinks.added > 0) {
    patch.sourceLinks = sourceLinks.value
    stats.sourceLinks = sourceLinks.added
  }

  const candidateSources = mergeCandidateSources(doc, additions.candidateSources)
  if (candidateSources.added > 0) {
    patch.candidateSources = candidateSources.value
    stats.candidateSources = candidateSources.added
  }

  if (additions.summary?.summary) {
    const summaryValue = plainTextToLexical(additions.summary.summary)
    if (options.summaryMode === 'replace' || !doc.summary) {
      if (stable(doc.summary) !== stable(summaryValue)) {
        patch.summary = summaryValue
        stats.summary = 1
      }
    }
  }

  if (additions.date?.firstPublishedAt) {
    const datePatch = {
      firstPublishedAt: additions.date.firstPublishedAt,
      firstPublishedPrecision: additions.date.firstPublishedPrecision || 'unknown',
      firstPublishedLabel: additions.date.firstPublishedLabel || additions.date.rawDate || additions.date.firstPublishedAt,
    }
    if (options.dateMode === 'replace' || !doc.firstPublishedLabel) {
      for (const [field, value] of Object.entries(datePatch)) {
        if (clean(doc[field]) !== clean(value)) patch[field] = value
      }
      if (Object.keys(datePatch).some((field) => field in patch)) stats.firstPublishedAt = 1
    }
  }

  return { patch, stats, blockers }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const inputFile = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const matchMode = String(args['match-mode'] || 'external_id')
  const summaryMode = String(args['summary-mode'] || 'replace')
  const dateMode = String(args['date-mode'] || 'replace')
  const limit = Number(args.limit || 0)
  const apply = Boolean(args.apply)
  const confirm = String(args.confirm || '')
  const confirmMatched = confirm === CONFIRM_TOKEN
  const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const secret = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD

  if (apply && !confirmMatched) throw new Error(`Refusing to write. Re-run with --apply --confirm ${CONFIRM_TOKEN}`)
  if (!email || !secret) throw new Error('Missing PAYLOAD_EXPORT_EMAIL/PAYLOAD_EXPORT_PASSWORD or PAYLOAD_SEED_EMAIL/PAYLOAD_SEED_PASSWORD.')
  if (!['external_id', 'title_exact', 'all'].includes(matchMode)) throw new Error('--match-mode must be external_id, title_exact, or all')
  if (!['replace', 'fill'].includes(summaryMode)) throw new Error('--summary-mode must be replace or fill')
  if (!['replace', 'fill'].includes(dateMode)) throw new Error('--date-mode must be replace or fill')

  const token = await login(baseUrl, email, secret)
  let plans = readJsonl(inputFile)
  plans = plans.filter((plan) => matchMode === 'all' || plan.matchMode === matchMode)
  if (limit > 0) plans = plans.slice(0, limit)

  const rows = []
  let wouldPatch = 0
  let patched = 0
  let alreadyCurrent = 0
  let blocked = 0
  let patchRequests = 0

  for (const plan of plans) {
    const row = {
      id: plan.id,
      slug: plan.slug,
      title: plan.title,
      matchMode: plan.matchMode,
      status: 'unknown',
      changedFields: [],
      stats: {},
      blockers: [],
    }
    try {
      const doc = await fetchWork(baseUrl, token, plan.id)
      const { patch, stats, blockers } = buildPatch(doc, plan, { summaryMode, dateMode })
      row.stats = stats
      row.blockers = blockers
      row.changedFields = Object.keys(patch)
      if (blockers.length) {
        row.status = 'blocked'
        blocked += 1
      } else if (Object.keys(patch).length === 0) {
        row.status = 'already_current'
        alreadyCurrent += 1
      } else if (apply) {
        await patchWork(baseUrl, token, plan.id, patch)
        patchRequests += 1
        row.status = 'patched'
        patched += 1
      } else {
        row.status = 'would_patch'
        wouldPatch += 1
      }
    } catch (error) {
      row.status = 'blocked'
      row.blockers.push(`error:${String(error?.message || error).slice(0, 300)}`)
      blocked += 1
    }
    rows.push(row)
  }

  const outputs = {
    rows: path.join(outDir, 'work-bangumi-title-metadata-apply-v01.rows.jsonl'),
    summary: path.join(outDir, 'work-bangumi-title-metadata-apply-v01-summary.json'),
    json: path.join(outDir, 'work-bangumi-title-metadata-apply-v01.json'),
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: blocked === 0,
    payloadBaseUrl: baseUrl,
    mode: apply ? 'apply' : 'dry-run',
    inputFile,
    matchMode,
    summaryMode,
    dateMode,
    plansRead: plans.length,
    wouldPatch,
    patched,
    alreadyCurrent,
    blocked,
    byStatus: countBy(rows, 'status'),
    byChangedField: countBy(rows.flatMap((row) => row.changedFields), (value) => value),
    byBlocker: countBy(rows.flatMap((row) => row.blockers), (value) => value),
    outputs,
    safety: {
      applyRequested: apply,
      confirmMatched,
      payloadRead: true,
      payloadWrite: apply,
      payloadPatchRequests: patchRequests,
      directPostgresqlWrite: false,
      localReportWrite: true,
      deleted: false,
      archived: false,
      statusChanged: false,
      reviewStatusChanged: false,
      evidenceStrengthChanged: false,
      summaryMode,
      dateMode,
    },
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.rows, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify({ ok: summary.ok, summary, samples: rows.slice(0, 50) }, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
