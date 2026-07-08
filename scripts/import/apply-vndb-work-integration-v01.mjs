#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'vndb-work-integration-apply-v0.1'
const DEFAULT_INPUT = 'data_local/staging/vndb-work-integration/vndb-work-integration-v01-ready.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/vndb-work-integration'
const CONFIRM = 'apply-vndb-work-integration-v01'
const ALLOWED_ACTIONS = new Set(['vndb_enrich_marked_existing_work', 'vndb_overwrite_unmarked_existing_work'])
const PROTECTED_MARKERS = ['bangumi', 'mangadex', 'ndl', 'wikidata']
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

function repairInternalTitleSpaces(value) {
  let text = cleanLine(value)
  for (let i = 0; i < 8; i += 1) {
    const next = text
      .replace(/([\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af])[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+([\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af])/gu, '$1$2')
      .replace(/([\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af])[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+([）》」』】、。！？：；,.!?])/gu, '$1$2')
      .replace(/([A-Za-z])[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+([級级])/gu, '$1$2')
      .replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+([!！?？])/gu, '$1')
      .replace(TITLE_SEPARATOR_RE, ' ')
      .trim()
    if (next === text) break
    text = next
  }
  return text
}

function suspiciousTitleSpaceScore(value) {
  const text = cleanLine(value)
  let score = 0
  score += (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af][\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af]/gu) || []).length
  score += (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af][\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+[）》」』】、。！？：；,.!?]/gu) || []).length
  score += (text.match(/[A-Za-z][\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+[級级]/gu) || []).length
  return score
}

function cleanTitleText(value) {
  return repairInternalTitleSpaces(value)
}

function normalizeText(value) {
  return cleanTitleText(value).normalize('NFKC').toLowerCase()
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
    .map((item) => ({ label: cleanLine(item?.label), url: val(item?.url).replace(/\/+$/u, '') }))
    .filter((item) => item.url)
}

function candidateSourceRows(doc) {
  return list(doc?.candidateSources)
    .map((item) => ({
      source: val(item?.source),
      label: cleanLine(item?.label),
      externalId: val(item?.externalId),
      url: val(item?.url).replace(/\/+$/u, ''),
      fetchedAt: item?.fetchedAt,
      note: val(item?.note),
    }))
    .filter((item) => item.source || item.externalId || item.url || item.note)
}

function existingSearchTextValues(work) {
  return val(work?.searchText) ? val(work.searchText).split(/[\r\n|]+/u).map(cleanTitleText).filter(Boolean) : []
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
  if (ids.vndbId || /vndb|vndb\.org/u.test(haystack)) markers.add('vndb')
  return [...markers]
}

function hasSummary(work) {
  if (!work?.summary) return false
  if (typeof work.summary === 'string') return Boolean(val(work.summary))
  return JSON.stringify(work.summary).length > 80
}

function mergeSourceLinks(existing, additions) {
  const rows = [...sourceLinkRows({ sourceLinks: existing })]
  const seen = new Set(rows.map((item) => val(item.url).toLowerCase()))
  let added = 0
  for (const item of additions || []) {
    const row = { label: cleanLine(item?.label || 'VNDB'), url: val(item?.url).replace(/\/+$/u, '') }
    if (!row.url || seen.has(row.url.toLowerCase())) continue
    rows.push(row)
    seen.add(row.url.toLowerCase())
    added += 1
  }
  return { value: rows, added }
}

