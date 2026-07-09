#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'anilist-adult-marked-plan-v0.1'
const DEFAULT_INPUTS = [
  'data_local/staging/anilist-work-integration/anilist-work-integration-v01-blocked.jsonl',
  'data_local/staging/anilist-yuri-create-works/anilist-yuri-create-works-v01-blocked.jsonl',
]
const DEFAULT_OUT_DIR = 'data_local/staging/anilist-adult-marked'
const IMPORT_BATCH = 'anilist-adult-marked-v01'
const MAX_SEARCH_TEXT_LINES = 100
const ADULT_MARKER_NOTE = 'contentRating=erotica; contentVisibility=adult; adultOrMarkedContent=true; sourcePolicy=AniList adult marked content flow; metadata-only candidate pending human review'

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function parseArgs(argv) {
  const args = { input: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = key === 'input' ? args.input : true
    else {
      if (key === 'input') args.input.push(next)
      else args[key] = next
      i += 1
    }
  }
  return args
}
function cleanLine(value) {
  return val(value)
    .normalize('NFKC')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu, ' ')
    .trim()
}
function normalizeText(value) { return cleanLine(value).normalize('NFKC').toLowerCase() }
function uniqueBy(values, getKey = normalizeText) {
  const seen = new Set()
  const out = []
  for (const item of values || []) {
    const clean = cleanLine(item)
    const key = getKey(clean)
    if (!key || key === '[object object]' || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}
function readJsonl(file) {
  if (!fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
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
function slugify(value) {
  const ascii = cleanLine(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/&/gu, ' and ')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-')
  return ascii || 'anilist-adult-work'
}
function externalIdsOf(doc) {
  const ids = doc?.externalIds
  if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}
  return Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, val(value)]).filter(([, value]) => value))
}
function sourceLinksOf(value) {
  return list(value).map((item) => ({ label: cleanLine(item?.label || 'AniList'), url: val(item?.url).replace(/\s+/gu, '').replace(/\/+$/u, '') })).filter((item) => item.label || item.url)
}
function candidateSourcesOf(value) {
  return list(value).map((item) => ({
    source: val(item?.source || 'anilist'),
    label: cleanLine(item?.label || 'AniList'),
    externalId: val(item?.externalId),
    url: val(item?.url).replace(/\s+/gu, '').replace(/\/+$/u, ''),
    note: cleanLine([item?.note, ADULT_MARKER_NOTE].filter(Boolean).join('; ')),
  })).filter((item) => item.source || item.externalId || item.url || item.note)
}
function splitSearchText(value) { return val(value).split(/[\r\n|]+/u).map(cleanLine).filter(Boolean) }
function titleValues(row) {
  return uniqueBy([
    ...list(row?.titleCandidates),
    row?.createCandidatePreview?.title,
    row?.createCandidatePreview?.originalTitle,
    ...list(row?.createCandidatePreview?.searchTextAdditions),
    row?.work?.title,
    row?.title,
  ])
}
function yuriMatches(row) { return list(row?.yuriMatches || row?.sourceRow?.yuriMatches) }
function yuriScore(row) {
  const ranks = yuriMatches(row).map((item) => Number(item?.rank || 0)).filter((n) => Number.isFinite(n))
  return ranks.length ? Math.max(0.1, Math.min(1, Math.max(...ranks) / 100)) : 0
}
function mediaShape(row) {
  const cp = row?.createCandidatePreview || row?.payload || {}
  return {
    mediaGroup: val(cp.mediaGroup || 'unknown'),
    mediaType: val(cp.mediaType || 'unknown'),
    format: val(cp.format || 'unknown'),
  }
}
function hasAdultBlocker(row) {
  return list(row?.blockers).includes('anilist_adult_content_requires_separate_review') || row?.isAdult === true || row?.sourceRow?.isAdult === true
}
function sourceLinkRows(row) {
  return sourceLinksOf(row?.createCandidatePreview?.sourceLinks || row?.payload?.sourceLinks || row?.fieldUpdates?.sourceLinks)
}
function candidateSourceRows(row) {
  const existing = candidateSourcesOf(row?.createCandidatePreview?.candidateSources || row?.payload?.candidateSources || row?.fieldUpdates?.candidateSources)
  if (existing.length) return existing
  const externalId = val(row?.anilistMediaId || row?.createCandidatePreview?.anilistMediaId || row?.payload?.externalIds?.anilistMediaId)
  const url = val(row?.anilistUrl || row?.createCandidatePreview?.sourceLinks?.[0]?.url || row?.payload?.sourceLinks?.[0]?.url)
  return candidateSourcesOf([{ source: 'anilist', label: 'AniList', externalId, url, note: ADULT_MARKER_NOTE }])
}
function searchTextForCreate(row, title, originalTitle) {
  return uniqueBy([
    title,
    originalTitle,
    ...titleValues(row),
    row?.anilistUrl,
    val(row?.anilistMediaId) ? `anilist:${val(row.anilistMediaId)}` : '',
    val(row?.malId) ? `mal:${val(row.malId)}` : '',
    'contentVisibility:adult',
    'adultOrMarkedContent:true',
  ]).slice(0, MAX_SEARCH_TEXT_LINES).join('\n')
}
function mergeSearchTextForExisting(row) {
  return uniqueBy([
    ...splitSearchText(row?.fieldUpdates?.searchText),
    ...titleValues(row),
    'contentVisibility:adult',
    'adultOrMarkedContent:true',
  ]).slice(0, MAX_SEARCH_TEXT_LINES).join('\n')
}
function buildExistingPlan(row) {
  const blockers = []
  if (!val(row?.work?.id)) blockers.push('missing_work_id')
  if (val(row?.action) !== 'anilist_enrich_existing_work') blockers.push('unexpected_existing_action')
  if (!val(row?.anilistMediaId)) blockers.push('missing_anilist_media_id')
  const patch = { ...(row?.fieldUpdates || {}) }
  delete patch.summary
  delete patch.firstPublishedAt
  delete patch.firstReleasedAt
  delete patch.publishedAt
  patch.sourceLinks = sourceLinkRows(row)
  patch.candidateSources = candidateSourceRows(row)
  patch.externalIds = { ...externalIdsOf(row?.fieldUpdates), anilistMediaId: val(row?.anilistMediaId) }
  if (val(row?.malId)) patch.externalIds.malId = val(row.malId)
  const mergedSearch = mergeSearchTextForExisting(row)
  if (mergedSearch) patch.searchText = mergedSearch
  return {
    key: val(row?.key || `anilist-${row?.anilistMediaId}`),
    anilistMediaId: val(row?.anilistMediaId),
    malId: val(row?.malId),
    title: cleanLine(row?.work?.title || titleValues(row)[0]),
    action: 'anilist_adult_mark_existing_work',
    planStatus: blockers.length ? 'blocked_or_review_required' : 'ready_for_apply_review',
    adultPlanType: 'existing_work_marker_enrich',
    blockers,
    warnings: uniqueBy([...list(row?.warnings), 'adult_or_marked_content_flow'], (x) => x),
    work: row?.work || null,
    fieldUpdates: patch,
    sourceRow: row,
  }
}
function buildCreatePlan(row) {
  const blockers = []
  const anilistMediaId = val(row?.anilistMediaId || row?.createCandidatePreview?.anilistMediaId || row?.payload?.externalIds?.anilistMediaId)
  const title = cleanLine(row?.createCandidatePreview?.title || row?.payload?.title || titleValues(row)[0] || `AniList ${anilistMediaId}`)
  const originalTitle = cleanLine(row?.createCandidatePreview?.originalTitle || row?.payload?.originalTitle || title)
  if (!anilistMediaId) blockers.push('missing_anilist_media_id')
  if (!title) blockers.push('missing_title')
  if (!yuriMatches(row).length) blockers.push('adult_no_yuri_signal_not_site_target')
  if (val(row?.matchBy) !== 'no_match') blockers.push('not_no_match')
  if (val(row?.action) !== 'anilist_create_candidate_preview') blockers.push('unexpected_create_action')
  const slug = `${slugify(title)}-anilist-${anilistMediaId}`
  const ids = {}
  if (anilistMediaId) ids.anilistMediaId = anilistMediaId
  if (val(row?.malId || row?.createCandidatePreview?.malId || row?.payload?.externalIds?.malId)) ids.malId = val(row?.malId || row?.createCandidatePreview?.malId || row?.payload?.externalIds?.malId)
  const payload = {
    title,
    slug,
    siteId: `ANILIST-ADULT-${anilistMediaId}`,
    rank: 'unknown',
    reviewStatus: 'pending',
    reviewReasons: ['manual_review', 'adult_or_marked_content'],
    evidenceStrength: 'unassessed',
    ratingNotice: 'ai_synthesized_pending_review',
    importBatch: IMPORT_BATCH,
    chosenBaseSource: 'anilist',
    originalTitle,
    ...mediaShape(row),
    yuriCandidateScore: yuriScore(row),
    externalIds: ids,
    sourceLinks: sourceLinkRows(row),
    candidateSources: candidateSourceRows(row),
    searchText: searchTextForCreate(row, title, originalTitle),
    evidenceNote: [
      'Draft Work generated from AniList adult/marked metadata only.',
      'This is a marked-content candidate, not a reviewed yuri relationship judgement.',
      'Human review and evidence assessment have not been applied.',
      ADULT_MARKER_NOTE,
      `AniList ID: ${anilistMediaId}`,
      ids.malId ? `MAL ID: ${ids.malId}` : '',
      yuriMatches(row).length ? `AniList yuri signals: ${yuriMatches(row).map((m) => `${m.source || 'tag'}:${m.name || ''}:${m.rank || ''}`).join(', ')}` : '',
    ].filter(Boolean).join('\n'),
    status: 'draft',
  }
  return {
    key: val(row?.key || `anilist-${anilistMediaId}`),
    anilistMediaId,
    malId: val(ids.malId),
    title,
    action: 'anilist_adult_create_yuri_work_candidate',
    planStatus: blockers.length ? 'blocked_or_review_required' : 'ready_for_create_dry_run',
    adultPlanType: 'adult_yuri_create_candidate',
    blockers,
    warnings: uniqueBy([...list(row?.warnings), 'adult_or_marked_content_flow'], (x) => x),
    payload,
    sourceRow: row,
  }
}
function buildPlan(row) {
  if (val(row?.action) === 'anilist_enrich_existing_work') return buildExistingPlan(row)
  return buildCreatePlan(row)
}
function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputs = args.input.length ? args.input : DEFAULT_INPUTS
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const sourceRows = []
  const inputStats = []
  for (const file of inputs) {
    const rows = readJsonl(file).map((row) => ({ ...row, __adultInputFile: file }))
    inputStats.push({ file, rows: rows.length })
    sourceRows.push(...rows)
  }
  const adultRows = sourceRows.filter(hasAdultBlocker)
  const deduped = []
  const seen = new Set()
  for (const row of adultRows) {
    const key = val(row?.anilistMediaId || row?.createCandidatePreview?.anilistMediaId || row?.payload?.externalIds?.anilistMediaId || row?.key)
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(row)
  }
  const plans = deduped.map(buildPlan)
  const readyExisting = plans.filter((row) => row.planStatus === 'ready_for_apply_review')
  const readyCreate = plans.filter((row) => row.planStatus === 'ready_for_create_dry_run')
  const ready = [...readyExisting, ...readyCreate]
  const readyKeys = new Set(ready.map((row) => row.key))
  const blocked = plans.filter((row) => !readyKeys.has(row.key))
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    inputs,
    inputStats,
    sourceRowsRead: sourceRows.length,
    adultRows: adultRows.length,
    planRows: plans.length,
    readyRows: ready.length,
    readyExistingRows: readyExisting.length,
    readyCreateRows: readyCreate.length,
    blockedRows: blocked.length,
    byAction: countBy(plans, 'action'),
    byPlanStatus: countBy(plans, 'planStatus'),
    byAdultPlanType: countBy(plans, 'adultPlanType'),
    byBlocker: countBy(blocked.flatMap((row) => row.blockers), (x) => x),
    outputs: {
      rows: `${outDir}/anilist-adult-marked-v01.rows.jsonl`,
      ready: `${outDir}/anilist-adult-marked-v01-ready.jsonl`,
      readyExisting: `${outDir}/anilist-adult-marked-v01-ready-existing.jsonl`,
      readyCreate: `${outDir}/anilist-adult-marked-v01-ready-create.jsonl`,
      blocked: `${outDir}/anilist-adult-marked-v01-blocked.jsonl`,
      sample: `${outDir}/anilist-adult-marked-v01-sample.jsonl`,
      summary: `${outDir}/anilist-adult-marked-v01-summary.json`,
    },
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      adultOrMarkedContentFlow: true,
      ordinaryModeMustHideMarkedRows: true,
      existingWorkApplyWritesOnlyMetadataAndSearchText: true,
      createWritesOnlyDraftWorks: true,
      blocksAdultNoYuriCreateCandidates: true,
      doesNotWriteDates: true,
      doesNotDownloadImages: true,
      doesNotWriteCreatorsOrTags: true,
      doesNotWriteSummaryForAdultRows: true,
    },
    nextStep: 'Run guarded dry-run apply. Do not use --apply until summary and samples are reviewed.',
  }
  writeJsonl(summary.outputs.rows, plans)
  writeJsonl(summary.outputs.ready, ready)
  writeJsonl(summary.outputs.readyExisting, readyExisting)
  writeJsonl(summary.outputs.readyCreate, readyCreate)
  writeJsonl(summary.outputs.blocked, blocked)
  writeJsonl(summary.outputs.sample, [...ready.slice(0, 80), ...blocked.slice(0, 80)])
  writeJson(summary.outputs.summary, summary)
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

main()
