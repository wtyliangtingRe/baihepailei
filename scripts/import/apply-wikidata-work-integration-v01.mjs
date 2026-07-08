#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'wikidata-work-integration-apply-v0.1'
const DEFAULT_INPUT = 'data_local/staging/wikidata-work-integration/wikidata-work-integration-v01-strict-ready-deduped.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/wikidata-work-integration'
const CONFIRM = 'apply-wikidata-work-integration-v01'
const MAX_SEARCH_TEXT_ADDITIONS = 12
const ALLOWED_ACTION = 'enrich_search_text_for_marked_existing_work'
const ALLOWED_MATCH_STATUS = new Set([
  'matched_by_title_with_higher_priority_marker',
  'matched_by_wikidata_qid',
  'matched_by_bangumi_id',
])
const ALLOWED_WARNINGS = new Set([
  'has_search_text_additions',
  'has_source_metadata_additions',
])

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

function authHeaders(token) {
  return token ? { Authorization: `JWT ${token}` } : {}
}

function validatePlanRow(row) {
  const blockers = []
  const additions = list(row?.fieldAdditions?.searchTextAdditions).map(cleanLine).filter(Boolean)
  const warnings = list(row?.warnings)
  const markers = list(row?.higherPriorityMarkers)
  const qids = list(row?.refinement?.qidsMerged)
  const workIds = list(row?.refinement?.workIdsMerged)

  if (!val(row?.key)) blockers.push('missing_key')
  if (!val(row?.work?.id)) blockers.push('missing_work_id')
  if (val(row?.action) !== ALLOWED_ACTION) blockers.push('unexpected_action')
  if (row?.planStatus !== 'ready_for_apply_review') blockers.push('not_ready_for_apply_review')
  if (!ALLOWED_MATCH_STATUS.has(val(row?.matchStatus))) blockers.push(`match_status_not_allowed:${val(row?.matchStatus) || 'missing'}`)
  if (row?.refinement?.strictReady !== true) blockers.push('not_strict_ready')
  if (row?.refinement?.strictDedupeReady !== true) blockers.push('not_strict_dedupe_ready')
  if (list(row?.refinement?.strictBlockers).length) blockers.push('strict_blockers_present')
  if (list(row?.refinement?.strictDedupeBlockers).length) blockers.push('strict_dedupe_blockers_present')
  if (list(row?.blockers).length) blockers.push('original_blockers_present')
  if (list(row?.contentAdvisories).length) blockers.push('content_advisory_requires_marked_content_flow')
  if (!markers.length && row?.matchStatus !== 'matched_by_wikidata_qid' && row?.matchStatus !== 'matched_by_bangumi_id') blockers.push('missing_higher_priority_marker')
  if (qids.length > 1) blockers.push('multiple_wikidata_qids_for_same_work')
  if (workIds.length > 1) blockers.push('multiple_work_ids_for_deduped_row')
  if (!additions.length) blockers.push('no_search_text_additions')
  if (additions.length > MAX_SEARCH_TEXT_ADDITIONS) blockers.push('too_many_search_text_additions')

  for (const warning of warnings) {
    if (!ALLOWED_WARNINGS.has(warning)) blockers.push(`unexpected_warning:${warning}`)
  }
  for (const addition of additions) {
    if (isInternalMediaKey(addition)) blockers.push('internal_media_key_in_search_text_additions')
  }

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
      additions: { searchText: [] },
      deferred: {
        externalIds: Object.keys(plan?.fieldAdditions?.externalIds || {}).length,
        sourceLinks: list(plan?.fieldAdditions?.sourceLinks).length,
        candidateSources: list(plan?.fieldAdditions?.candidateSources).length,
      },
      refinement: plan?.refinement || null,
    }

    try {
      if (!row.blockers.length) {
        const doc = await requestJson(`${base}/api/works/${encodeURIComponent(row.workId)}?depth=0&draft=true`, { headers: auth })
        const work = doc?.doc || doc
        if (!work?.id) row.blockers.push('work_not_found')
        else {
          const searchText = uniqueSearchTextLines(work.searchText, plan.fieldAdditions.searchTextAdditions)
          row.additions.searchText = searchText.added
          if (searchText.added.length) row.changedFields.push('searchText')

          if (!row.changedFields.length) {
            row.status = 'already_current'
            alreadyCurrent += 1
          } else if (apply) {
            payloadPatchRequests += 1
            await requestJson(`${base}/api/works/${encodeURIComponent(row.workId)}?draft=true`, {
              method: 'PATCH',
              headers: auth,
              body: JSON.stringify({ searchText: searchText.value }),
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
    rows: `${outDir}/wikidata-work-integration-apply-v01.rows.jsonl`,
    wouldPatch: `${outDir}/wikidata-work-integration-apply-v01-would-patch.jsonl`,
    patched: `${outDir}/wikidata-work-integration-apply-v01-patched.jsonl`,
    blocked: `${outDir}/wikidata-work-integration-apply-v01-blocked.jsonl`,
    summary: `${outDir}/wikidata-work-integration-apply-v01-summary.json`,
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
    deferredSourceMetadata: {
      externalIds: rows.reduce((sum, row) => sum + Number(row.deferred.externalIds || 0), 0),
      sourceLinks: rows.reduce((sum, row) => sum + Number(row.deferred.sourceLinks || 0), 0),
      candidateSources: rows.reduce((sum, row) => sum + Number(row.deferred.candidateSources || 0), 0),
    },
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
      inputMustBeStrictReadyDeduped: true,
      writableFields: ['searchText'],
      sourceMetadataDeferred: true,
      maxSearchTextAdditions: MAX_SEARCH_TEXT_ADDITIONS,
      rejectsContentAdvisories: true,
      rejectsInternalMediaKeys: true,
      doesNotWrite: ['title', 'originalTitle', 'aliases', 'localizedTitles', 'creators', 'creatorCredits', 'organizations', 'mediaGroup', 'mediaType', 'reviewStatus', 'riskMatrix', 'externalIds', 'sourceLinks', 'candidateSources'],
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
