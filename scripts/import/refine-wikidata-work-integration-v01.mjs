#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'wikidata-work-integration-refine-v0.3'
const DEFAULT_INPUT = 'data_local/staging/wikidata-work-integration/wikidata-work-integration-v01.rows.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/wikidata-work-integration'
const MAX_STRICT_SEARCH_TEXT_ADDITIONS = 12
const ALLOWED_STRICT_WARNINGS = new Set([
  'has_search_text_additions',
  'has_source_metadata_additions',
])
const ALLOWED_STRICT_MATCH_STATUS = new Set([
  'matched_by_title_with_higher_priority_marker',
  'matched_by_wikidata_qid',
  'matched_by_bangumi_id',
])
const DISALLOWED_ALIGNMENT_PREFIX = 'alignment_status_review:'

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

function normalizeText(value) {
  return val(value).normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ')
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
    const raw = typeof key === 'function' ? key(row) : row?.[key]
    const value = val(raw) || 'missing'
    out[value] = (out[value] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function isInternalMediaKey(value) {
  return /^(ANIME|MANGA|NOVEL|GAME)-\d+$/iu.test(val(value))
}

function internalMediaKeys(row) {
  return uniqueBy([
    ...list(row.titleCandidates),
    ...list(row.fieldAdditions?.searchTextAdditions),
    ...list(row.rewriteCandidatePreview?.proposedSearchTextAdditions),
    row.createCandidatePreview?.title,
    row.createCandidatePreview?.originalTitle,
    row.rewriteCandidatePreview?.proposedTitle,
    row.rewriteCandidatePreview?.proposedOriginalTitle,
  ].filter(isInternalMediaKey), (item) => item.toUpperCase())
}

function hasInternalMediaKey(row) {
  return internalMediaKeys(row).length > 0
}

function cleanSearchTextAdditions(row) {
  return uniqueBy(list(row.fieldAdditions?.searchTextAdditions).filter((item) => !isInternalMediaKey(item)), normalizeText)
}

function cleanTitleCandidates(row) {
  return uniqueBy(list(row.titleCandidates).filter((item) => !isInternalMediaKey(item)), normalizeText)
}

function disallowedWarnings(row) {
  return list(row.warnings).filter((warning) => {
    if (String(warning).startsWith(DISALLOWED_ALIGNMENT_PREFIX)) return true
    return !ALLOWED_STRICT_WARNINGS.has(warning)
  })
}

function strictBlockers(row) {
  const blockers = []
  const additions = cleanSearchTextAdditions(row)
  const warnings = disallowedWarnings(row)
  const markers = list(row.higherPriorityMarkers)

  if (row.planStatus !== 'ready_for_apply_review') blockers.push('not_from_ready_plan_status')
  if (row.action !== 'enrich_search_text_for_marked_existing_work') blockers.push('not_marked_existing_work_enrichment')
  if (!ALLOWED_STRICT_MATCH_STATUS.has(row.matchStatus)) blockers.push(`match_status_not_strict:${row.matchStatus || 'missing'}`)
  if (!markers.length && row.matchStatus !== 'matched_by_wikidata_qid' && row.matchStatus !== 'matched_by_bangumi_id') blockers.push('missing_higher_priority_marker')
  if (list(row.blockers).length) blockers.push('original_row_has_blockers')
  if (list(row.contentAdvisories).length) blockers.push('content_advisory_requires_marked_content_flow')
  if (!additions.length) blockers.push('no_clean_search_text_additions_after_internal_key_filter')
  if (additions.length > MAX_STRICT_SEARCH_TEXT_ADDITIONS) blockers.push('too_many_search_text_additions_for_strict_pass')
  if (warnings.length) blockers.push(...warnings.map((warning) => `disallowed_warning:${warning}`))
  if (row.candidateFlags?.bestMaybeCompany) blockers.push('candidate_maybe_company')
  if (row.candidateFlags?.bestMaybeRealPersonOrLiveAction) blockers.push('candidate_maybe_real_person_or_live_action')
  if (row.candidateFlags?.bestMaybeWork === false) blockers.push('candidate_not_marked_as_work')

  return uniqueBy(blockers, (item) => item)
}

function refinedRow(row) {
  const cleanAdditions = cleanSearchTextAdditions(row)
  const cleanTitles = cleanTitleCandidates(row)
  const blockers = strictBlockers(row)
  const filteredKeys = internalMediaKeys(row)

  return {
    ...row,
    refinement: {
      version: VERSION,
      strictReady: blockers.length === 0,
      strictBlockers: blockers,
      originalSearchTextAdditionCount: list(row.fieldAdditions?.searchTextAdditions).length,
      cleanSearchTextAdditionCount: cleanAdditions.length,
      internalMediaKeyFiltered: filteredKeys.length > 0,
      internalMediaKeysFiltered: filteredKeys,
      maxStrictSearchTextAdditions: MAX_STRICT_SEARCH_TEXT_ADDITIONS,
      allowedStrictWarnings: [...ALLOWED_STRICT_WARNINGS],
    },
    titleCandidatesClean: cleanTitles,
    fieldAdditions: {
      ...(row.fieldAdditions || {}),
      searchTextAdditions: cleanAdditions,
    },
    safety: {
      ...(row.safety || {}),
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      strictReadyWritesSearchTextOnlyInFuturePass: true,
      sourceMetadataDeferredFromStrictPass: true,
    },
  }
}

function strictReadyDedupeKey(row) {
  if (row.work?.id) return `work:${row.work.id}`
  if (row.qid) return `qid:${row.qid}`
  return `row:${row.key}`
}

function groupRows(rows, getKey) {
  const groups = new Map()
  for (const row of rows) {
    const key = getKey(row)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return groups
}

function mergeStrictReadyGroup(group) {
  const sorted = [...group].sort((a, b) => {
    const bCount = list(b.fieldAdditions?.searchTextAdditions).length
    const aCount = list(a.fieldAdditions?.searchTextAdditions).length
    if (bCount !== aCount) return bCount - aCount
    if (a.confidence === 'high' && b.confidence !== 'high') return -1
    if (b.confidence === 'high' && a.confidence !== 'high') return 1
    return val(a.key).localeCompare(val(b.key))
  })
  const base = sorted[0]
  const additions = uniqueBy(sorted.flatMap((row) => list(row.fieldAdditions?.searchTextAdditions)), normalizeText)
  const titleCandidatesClean = uniqueBy(sorted.flatMap((row) => list(row.titleCandidatesClean)), normalizeText)
  const internalKeys = uniqueBy(sorted.flatMap((row) => list(row.refinement?.internalMediaKeysFiltered)), (item) => item.toUpperCase())
  const qids = uniqueBy(sorted.map((row) => row.qid).filter(Boolean), (item) => item)
  const workIds = uniqueBy(sorted.map((row) => row.work?.id).filter(Boolean), (item) => item)
  const blockers = []

  if (qids.length > 1) blockers.push('multiple_wikidata_qids_for_same_work')
  if (!additions.length) blockers.push('no_clean_search_text_additions_after_dedupe')
  if (additions.length > MAX_STRICT_SEARCH_TEXT_ADDITIONS) blockers.push('too_many_search_text_additions_after_dedupe')

  return {
    ...base,
    fieldAdditions: {
      ...(base.fieldAdditions || {}),
      searchTextAdditions: additions,
    },
    titleCandidatesClean,
    refinement: {
      ...(base.refinement || {}),
      version: VERSION,
      strictDedupeReady: blockers.length === 0,
      strictDedupeBlockers: blockers,
      strictDedupeKey: strictReadyDedupeKey(base),
      duplicateStrictReadyRowsMerged: sorted.length,
      sourceRowKeysMerged: sorted.map((row) => row.key),
      qidsMerged: qids,
      workIdsMerged: workIds,
      cleanSearchTextAdditionCountAfterDedupe: additions.length,
      internalMediaKeysFiltered: internalKeys,
      internalMediaKeyFiltered: internalKeys.length > 0,
    },
    safety: {
      ...(base.safety || {}),
      futureApplyShouldUseStrictReadyDeduped: true,
      futureApplyWritesSearchTextOnly: true,
    },
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const rows = readJsonl(input).map(refinedRow)

  const strictReady = rows.filter((row) => row.refinement.strictReady)
  const strictReadyDedupedAll = [...groupRows(strictReady, strictReadyDedupeKey).values()].map(mergeStrictReadyGroup)
  const strictReadyDeduped = strictReadyDedupedAll.filter((row) => row.refinement.strictDedupeReady)
  const strictReadyDedupeReview = strictReadyDedupedAll.filter((row) => !row.refinement.strictDedupeReady)
  const strictBlocked = rows.filter((row) => !row.refinement.strictReady)
  const adultOrMarked = rows.filter((row) => list(row.contentAdvisories).length)
  const internalKeyFiltered = rows.filter((row) => row.refinement.internalMediaKeyFiltered)
  const internalKeyOnlyBlocked = rows.filter((row) => row.refinement.strictBlockers.includes('no_clean_search_text_additions_after_internal_key_filter'))
  const rewriteCandidates = rows.filter((row) => row.rewriteCandidatePreview)
  const createCandidates = rows.filter((row) => row.createCandidatePreview)

  fs.mkdirSync(outDir, { recursive: true })
  const outputs = {
    refinedRows: `${outDir}/wikidata-work-integration-v01-refined.rows.jsonl`,
    strictReady: `${outDir}/wikidata-work-integration-v01-strict-ready.jsonl`,
    strictReadyDeduped: `${outDir}/wikidata-work-integration-v01-strict-ready-deduped.jsonl`,
    strictReadyDedupeReview: `${outDir}/wikidata-work-integration-v01-strict-ready-dedupe-review.jsonl`,
    strictBlocked: `${outDir}/wikidata-work-integration-v01-strict-blocked.jsonl`,
    adultOrMarked: `${outDir}/wikidata-work-integration-v01-adult-or-marked-candidates.jsonl`,
    internalKeyFiltered: `${outDir}/wikidata-work-integration-v01-title-key-filtered.rows.jsonl`,
    internalKeyOnlyBlocked: `${outDir}/wikidata-work-integration-v01-title-key-only-blocked.rows.jsonl`,
    sample: `${outDir}/wikidata-work-integration-v01-refined-sample.jsonl`,
    summary: `${outDir}/wikidata-work-integration-v01-refined-summary.json`,
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    input,
    rowsRead: rows.length,
    strictReadyRows: strictReady.length,
    strictReadyDedupedRows: strictReadyDeduped.length,
    strictReadyDedupeReviewRows: strictReadyDedupeReview.length,
    strictReadyDuplicateRowsMerged: strictReady.length - strictReadyDedupedAll.length,
    strictBlockedRows: strictBlocked.length,
    adultOrMarkedRows: adultOrMarked.length,
    internalKeyFilteredRows: internalKeyFiltered.length,
    internalKeyOnlyBlockedRows: internalKeyOnlyBlocked.length,
    rewriteCandidateRows: rewriteCandidates.length,
    createCandidateRows: createCandidates.length,
    byOriginalPlanStatus: countBy(rows, 'planStatus'),
    byOriginalAction: countBy(rows, 'action'),
    byStrictBlocker: countBy(rows.flatMap((row) => row.refinement.strictBlockers), (item) => item),
    byStrictDedupeBlocker: countBy(strictReadyDedupeReview.flatMap((row) => row.refinement.strictDedupeBlockers), (item) => item),
    byContentAdvisory: countBy(rows.flatMap((row) => row.contentAdvisories || []), (item) => item),
    byHigherPriorityMarker: countBy(rows.flatMap((row) => row.higherPriorityMarkers || []), (item) => item),
    outputs,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      strictReadyFutureWritableFields: ['searchText'],
      futureApplyInput: outputs.strictReadyDeduped,
      sourceMetadataDeferredFromStrictPass: true,
      rewriteAndCreateRemainPreviewOnly: true,
      internalMediaKeysFilteredNotBlocking: true,
      strictReadyRowsDedupedByWork: true,
      adultOrMarkedRowsExportedSeparately: true,
      maxStrictSearchTextAdditions: MAX_STRICT_SEARCH_TEXT_ADDITIONS,
    },
    nextStep: 'Review strict-ready-deduped rows. Future guarded apply should read only strict-ready-deduped and write searchText only. Adult/marked, rewrite, create, internal-key-only, and dedupe-review rows remain separate review flows.',
  }

  writeJsonl(outputs.refinedRows, rows)
  writeJsonl(outputs.strictReady, strictReady)
  writeJsonl(outputs.strictReadyDeduped, strictReadyDeduped)
  writeJsonl(outputs.strictReadyDedupeReview, strictReadyDedupeReview)
  writeJsonl(outputs.strictBlocked, strictBlocked)
  writeJsonl(outputs.adultOrMarked, adultOrMarked)
  writeJsonl(outputs.internalKeyFiltered, internalKeyFiltered)
  writeJsonl(outputs.internalKeyOnlyBlocked, internalKeyOnlyBlocked)
  writeJsonl(outputs.sample, [...strictReadyDeduped.slice(0, 30), ...strictReadyDedupeReview.slice(0, 20), ...adultOrMarked.slice(0, 20), ...internalKeyOnlyBlocked.slice(0, 20), ...rewriteCandidates.slice(0, 20), ...createCandidates.slice(0, 20)])
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')

  console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
}

main()
