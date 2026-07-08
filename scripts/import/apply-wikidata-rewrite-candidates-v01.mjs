#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'wikidata-rewrite-candidates-apply-v0.1'
const DEFAULT_INPUT = 'data_local/staging/wikidata-work-integration/wikidata-rewrite-candidates-plan-v01-pass.rows.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/wikidata-work-integration'
const CONFIRM = 'apply-wikidata-rewrite-candidates-v01'
const REQUIRED_DECISION = 'safe_wikidata_marker_and_search_text'
const MAX_SEARCH_TEXT_ADDITIONS = 8

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

function normalizeText(value) {
  return cleanLine(value).normalize('NFKC').toLowerCase()
}

function normalizeUrl(value) {
  return val(value).replace(/\/+$/u, '')
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
    const value = typeof key === 'function' ? key(row) : row[key]
    const name = val(value) || 'missing'
    out[name] = (out[name] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function isInternalMediaKey(value) {
  return /^(ANIME|MANGA|NOVEL|GAME)-\d+$/iu.test(val(value))
}

function uniqueSearchTextLines(existingSearchText, additions) {
  const existing = val(existingSearchText)
  const lines = existing ? existing.split(/[\r\n|]+/u).map(cleanLine).filter(Boolean) : []
  const seen = new Set(lines.map(normalizeText).filter(Boolean))
  const accepted = [...lines]
  const added = []
  for (const item of additions || []) {
    const line = cleanLine(item)
    const key = normalizeText(line)
    if (!key || seen.has(key)) continue
    seen.add(key)
    accepted.push(line)
    added.push(line)
  }
  return { value: accepted.join('\n'), added }
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

function externalIdsOf(work) {
  const ids = work?.externalIds
  if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}
  return Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, val(value)]).filter(([, value]) => value))
}

function sourceLinksOf(work) {
  return (Array.isArray(work?.sourceLinks) ? work.sourceLinks : [])
    .map((item) => ({ label: val(item?.label), url: normalizeUrl(item?.url) }))
    .filter((item) => item.url)
}

function candidateSourcesOf(work) {
  return (Array.isArray(work?.candidateSources) ? work.candidateSources : [])
    .map((item) => ({
      source: val(item?.source),
      label: val(item?.label),
      externalId: val(item?.externalId),
      url: normalizeUrl(item?.url),
      fetchedAt: val(item?.fetchedAt),
      note: val(item?.note),
    }))
    .filter((item) => item.source || item.externalId || item.url)
}

function mergeSourceLinks(existing, additions) {
  const rows = [...sourceLinksOf({ sourceLinks: existing })]
  const seen = new Set(rows.map((item) => normalizeUrl(item.url)))
  const added = []
  for (const item of additions || []) {
    const url = normalizeUrl(item?.url)
    if (!url || seen.has(url)) continue
    const next = { label: val(item?.label) || 'Wikidata', url }
    rows.push(next)
    added.push(next)
    seen.add(url)
  }
  return { value: rows, added }
}

function mergeCandidateSources(existing, additions) {
  const rows = [...candidateSourcesOf({ candidateSources: existing })]
  const seen = new Set(rows.map((item) => [val(item.source), val(item.externalId), normalizeUrl(item.url)].join('|')))
  const added = []
  for (const item of additions || []) {
    const next = {
      source: val(item?.source) || 'wikidata',
      label: val(item?.label) || 'Wikidata',
      externalId: val(item?.externalId),
      url: normalizeUrl(item?.url),
      fetchedAt: val(item?.fetchedAt) || new Date().toISOString(),
      note: val(item?.note),
    }
    const key = [next.source, next.externalId, next.url].join('|')
    if ((!next.source && !next.externalId && !next.url) || seen.has(key)) continue
    rows.push(next)
    added.push(next)
    seen.add(key)
  }
  return { value: rows, added }
}

