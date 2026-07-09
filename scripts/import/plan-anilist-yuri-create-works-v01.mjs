#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'anilist-yuri-create-works-plan-v0.1'
const DEFAULT_INPUT = 'data_local/staging/anilist-work-integration/anilist-work-integration-v01-yuri-create-candidates.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/anilist-yuri-create-works'
const IMPORT_BATCH = 'anilist-yuri-create-v01'
const MAX_SEARCH_TEXT_LINES = 80

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
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
function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; i += 1 }
  }
  return args
}
function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
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
  return ascii || 'anilist-work'
}
function sourceLinks(row) {
  return list(row?.createCandidatePreview?.sourceLinks)
    .map((item) => ({ label: cleanLine(item?.label || 'AniList'), url: val(item?.url).replace(/\s+/gu, '') }))
    .filter((item) => item.label && item.url)
}
function candidateSources(row) {
  const existing = list(row?.createCandidatePreview?.candidateSources)
  const out = existing.map((item) => ({
    source: val(item?.source || 'anilist'),
    label: cleanLine(item?.label || 'AniList'),
    externalId: val(item?.externalId || row?.anilistMediaId),
    url: val(item?.url || row?.anilistUrl).replace(/\s+/gu, ''),
    note: cleanLine([item?.note, 'sourcePolicy=AniList yuri draft creation; metadata-only candidate pending human review'].filter(Boolean).join('; ')),
  })).filter((item) => item.source || item.externalId || item.url || item.note)
  if (!out.length) out.push({ source: 'anilist', label: 'AniList', externalId: val(row?.anilistMediaId), url: val(row?.anilistUrl), note: 'sourcePolicy=AniList yuri draft creation; metadata-only candidate pending human review' })
  return out
}
function yuriMatches(row) { return list(row?.yuriMatches) }
function yuriScore(row) {
  const ranks = yuriMatches(row).map((item) => Number(item?.rank || 0)).filter((n) => Number.isFinite(n))
  return ranks.length ? Math.max(0.1, Math.min(1, Math.max(...ranks) / 100)) : 0
}
function titleOf(row) { return cleanLine(row?.createCandidatePreview?.title || row?.titleCandidates?.[0] || row?.key) }
function originalTitleOf(row, title) {
  const original = cleanLine(row?.createCandidatePreview?.originalTitle)
  return original && normalizeText(original) !== normalizeText(title) ? original : title
}
function searchTextOf(row, title, originalTitle) {
  return uniqueBy([
    title,
    originalTitle,
    ...list(row?.createCandidatePreview?.searchTextAdditions),
    ...list(row?.titleCandidates),
    row?.anilistUrl,
    row?.anilistMediaId ? `anilist:${row.anilistMediaId}` : '',
    row?.malId ? `mal:${row.malId}` : '',
  ]).slice(0, MAX_SEARCH_TEXT_LINES).join('\n')
}
function externalIdsOf(row) {
  const out = {}
  if (val(row?.anilistMediaId || row?.createCandidatePreview?.anilistMediaId)) out.anilistMediaId = val(row?.anilistMediaId || row?.createCandidatePreview?.anilistMediaId)
  if (val(row?.malId || row?.createCandidatePreview?.malId)) out.malId = val(row?.malId || row?.createCandidatePreview?.malId)
  return out
}
function mediaShape(row) {
  const cp = row?.createCandidatePreview || {}
  return {
    mediaGroup: val(cp.mediaGroup || 'unknown'),
    mediaType: val(cp.mediaType || 'unknown'),
    format: val(cp.format || 'unknown'),
  }
}
function buildPlan(row) {
  const blockers = []
  const anilistMediaId = val(row?.anilistMediaId || row?.createCandidatePreview?.anilistMediaId)
  const title = titleOf(row)
  const originalTitle = originalTitleOf(row, title)
  const score = yuriScore(row)
  const slug = `${slugify(title)}-anilist-${anilistMediaId}`

  if (!anilistMediaId) blockers.push('missing_anilist_media_id')
  if (!title) blockers.push('missing_title')
  if (row?.action !== 'anilist_create_candidate_preview') blockers.push('not_anilist_create_candidate_preview')
  if (row?.matchBy !== 'no_match') blockers.push('not_no_match')
  if (!yuriMatches(row).length) blockers.push('missing_yuri_match')
  if (row?.isAdult === true) blockers.push('anilist_adult_content_requires_separate_review')
  const upstreamBlockers = list(row?.blockers).filter((item) => val(item))
  if (upstreamBlockers.length) blockers.push('unexpected_upstream_blockers')

  const payload = {
    title,
    slug,
    siteId: `ANILIST-${anilistMediaId}`,
    rank: 'unknown',
    reviewStatus: 'pending',
    reviewReasons: ['manual_review'],
    evidenceStrength: 'unassessed',
    ratingNotice: 'ai_synthesized_pending_review',
    importBatch: IMPORT_BATCH,
    chosenBaseSource: 'anilist',
    originalTitle,
    ...mediaShape(row),
    yuriCandidateScore: score,
    externalIds: externalIdsOf(row),
    sourceLinks: sourceLinks(row),
    candidateSources: candidateSources(row),
    searchText: searchTextOf(row, title, originalTitle),
    evidenceNote: [
      'Draft Work generated from AniList yuri/girls-love metadata only.',
      'This is a candidate marker, not a reviewed yuri relationship judgement.',
      'Human review and evidence assessment have not been applied.',
      `AniList ID: ${anilistMediaId}`,
      val(row?.malId) ? `MAL ID: ${val(row.malId)}` : '',
      yuriMatches(row).length ? `AniList yuri signals: ${yuriMatches(row).map((m) => `${m.source || 'tag'}:${m.name || ''}:${m.rank || ''}`).join(', ')}` : '',
    ].filter(Boolean).join('\n'),
    status: 'draft',
  }

  return {
    key: val(row.key || `anilist-${anilistMediaId}`),
    anilistMediaId,
    malId: val(row?.malId),
    title,
    action: 'create_anilist_yuri_work_candidate',
    createType: 'anilist_yuri_candidate',
    planStatus: blockers.length ? 'blocked_or_review_required' : 'ready_for_create_dry_run',
    blockers,
    warnings: list(row.warnings),
    payload,
    sourceRow: {
      anilistUrl: val(row.anilistUrl),
      titleCandidates: uniqueBy(row.titleCandidates),
      yuriMatches: yuriMatches(row),
      mediaType: val(row.mediaType),
      format: val(row.format),
      isAdult: row.isAdult === true,
      raw: row.raw,
    },
  }
}
function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || args.outDir || DEFAULT_OUT_DIR)
  const rows = readJsonl(input)
  const plans = rows.map(buildPlan)
  const ready = plans.filter((row) => row.planStatus === 'ready_for_create_dry_run')
  const blocked = plans.filter((row) => row.planStatus !== 'ready_for_create_dry_run')
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    input,
    inputRowsRead: rows.length,
    planRows: plans.length,
    readyRows: ready.length,
    blockedRows: blocked.length,
    byPlanStatus: countBy(plans, 'planStatus'),
    byBlocker: countBy(blocked.flatMap((row) => row.blockers), (item) => item),
    byCreateType: countBy(plans, 'createType'),
    byMediaGroup: countBy(plans, (row) => row.payload?.mediaGroup),
    byMediaType: countBy(plans, (row) => row.payload?.mediaType),
    byFormat: countBy(plans, (row) => row.payload?.format),
    outputs: {
      rows: `${outDir}/anilist-yuri-create-works-v01.rows.jsonl`,
      ready: `${outDir}/anilist-yuri-create-works-v01-ready.jsonl`,
      blocked: `${outDir}/anilist-yuri-create-works-v01-blocked.jsonl`,
      sample: `${outDir}/anilist-yuri-create-works-v01-sample.jsonl`,
      summary: `${outDir}/anilist-yuri-create-works-v01-summary.json`,
    },
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      createsOnlyDraftWorksInFutureApply: true,
      inputMustBeAniListYuriCreateCandidates: true,
      requiresYuriSignal: true,
      blocksAdultRows: true,
      doesNotDownloadImages: true,
      doesNotWriteDates: true,
      doesNotWriteCreatorsOrTags: true,
    },
    nextStep: 'Run guarded create dry-run. Do not apply until dry-run is clean.',
  }
  writeJsonl(summary.outputs.rows, plans)
  writeJsonl(summary.outputs.ready, ready)
  writeJsonl(summary.outputs.blocked, blocked)
  writeJsonl(summary.outputs.sample, [...ready.slice(0, 80), ...blocked.slice(0, 40)])
  writeJson(summary.outputs.summary, summary)
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

main()
