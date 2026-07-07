#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'mangadex-ndl-creator-romanization-apply-v0.1'
const DEFAULT_PASS_INPUT = 'data_local/staging/mangadex-ndl-integration/mangadex-ndl-creator-romanization-plan-v01-pass.rows.jsonl'
const DEFAULT_READY_INPUT = 'data_local/staging/mangadex-ndl-integration/mangadex-ndl-work-integration-v01-ready.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/mangadex-ndl-integration'
const CONFIRM = 'apply-mangadex-ndl-creator-romanization-v01'
const TARGET_DECISION = 'candidate_high_confidence_search_text_only'
const TARGET_EVIDENCE = 'embedded_native_name_match'
const TARGET_ACTION = 'enrich_primary_title_matched_bangumi_work'
const MAX_SEARCH_TEXT_ADDITIONS = 6
const ALLOWED_READY_WARNINGS = new Set([
  'raw_source_id_not_bangumi_subject_id',
  'has_search_text_additions',
  'creator_diff_or_missing',
])
const DISALLOWED_REVIEW_TAGS = new Set([
  'possible_short_story_or_chapter_title_additions',
  'many_search_text_additions',
  'special_title_form_anthology_novel_collection',
  'broad_creator_set_possible_collection',
])
const NON_SAFE_MANGADEX_RATINGS = new Set(['suggestive', 'erotica', 'pornographic'])

function val(value) {
  return String(value ?? '').trim()
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) out[key] = true
    else {
      out[key] = next
      i += 1
    }
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

function list(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return value.split(/\s*\|\s*|\r?\n/u).filter(Boolean)
  return []
}

function unique(values) {
  return [...new Set(list(values).map(val).filter(Boolean))]
}

function normalizeText(value) {
  return val(value).normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ')
}

function cleanLine(value) {
  return val(value).replace(/[\r\n\t]+/gu, ' ').replace(/\s+/gu, ' ')
}

function shortLooseFragment(value) {
  const text = cleanLine(value)
  if (!text) return false
  if (/[^\x00-\x7F]/u.test(text)) return false
  const alnum = text.replace(/[^\p{L}\p{N}]+/gu, '')
  const words = text.split(/\s+/u).filter(Boolean)
  return alnum.length > 0 && alnum.length <= 3 && words.length <= 1
}