function validatePassRow(row) {
  const blockers = []
  const additions = list(row?.searchTextAdditions).map(cleanLine).filter(Boolean)
  const marker = row?.markerAdditions || {}
  const qid = val(row?.qid)
  const markerQid = val(marker?.externalIds?.wikidataQid)

  if (row?.pass !== true) blockers.push('pass_row_not_true')
  if (val(row?.decision) !== REQUIRED_DECISION) blockers.push('unexpected_decision')
  if (val(row?.confidence) !== 'high') blockers.push('unexpected_confidence')
  if (list(row?.blockers).length) blockers.push('pass_row_has_blockers')
  if (!val(row?.workId)) blockers.push('missing_work_id')
  if (!qid) blockers.push('missing_qid')
  if (!markerQid) blockers.push('missing_marker_wikidata_qid')
  if (qid && markerQid && qid !== markerQid) blockers.push('qid_marker_mismatch')
  if (!additions.length) blockers.push('no_search_text_additions')
  if (additions.length > MAX_SEARCH_TEXT_ADDITIONS) blockers.push('too_many_search_text_additions')
  for (const addition of additions) {
    if (isInternalMediaKey(addition)) blockers.push('internal_media_key_in_search_text_additions')
  }
  if (!list(marker?.sourceLinks).length) blockers.push('missing_wikidata_source_link_marker')
  if (!list(marker?.candidateSources).length) blockers.push('missing_wikidata_candidate_source_marker')

  return uniqueBy(blockers, (item) => item)
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

  const allPassRows = readJsonl(input)
  const passRows = limit > 0 ? allPassRows.slice(0, limit) : allPassRows
  const login = await requestJson(`${base}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  const token = login?.token
  if (!token) throw new Error('Payload login did not return a token')
  const auth = { Authorization: `JWT ${token}` }

  const rows = []
  let wouldPatch = 0
  let patched = 0
  let alreadyCurrent = 0
  let blocked = 0
  let failed = 0
  let payloadPatchRequests = 0

  for (const passRow of passRows) {
    const row = {
      key: val(passRow?.key),
      qid: val(passRow?.qid),
      workId: val(passRow?.workId),
      workTitle: val(passRow?.workTitle),
      mode: apply ? 'apply' : 'dry-run',
      status: '',
      blockers: validatePassRow(passRow),
      changedFields: [],
      additions: {
        searchText: [],
        externalIds: {},
        sourceLinks: [],
        candidateSources: [],
      },
    }

    try {
      if (!row.blockers.length) {
        const doc = await requestJson(`${base}/api/works/${encodeURIComponent(row.workId)}?depth=0&draft=true`, { headers: auth })
        const work = doc?.doc || doc
        if (!work?.id) row.blockers.push('work_not_found')
        else {
          const existingIds = externalIdsOf(work)
          const desiredQid = val(passRow.markerAdditions?.externalIds?.wikidataQid)
          if (existingIds.wikidataQid && existingIds.wikidataQid !== desiredQid) row.blockers.push('existing_wikidata_qid_conflict')

          const searchText = uniqueSearchTextLines(work.searchText, passRow.searchTextAdditions)
          row.additions.searchText = searchText.added
          if (searchText.added.length) row.changedFields.push('searchText')

          const externalIds = { ...(work.externalIds || {}) }
          if (desiredQid && !existingIds.wikidataQid) {
            externalIds.wikidataQid = desiredQid
            row.additions.externalIds.wikidataQid = desiredQid
            row.changedFields.push('externalIds')
          }

          const sourceLinks = mergeSourceLinks(work.sourceLinks, passRow.markerAdditions?.sourceLinks)
          if (sourceLinks.added.length) {
            row.additions.sourceLinks = sourceLinks.added
            row.changedFields.push('sourceLinks')
          }

          const candidateSources = mergeCandidateSources(work.candidateSources, passRow.markerAdditions?.candidateSources)
          if (candidateSources.added.length) {
            row.additions.candidateSources = candidateSources.added
            row.changedFields.push('candidateSources')
          }

          if (row.blockers.length) {
            row.status = 'blocked'
            blocked += 1
          } else if (!row.changedFields.length) {
            row.status = 'already_current'
            alreadyCurrent += 1
          } else if (apply) {
            const body = {}
            if (row.changedFields.includes('searchText')) body.searchText = searchText.value
            if (row.changedFields.includes('externalIds')) body.externalIds = externalIds
            if (row.changedFields.includes('sourceLinks')) body.sourceLinks = sourceLinks.value
            if (row.changedFields.includes('candidateSources')) body.candidateSources = candidateSources.value
            payloadPatchRequests += 1
            await requestJson(`${base}/api/works/${encodeURIComponent(row.workId)}?draft=true`, {
              method: 'PATCH',
              headers: auth,
              body: JSON.stringify(body),
            })
            row.status = 'patched'
            patched += 1
          } else {
            row.status = 'would_patch'
            wouldPatch += 1
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
  const actionableRows = rows.filter((item) => item.status === 'would_patch' || item.status === 'patched')
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    mode: apply ? 'apply' : 'dry-run',
    payloadBaseUrl: base,
    input,
    passRowsRead: allPassRows.length,
    passRowsProcessed: passRows.length,
    wouldPatch,
    patched,
    alreadyCurrent,
    blocked,
    failed,
    byStatus: countBy(rows, 'status'),
    byChangedField: countBy(actionableRows.flatMap((item) => item.changedFields), (item) => item),
    byBlocker: countBy(rows.flatMap((item) => item.blockers), (item) => item),
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
      writableFields: ['searchText', 'externalIds.wikidataQid', 'sourceLinks', 'candidateSources'],
      wikiMarkerRequired: true,
      doesNotWritePrimaryFields: true,
      doesNotWrite: ['title', 'originalTitle', 'aliases', 'localizedTitles', 'creators', 'creatorCredits', 'organizations', 'mediaGroup', 'mediaType', 'reviewStatus', 'riskMatrix'],
      maxSearchTextAdditions: MAX_SEARCH_TEXT_ADDITIONS,
    },
  }

  writeJsonl(outputs.rows, rows)
  writeJsonl(outputs.wouldPatch, rows.filter((item) => item.status === 'would_patch'))
  writeJsonl(outputs.patched, rows.filter((item) => item.status === 'patched'))
  writeJsonl(outputs.blocked, rows.filter((item) => item.status === 'blocked' || item.status === 'failed'))
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: failed === 0, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
