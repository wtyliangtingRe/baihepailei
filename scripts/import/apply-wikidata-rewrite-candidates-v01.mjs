#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'wikidata-rewrite-candidates-apply-v0.1'
const DEFAULT_INPUT = 'data_local/staging/wikidata-rewrite-candidates/wikidata-rewrite-candidates-v01-ready.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/wikidata-rewrite-candidates'
const CONFIRM = 'apply-wikidata-rewrite-candidates-v01'
const MAX_SEARCH_TEXT_ADDITIONS = 16
const SOURCE_MARKERS = ['bangumi', 'mangadex', 'ndl', 'wikidata']
const ALLOWED_ACTION = 'overwrite_unmarked_work_with_wikidata_candidate'

function val(value) {
  return String(value ?? '').trim()
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

function list(value) {
  return Array.isArray(value) ? value : []
}

function cleanLine(value) {
  return val(value).replace(/[\r\n\t]+/gu, ' ').replace(/\s+/gu, ' ')
}

function repairInternalTitleSpaces(value) {
  return cleanLine(value)
    .replace(/([\u3040-\u30ff\u31f0-\u31ffー])\s+([\u3040-\u30ff\u31f0-\u31ffー])/gu, '$1$2')
    .replace(/([～〜・《「『【（])\s+([\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー])/gu, '$1$2')
    .replace(/([\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー])\s+([）》」』】、。！？：；])/gu, '$1$2')
    .replace(/([A-Za-z])\s+([級级])/gu, '$1$2')
}

function isInternalMediaKey(value) {
  return /^(ANIME|MANGA|NOVEL|GAME)-\d+$/iu.test(val(value))
}

function cleanTitleText(value) {
  const out = repairInternalTitleSpaces(value)
  if (!out || isInternalMediaKey(out)) return ''
  return out
}

function normalizeText(value) {
  return cleanTitleText(value).normalize('NFKC').toLowerCase()
}

function compactForCompare(value) {
  return cleanTitleText(value).normalize('NFKC').toLowerCase().replace(/\s+/gu, '')
}

function suspiciousTitleSpaceScore(value) {
  const text = cleanLine(value)
  let score = 0
  score += (text.match(/[\u3040-\u30ff\u31f0-\u31ffー]\s+[\u3040-\u30ff\u31f0-\u31ffー]/gu) || []).length
  score += (text.match(/[～〜・《「『【（]\s+[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー]/gu) || []).length
  score += (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー]\s+[）》」』】、。！？：；]/gu) || []).length
  score += (text.match(/[A-Za-z]\s+[級级]/gu) || []).length
  return score
}

function hasSuspiciousTitleSpacing(value) {
  return suspiciousTitleSpaceScore(value) > 0
}