function contentRatingFromNote(note) {
  const match = val(note).match(/contentRating=([^;]+)/iu)
  return val(match?.[1]).toLowerCase()
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
  return {
    value: accepted.join('\n'),
    added,
  }
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

async function json(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await res.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { raw: text }
  }
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 800)}`)
  return payload
}

function validatePassRow(passRow) {
  const blockers = []
  const tags = unique(passRow?.reviewTags)
  const issues = unique(passRow?.issues)
  const additionCount = Number(passRow?.searchTextAdditionCount || 0)

  if (!val(passRow?.key)) blockers.push('missing_pass_key')
  if (passRow?.pass !== true) blockers.push('pass_row_not_marked_true')
  if (val(passRow?.decision) !== TARGET_DECISION) blockers.push('unexpected_pass_decision')
  if (val(passRow?.evidence) !== TARGET_EVIDENCE) blockers.push('unexpected_creator_evidence')
  if (val(passRow?.confidence) !== 'high') blockers.push('unexpected_pass_confidence')
  if (issues.length) blockers.push('pass_row_has_issues')
  if (additionCount > MAX_SEARCH_TEXT_ADDITIONS) blockers.push('too_many_search_text_additions_for_guarded_apply')
  for (const tag of tags) {
    if (DISALLOWED_REVIEW_TAGS.has(tag)) blockers.push(`disallowed_review_tag:${tag}`)
  }
  return [...new Set(blockers)]
}

function validateReadyPlan(readyPlan, passRow) {
  const blockers = []
  const warnings = unique(readyPlan?.warnings)
  const searchTextAdditions = Array.isArray(readyPlan?.fieldAdditions?.searchTextAdditions)
    ? readyPlan.fieldAdditions.searchTextAdditions.map(cleanLine).filter(Boolean)
    : []
  const sourceLinks = Array.isArray(readyPlan?.fieldAdditions?.sourceLinks) ? readyPlan.fieldAdditions.sourceLinks : []
  const candidateSources = Array.isArray(readyPlan?.fieldAdditions?.candidateSources) ? readyPlan.fieldAdditions.candidateSources : []

  if (!readyPlan) blockers.push('missing_ready_plan_for_pass_key')
  if (readyPlan && readyPlan.planStatus !== 'ready_for_apply_review') blockers.push('ready_plan_not_ready_for_apply_review')
  if (readyPlan && val(readyPlan.action) !== TARGET_ACTION) blockers.push('unsupported_action_for_guarded_apply')
  if (readyPlan && Array.isArray(readyPlan.blockers) && readyPlan.blockers.length) blockers.push('ready_plan_has_blockers')
  if (readyPlan && !val(readyPlan?.work?.id)) blockers.push('missing_work_id')
  if (readyPlan?.createCandidatePreview) blockers.push('create_candidate_preview_not_allowed')
  if (readyPlan && val(passRow?.workId) && val(readyPlan?.work?.id) !== val(passRow.workId)) blockers.push('pass_work_id_mismatch')

  for (const warning of warnings) {
    if (!ALLOWED_READY_WARNINGS.has(warning)) blockers.push(`unexpected_ready_warning:${warning}`)
  }
  if (!searchTextAdditions.length) blockers.push('no_search_text_additions')
  if (searchTextAdditions.length > MAX_SEARCH_TEXT_ADDITIONS) blockers.push('too_many_search_text_additions_for_guarded_apply')
  for (const title of searchTextAdditions) {
    if (shortLooseFragment(title)) blockers.push('short_search_text_fragment_requires_manual_review')
  }
  for (const source of candidateSources) {
    if (val(source?.source) === 'mangadex') {
      const rating = contentRatingFromNote(source?.note)
      if (rating && NON_SAFE_MANGADEX_RATINGS.has(rating)) blockers.push(`mangadex_content_rating_requires_manual_review:${rating}`)
    }
  }

  return {
    blockers: [...new Set(blockers)],
    warnings,
    searchTextAdditions,
    deferredSourceLinkCount: sourceLinks.length,
    deferredCandidateSourceCount: candidateSources.length,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$|$/u, '')
  const passInput = String(args.pass || args.input || DEFAULT_PASS_INPUT)
  const readyInput = String(args.ready || DEFAULT_READY_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const apply = Boolean(args.apply)
  const confirmMatched = val(args.confirm) === CONFIRM
  const limit = Number(args.limit || 0)

  if (apply && !confirmMatched) throw new Error(`Need --apply --confirm ${CONFIRM}`)

  const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) throw new Error('Missing Payload login env vars')

  const passRowsAll = readJsonl(passInput)
  const passRows = limit > 0 ? passRowsAll.slice(0, limit) : passRowsAll
  const readyRows = readJsonl(readyInput)
  const readyByKey = new Map(readyRows.map((row) => [val(row.key), row]))

  const login = await json(`${base}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
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
    const readyPlan = readyByKey.get(val(passRow.key))
    const readyValidation = validateReadyPlan(readyPlan, passRow)
    const row = {
      key: val(passRow?.key),
      workId: val(readyPlan?.work?.id || passRow?.workId),
      workTitle: val(readyPlan?.work?.title || passRow?.workTitle),
      mode: apply ? 'apply' : 'dry-run',
      action: val(readyPlan?.action),
      status: '',
      blockers: [...validatePassRow(passRow), ...readyValidation.blockers],
      warnings: readyValidation.warnings,
      reviewTags: unique(passRow?.reviewTags),
      deferredSourceLinkCount: readyValidation.deferredSourceLinkCount,
      deferredCandidateSourceCount: readyValidation.deferredCandidateSourceCount,
      changedFields: [],
      additions: {
        searchText: [],
      },
      diffReport: readyPlan?.diffReport || passRow?.rawReadyPlan?.diffReport || null,
    }

    try {
      row.blockers = [...new Set(row.blockers)]
      if (!row.blockers.length) {
        const doc = await json(`${base}/api/works/${encodeURIComponent(row.workId)}?depth=0&draft=true`, { headers: auth })
        const work = doc?.doc || doc
        if (!work?.id) row.blockers.push('work_not_found')
        else {
          const searchText = uniqueSearchTextLines(work.searchText, readyValidation.searchTextAdditions)
          row.additions.searchText = searchText.added

          const body = {}
          if (searchText.added.length) {
            body.searchText = searchText.value
            row.changedFields.push('searchText')
          }

          if (row.blockers.length) {
            row.status = 'blocked'
            blocked += 1
          } else if (!row.changedFields.length) {
            row.status = 'already_current'
            alreadyCurrent += 1
          } else if (apply) {
            payloadPatchRequests += 1
            await json(`${base}/api/works/${encodeURIComponent(row.workId)}?draft=true`, {
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
    rows: `${outDir}/mangadex-ndl-creator-romanization-apply-v01.rows.jsonl`,
    wouldPatch: `${outDir}/mangadex-ndl-creator-romanization-apply-v01-would-patch.jsonl`,
    patched: `${outDir}/mangadex-ndl-creator-romanization-apply-v01-patched.jsonl`,
    blocked: `${outDir}/mangadex-ndl-creator-romanization-apply-v01-blocked.jsonl`,
    summary: `${outDir}/mangadex-ndl-creator-romanization-apply-v01-summary.json`,
  }
  const actionableRows = rows.filter((row) => row.status === 'would_patch' || row.status === 'patched')
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    mode: apply ? 'apply' : 'dry-run',
    payloadBaseUrl: base,
    passInput,
    readyInput,
    passRowsRead: passRowsAll.length,
    passRowsProcessed: passRows.length,
    readyRowsRead: readyRows.length,
    wouldPatch,
    patched,
    alreadyCurrent,
    blocked,
    failed,
    byStatus: countBy(rows, 'status'),
    byChangedField: countBy(actionableRows.flatMap((row) => row.changedFields), (item) => item),
    byBlocker: countBy(rows.flatMap((row) => row.blockers), (item) => item),
    byReviewTag: countBy(rows.flatMap((row) => row.reviewTags), (item) => item),
    deferredSourceMetadata: {
      sourceLinks: rows.reduce((sum, row) => sum + Number(row.deferredSourceLinkCount || 0), 0),
      candidateSources: rows.reduce((sum, row) => sum + Number(row.deferredCandidateSourceCount || 0), 0),
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
      writableFields: ['searchText'],
      sourceMetadataDeferred: true,
      passWhitelistRequired: true,
      requiresPlannerDecision: TARGET_DECISION,
      requiresPlannerEvidence: TARGET_EVIDENCE,
      maxSearchTextAdditions: MAX_SEARCH_TEXT_ADDITIONS,
      rejectsShortStoryCollectionTags: [...DISALLOWED_REVIEW_TAGS],
      doesNotWrite: ['title', 'originalTitle', 'aliases', 'localizedTitles', 'creators', 'creatorCredits', 'organizations', 'mediaGroup', 'mediaType', 'reviewStatus', 'riskMatrix', 'sourceLinks', 'candidateSources'],
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