function mergeCandidateSources(existing, additions) {
  const rows = [...candidateSourceRows({ candidateSources: existing })]
  const keyOf = (item) => [val(item.source).toLowerCase(), val(item.externalId).toLowerCase(), val(item.url).toLowerCase(), val(item.note)].join('|')
  const seen = new Set(rows.map(keyOf))
  let added = 0
  for (const item of additions || []) {
    const row = {
      source: val(item?.source) || 'vndb',
      label: cleanLine(item?.label || 'VNDB'),
      externalId: val(item?.externalId),
      url: val(item?.url).replace(/\/+$/u, ''),
      fetchedAt: item?.fetchedAt,
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

function uniqueSearchTextLines(existingSearchText, additions) {
  const existing = existingSearchTextValues({ searchText: existingSearchText })
  const accepted = uniqueBy([...existing, ...(additions || []).map(cleanTitleText).filter(Boolean)], normalizeText)
  const existingKeys = new Set(existing.map(normalizeText).filter(Boolean))
  const added = accepted.filter((item) => !existingKeys.has(normalizeText(item)))
  return { value: accepted.join('\n'), added }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`)
  return payload
}

function authHeaders(token) {
  return token ? { Authorization: `JWT ${token}` } : {}
}

function validatePlan(plan) {
  const blockers = []
  const id = val(plan?.vndbId).toLowerCase()
  const values = [
    plan?.fieldUpdates?.title,
    plan?.fieldUpdates?.originalTitle,
    ...list(plan?.fieldAdditions?.searchTextAdditions),
    ...list(plan?.titleCandidates),
  ].map((item) => val(item)).filter(Boolean)
  const candidateRows = list(plan?.fieldAdditions?.candidateSources)

  if (!id || !/^v\d+$/u.test(id)) blockers.push('missing_vndb_id')
  if (!val(plan?.key)) blockers.push('missing_key')
  if (!val(plan?.work?.id)) blockers.push('missing_work_id')
  if (!ALLOWED_ACTIONS.has(val(plan?.action))) blockers.push('unexpected_action')
  if (plan?.planStatus !== 'ready_for_apply_review') blockers.push('not_ready_for_apply_review')
  if (list(plan?.blockers).length) blockers.push('plan_blockers_present')
  if (!candidateRows.some((item) => val(item?.source) === 'vndb' && val(item?.externalId).toLowerCase() === id)) blockers.push('missing_vndb_candidate_source_marker')
  for (const item of values) {
    const clean = cleanTitleText(item)
    if (suspiciousTitleSpaceScore(clean) > 0) blockers.push('suspicious_title_spacing_after_cleaning')
    if (CJKISH_TITLE_RE.test(clean) && /^\s|\s$/u.test(clean)) blockers.push('suspicious_title_edge_spacing_after_cleaning')
  }
  return uniqueBy(blockers, (item) => item)
}

function buildPatch(plan, work, row) {
  const patch = {}
  const changedFields = []
  const details = {}
  const ids = externalIdsOf(work)
  const vndbId = val(plan.vndbId).toLowerCase()
  const qid = val(plan.wikidataQid).toUpperCase()
  const markers = sourceMarkersOf(work)
  const protectedMarkers = markers.filter((marker) => PROTECTED_MARKERS.includes(marker))

  if (ids.vndbId && ids.vndbId.toLowerCase() !== vndbId) row.blockers.push('current_vndb_id_conflict')
  if (ids.wikidataQid && qid && ids.wikidataQid.toUpperCase() !== qid) row.blockers.push('current_wikidata_qid_conflict')
  if (plan.action === 'vndb_overwrite_unmarked_existing_work' && protectedMarkers.length) {
    row.blockers.push(`current_work_already_has_protected_marker:${protectedMarkers.join(',')}`)
  }

  if (plan.action === 'vndb_overwrite_unmarked_existing_work') {
    const title = cleanTitleText(plan?.fieldUpdates?.title)
    const originalTitle = cleanTitleText(plan?.fieldUpdates?.originalTitle)
    if (title && normalizeText(title) !== normalizeText(work.title)) {
      patch.title = title
      changedFields.push('title')
    }
    if (originalTitle && normalizeText(originalTitle) !== normalizeText(work.originalTitle)) {
      patch.originalTitle = originalTitle
      changedFields.push('originalTitle')
    }
    if (work.chosenBaseSource !== 'vndb') {
      patch.chosenBaseSource = 'vndb'
      changedFields.push('chosenBaseSource')
    }
  }

  const searchText = uniqueSearchTextLines(work.searchText, list(plan?.fieldAdditions?.searchTextAdditions))
  if (searchText.added.length) {
    patch.searchText = searchText.value
    changedFields.push('searchText')
    details.searchTextAdded = searchText.added
  }

  const nextIds = { ...(work.externalIds || {}) }
  if (!ids.vndbId && vndbId) {
    nextIds.vndbId = vndbId
    patch.externalIds = nextIds
    changedFields.push('externalIds.vndbId')
  }
  if (!ids.wikidataQid && qid) {
    nextIds.wikidataQid = qid
    patch.externalIds = nextIds
    changedFields.push('externalIds.wikidataQid')
  }

  const sourceLinks = mergeSourceLinks(work.sourceLinks, plan?.fieldAdditions?.sourceLinks)
  if (sourceLinks.added) {
    patch.sourceLinks = sourceLinks.value
    changedFields.push('sourceLinks')
  }

  const candidateSources = mergeCandidateSources(work.candidateSources, plan?.fieldAdditions?.candidateSources)
  if (candidateSources.added) {
    patch.candidateSources = candidateSources.value
    changedFields.push('candidateSources')
  }

  if (plan?.fieldUpdates?.summary && !hasSummary(work)) {
    patch.summary = plan.fieldUpdates.summary
    changedFields.push('summary')
  }

  const plannedEvidence = val(plan?.fieldUpdates?.evidenceNote)
  if (plannedEvidence && plannedEvidence !== val(work.evidenceNote)) {
    patch.evidenceNote = plannedEvidence
    changedFields.push('evidenceNote')
  }

  for (const item of [patch.title, patch.originalTitle, ...(details.searchTextAdded || [])]) {
    if (suspiciousTitleSpaceScore(item) > 0) row.blockers.push('suspicious_title_spacing_after_final_cleaning')
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
  const login = await requestJson(`${base}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
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
      vndbId: val(plan?.vndbId),
      workId: val(plan?.work?.id),
      workTitle: val(plan?.work?.title),
      mode: apply ? 'apply' : 'dry-run',
      action: val(plan?.action),
      status: '',
      blockers: validatePlan(plan),
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
    rows: `${outDir}/vndb-work-integration-apply-v01.rows.jsonl`,
    wouldPatch: `${outDir}/vndb-work-integration-apply-v01-would-patch.jsonl`,
    patched: `${outDir}/vndb-work-integration-apply-v01-patched.jsonl`,
    blocked: `${outDir}/vndb-work-integration-apply-v01-blocked.jsonl`,
    summary: `${outDir}/vndb-work-integration-apply-v01-summary.json`,
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
    byAction: countBy(rows, 'action'),
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
      writableFields: ['title', 'originalTitle', 'chosenBaseSource', 'summary', 'evidenceNote', 'searchText', 'externalIds.vndbId', 'externalIds.wikidataQid', 'sourceLinks', 'candidateSources'],
      protectedMarkedWorksAreEnrichedOnly: true,
      unmarkedMatchedWorksMayBeOverwritten: true,
      alwaysAddsVndbMarkerWhenMissing: true,
      allVndbTitlesGoToSearchText: true,
      writesSummaryOnlyWhenMissing: true,
      hidesDescriptionWhenSummaryExists: true,
      doesNotWriteDates: true,
      doesNotWriteMediaTypeOrRiskFields: true,
      doesNotDownloadImages: true,
      doesNotWriteTagsOrCreators: true,
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