function uniqueBy(values, getKey = normalizeText) {
  const seen = new Set()
  const out = []
  for (const item of values || []) {
    const key = getKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function uniqueTitleValues(values) {
  const byCompact = new Map()
  const order = []
  for (const item of values || []) {
    const text = cleanTitleText(item)
    const key = compactForCompare(text)
    if (!text || !key) continue
    if (!byCompact.has(key)) {
      byCompact.set(key, text)
      order.push(key)
      continue
    }
    const current = byCompact.get(key)
    if (suspiciousTitleSpaceScore(text) < suspiciousTitleSpaceScore(current)) byCompact.set(key, text)
  }
  return order.map((key) => byCompact.get(key)).filter(Boolean)
}

function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

function writeJsonl(file, rows) {
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

function sourceLinkRows(doc) {
  return list(doc?.sourceLinks)
    .map((item) => ({ ...item, label: val(item?.label), url: val(item?.url).replace(/\/+$/u, '') }))
    .filter((item) => item.url)
}

function candidateSourceRows(doc) {
  return list(doc?.candidateSources)
    .map((item) => ({
      ...item,
      source: val(item?.source),
      label: val(item?.label),
      externalId: val(item?.externalId),
      url: val(item?.url).replace(/\/+$/u, ''),
      note: val(item?.note),
    }))
    .filter((item) => item.source || item.externalId || item.url)
}

function sourceMarkerText(work) {
  return [
    work?.siteId,
    work?.originalSource,
    work?.source,
    ...sourceLinkRows(work).flatMap((item) => [item.label, item.url]),
    ...candidateSourceRows(work).flatMap((item) => [item.source, item.label, item.externalId, item.url, item.note]),
  ].map((item) => val(item).toLowerCase()).join('\n')
}

function sourceMarkersOf(work) {
  const ids = externalIdsOf(work)
  const haystack = sourceMarkerText(work)
  const markers = new Set()
  if (ids.bangumiSubjectId || /bangumi|bgm\.tv|bangumi\.tv/u.test(haystack)) markers.add('bangumi')
  if (/mangadex/u.test(haystack)) markers.add('mangadex')
  if (/\bndl\b|iss\.ndl\.go\.jp|id\.ndl\.go\.jp/u.test(haystack)) markers.add('ndl')
  if (ids.wikidataQid || /wikidata|wikidata\.org/u.test(haystack)) markers.add('wikidata')
  return SOURCE_MARKERS.filter((marker) => markers.has(marker))
}

function wikidataUrl(qid) {
  return qid ? `https://www.wikidata.org/wiki/${qid}` : ''
}

function valuesFromPlanForCleanerChoice(plan) {
  return uniqueTitleValues([
    plan?.fieldUpdates?.title,
    plan?.fieldUpdates?.originalTitle,
    ...list(plan?.fieldAdditions?.searchTextAdditions),
    ...list(plan?.titleCandidates),
    ...list(plan?.matchedTitles),
  ])
}

function chooseCleanerEquivalent(plan, value) {
  const base = cleanTitleText(value)
  const key = compactForCompare(base)
  if (!base || !key) return ''
  let best = base
  for (const candidate of valuesFromPlanForCleanerChoice(plan)) {
    if (compactForCompare(candidate) !== key) continue
    if (suspiciousTitleSpaceScore(candidate) < suspiciousTitleSpaceScore(best)) best = candidate
  }
  return best
}

function uniqueSearchTextLines(existingSearchText, additions) {
  const existing = val(existingSearchText)
  const lines = existing ? existing.split(/[\r\n|]+/u).map(cleanTitleText).filter(Boolean) : []
  const accepted = uniqueTitleValues([...lines, ...additions])
  const existingKeys = new Set(lines.map(normalizeText).filter(Boolean))
  const added = accepted.filter((item) => !existingKeys.has(normalizeText(item)))
  return { value: accepted.join('\n'), added }
}

function mergeSourceLinks(existing, additions) {
  const rows = [...sourceLinkRows({ sourceLinks: existing })]
  const seen = new Set(rows.map((item) => val(item.url).toLowerCase()).filter(Boolean))
  let added = 0
  for (const item of additions || []) {
    const url = val(item?.url).replace(/\/+$/u, '')
    if (!url || seen.has(url.toLowerCase())) continue
    rows.push({ label: val(item?.label) || 'Wikidata', url })
    seen.add(url.toLowerCase())
    added += 1
  }
  return { value: rows, added }
}

function mergeCandidateSources(existing, additions) {
  const rows = [...candidateSourceRows({ candidateSources: existing })]
  const keyOf = (item) => [val(item.source).toLowerCase(), val(item.externalId).toUpperCase(), val(item.url).toLowerCase()].join('|')
  const seen = new Set(rows.map(keyOf))
  let added = 0
  for (const item of additions || []) {
    const row = {
      source: val(item?.source) || 'wikidata',
      label: val(item?.label) || 'Wikidata',
      externalId: val(item?.externalId),
      url: val(item?.url).replace(/\/+$/u, ''),
      note: val(item?.note),
    }
    const key = keyOf(row)
    if (seen.has(key)) continue
    rows.push(row)
    seen.add(key)
    added += 1
  }
  return { value: rows, added }
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
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { raw: text }
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`)
  return payload
}

function authHeaders(token) {
  return token ? { Authorization: `JWT ${token}` } : {}
}

function validatePlanRow(plan) {
  const blockers = []
  const qid = val(plan?.qid)
  const additions = list(plan?.fieldAdditions?.searchTextAdditions).map(cleanTitleText).filter(Boolean)

  if (!val(plan?.key)) blockers.push('missing_key')
  if (!qid) blockers.push('missing_wikidata_qid')
  if (!val(plan?.work?.id)) blockers.push('missing_work_id')
  if (val(plan?.action) !== ALLOWED_ACTION) blockers.push('unexpected_action')
  if (plan?.planStatus !== 'ready_for_apply_review') blockers.push('not_ready_for_apply_review')
  if (plan?.confidence !== 'high') blockers.push('confidence_not_high')
  if (list(plan?.blockers).length) blockers.push('plan_blockers_present')
  if (list(plan?.rawAuditRow?.contentAdvisories).length) blockers.push('content_advisory_requires_marked_content_flow')
  if (additions.length > MAX_SEARCH_TEXT_ADDITIONS) blockers.push('too_many_search_text_additions')
  for (const item of [...additions, plan?.fieldUpdates?.title, plan?.fieldUpdates?.originalTitle]) {
    const clean = cleanTitleText(item)
    if (isInternalMediaKey(clean)) blockers.push('internal_media_key_in_write_fields')
    if (hasSuspiciousTitleSpacing(clean)) blockers.push('suspicious_title_spacing_after_cleaning')
  }
  return uniqueBy(blockers, (item) => item)
}

function buildPatch(plan, work, row) {
  const patch = {}
  const changedFields = []
  const details = {}
  const ids = externalIdsOf(work)
  const qid = val(plan.qid)
  const markers = sourceMarkersOf(work)
  const conflictingMarkers = markers.filter((marker) => marker !== 'wikidata')

  if (conflictingMarkers.length) row.blockers.push(`current_work_already_has_source_marker:${conflictingMarkers.join(',')}`)
  if (ids.wikidataQid && ids.wikidataQid.toUpperCase() !== qid.toUpperCase()) row.blockers.push('current_wikidata_qid_conflict')

  const title = chooseCleanerEquivalent(plan, plan?.fieldUpdates?.title)
  const originalTitle = chooseCleanerEquivalent(plan, plan?.fieldUpdates?.originalTitle)
  const searchText = uniqueSearchTextLines(work.searchText, list(plan?.fieldAdditions?.searchTextAdditions))
  const nextExternalIds = { ...(work.externalIds || {}) }
  const sourceLinks = mergeSourceLinks(work.sourceLinks, plan?.fieldAdditions?.sourceLinks)
  const candidateSources = mergeCandidateSources(work.candidateSources, plan?.fieldAdditions?.candidateSources)

  for (const item of [title, originalTitle, ...searchText.added]) {
    if (hasSuspiciousTitleSpacing(item)) row.blockers.push('suspicious_title_spacing_after_final_cleaning')
  }

  if (title && normalizeText(title) !== normalizeText(work.title)) {
    patch.title = title
    changedFields.push('title')
  }
  if (originalTitle && normalizeText(originalTitle) !== normalizeText(work.originalTitle)) {
    patch.originalTitle = originalTitle
    changedFields.push('originalTitle')
  }
  if (work.chosenBaseSource !== 'wikidata') {
    patch.chosenBaseSource = 'wikidata'
    changedFields.push('chosenBaseSource')
  }
  if (!ids.wikidataQid && qid) {
    nextExternalIds.wikidataQid = qid
    patch.externalIds = nextExternalIds
    changedFields.push('externalIds.wikidataQid')
  }
  if (searchText.added.length) {
    patch.searchText = searchText.value
    changedFields.push('searchText')
    details.searchTextAdded = searchText.added
  }
  if (sourceLinks.added) {
    patch.sourceLinks = sourceLinks.value
    changedFields.push('sourceLinks')
  }
  if (candidateSources.added) {
    patch.candidateSources = candidateSources.value
    changedFields.push('candidateSources')
  }

  return { patch, changedFields: uniqueBy(changedFields, (item) => item), details }
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
  const login = await requestJson(`${base}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  const token = login?.token
  if (!token) throw new Error('Payload login did not return a token')
  const auth = authHeaders(token)

  const rows = []
  let wouldPatch = 0
  let patched = 0
  let alreadyCurrent = 0
  let blocked = 0
  let failed = 0
  let payloadPatchRequests = 0

  for (const plan of plans) {
    const row = {
      key: val(plan?.key),
      qid: val(plan?.qid),
      workId: val(plan?.work?.id),
      workTitle: val(plan?.work?.title),
      mode: apply ? 'apply' : 'dry-run',
      action: val(plan?.action),
      status: '',
      blockers: validatePlanRow(plan),
      changedFields: [],
      details: {},
    }

    try {
      if (!row.blockers.length) {
        const doc = await requestJson(`${base}/api/works/${encodeURIComponent(row.workId)}?depth=0&draft=true`, { headers: auth })
        const work = doc?.doc || doc
        if (!work?.id) row.blockers.push('work_not_found')
        else {
          const built = buildPatch(plan, work, row)
          row.changedFields = built.changedFields
          row.details = built.details
          if (!row.blockers.length) {
            if (!row.changedFields.length) {
              row.status = 'already_current'
              alreadyCurrent += 1
            } else if (apply) {
              payloadPatchRequests += 1
              await requestJson(`${base}/api/works/${encodeURIComponent(row.workId)}?draft=true`, {
                method: 'PATCH',
                headers: auth,
                body: JSON.stringify(built.patch),
              })
              row.status = 'patched'
              patched += 1
            } else {
              row.status = 'would_patch'
              wouldPatch += 1
            }
          }
        }
      }

      if (row.blockers.length && row.status !== 'blocked') {
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
    rows: `${outDir}/wikidata-rewrite-candidates-apply-v01.rows.jsonl`,
    wouldPatch: `${outDir}/wikidata-rewrite-candidates-apply-v01-would-patch.jsonl`,
    patched: `${outDir}/wikidata-rewrite-candidates-apply-v01-patched.jsonl`,
    blocked: `${outDir}/wikidata-rewrite-candidates-apply-v01-blocked.jsonl`,
    summary: `${outDir}/wikidata-rewrite-candidates-apply-v01-summary.json`,
  }
  const actionableRows = rows.filter((row) => row.status === 'would_patch' || row.status === 'patched')
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    mode: apply ? 'apply' : 'dry-run',
    payloadBaseUrl: base,
    input,
    planRowsRead: allPlans.length,
    planRowsProcessed: plans.length,
    wouldPatch,
    patched,
    alreadyCurrent,
    blocked,
    failed,
    byStatus: countBy(rows, 'status'),
    byChangedField: countBy(actionableRows.flatMap((row) => row.changedFields), (item) => item),
    byBlocker: countBy(rows.flatMap((row) => row.blockers), (item) => item),
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
      inputMustBeReadyPlannerOutput: true,
      writableFields: ['title', 'originalTitle', 'chosenBaseSource', 'searchText', 'externalIds.wikidataQid', 'sourceLinks', 'candidateSources'],
      doesNotWriteMediaTypeOrRiskFields: true,
      doesNotWriteDates: true,
      rejectsContentAdvisories: true,
      rejectsInternalMediaKeys: true,
      rejectsSuspiciousTitleSpacingAfterCleaning: true,
      blocksIfCurrentWorkHasBangumiMangaDexOrNdlMarker: true,
      confirmToken: CONFIRM,
    },
  }

  writeJsonl(outputs.rows, rows)
  writeJsonl(outputs.wouldPatch, rows.filter((row) => row.status === 'would_patch'))
  writeJsonl(outputs.patched, rows.filter((row) => row.status === 'patched'))
  writeJsonl(outputs.blocked, rows.filter((row) => row.status === 'blocked' || row.status === 'failed'))
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')

  console.log(JSON.stringify({ ok: failed === 0, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
