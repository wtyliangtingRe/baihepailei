#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'vndb-yuri-create-works-plan-v0.1'
const DEFAULT_INPUT = 'data_local/staging/vndb-yuri-create-candidates/vndb-yuri-create-candidates-v03-first-wave-ordinary-romance.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/vndb-yuri-create-works'
const IMPORT_BATCH = 'vndb-yuri-first-wave-v01'
const CONFIRM_NOTE = 'VNDB Girl x Girl Romance first-wave candidate. Draft only; not reviewed as a final catalog judgement.'

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

function cleanLine(value) {
  return val(value).normalize('NFKC').replace(/[\r\n\t]+/gu, ' ').replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu, ' ').trim()
}

function normalizeText(value) {
  return cleanLine(value).normalize('NFKC').toLowerCase()
}

function uniqueBy(values, getKey = normalizeText) {
  const seen = new Set()
  const out = []
  for (const item of values || []) {
    const clean = cleanLine(item)
    const key = getKey(clean)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
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
  return ascii || 'vndb-work'
}

function sourceLinks(row) {
  return list(row?.createCandidatePreview?.sourceLinks || row?.fieldAdditions?.sourceLinks)
    .map((item) => ({ label: cleanLine(item?.label), url: val(item?.url).replace(/\s+/gu, '') }))
    .filter((item) => item.label && item.url)
}

function candidateSources(row) {
  return list(row?.createCandidatePreview?.candidateSources || row?.fieldAdditions?.candidateSources)
    .map((item) => ({
      source: val(item?.source) || 'vndb',
      label: cleanLine(item?.label || 'VNDB'),
      externalId: val(item?.externalId || row?.vndbId),
      url: val(item?.url || row?.vndbUrl).replace(/\s+/gu, ''),
      note: cleanLine(item?.note),
    }))
    .filter((item) => item.source || item.externalId || item.url || item.note)
}

function matchedTags(row) {
  return list(row?.yuriCreateCandidate?.matchedTags || row?.yuriCreateCandidateV2?.matchedTags)
}

function tagRating(row, tagId) {
  const tag = matchedTags(row).find((item) => val(item.id).toLowerCase() === tagId)
  const rating = Number(tag?.rating || 0)
  return Number.isFinite(rating) ? rating : 0
}

function titleOf(row) {
  return cleanLine(row?.createCandidatePreview?.title || row?.titleCandidates?.[0] || row?.key)
}

function originalTitleOf(row, title) {
  const original = cleanLine(row?.createCandidatePreview?.originalTitle)
  return original && normalizeText(original) !== normalizeText(title) ? original : title
}

function searchTextOf(row, title, originalTitle) {
  return uniqueBy([title, originalTitle, ...list(row?.createCandidatePreview?.searchTextAdditions), ...list(row?.titleCandidates), ...list(row?.fieldAdditions?.searchTextAdditions)]).join('\n')
}

function externalIdsOf(row) {
  const out = {}
  if (val(row?.vndbId || row?.createCandidatePreview?.vndbId)) out.vndbId = val(row?.vndbId || row?.createCandidatePreview?.vndbId)
  if (val(row?.wikidataQid || row?.createCandidatePreview?.wikidataQid)) out.wikidataQid = val(row?.wikidataQid || row?.createCandidatePreview?.wikidataQid).toUpperCase()
  return out
}

function sensitiveReasons(row) {
  return list(row?.yuriCreateCandidateV2?.sensitiveReasons || row?.yuriCreateCandidate?.sensitiveReasons).map(val).filter(Boolean)
}

function buildPlan(row) {
  const blockers = []
  const vndbId = val(row?.vndbId || row?.createCandidatePreview?.vndbId)
  const title = titleOf(row)
  const originalTitle = originalTitleOf(row, title)
  const g97 = tagRating(row, 'g97')
  const slug = `${slugify(title)}-vndb-${vndbId.replace(/^v/iu, '')}`
  const statusV2 = val(row?.yuriCreateCandidateV2?.status)
  const statusV3 = val(row?.yuriCreateCandidateV3?.status)

  if (!vndbId) blockers.push('missing_vndb_id')
  if (!title) blockers.push('missing_title')
  if (statusV2 !== 'ordinary_romance_create_review') blockers.push('not_ordinary_romance_create_review')
  if (statusV3 !== 'ordinary_romance_create_review') blockers.push('not_v03_ordinary_romance_create_review')
  if (row?.yuriCreateCandidateV3?.firstWaveEligible !== true) blockers.push('not_first_wave_eligible')
  if (g97 < 1) blockers.push('missing_g97_romance_tag_rating')
  if (sensitiveReasons(row).length) blockers.push('sensitive_reasons_present')
  if (list(row?.blockers).filter((item) => val(item) !== 'no_existing_work_match').length) blockers.push('unexpected_upstream_blockers')
  if (row?.matchBy !== 'no_match') blockers.push('not_no_match')

  const payload = {
    title,
    slug,
    siteId: `VNDB-${vndbId.toUpperCase()}`,
    rank: 'unknown',
    reviewStatus: 'pending',
    reviewReasons: ['manual_review'],
    evidenceStrength: 'unassessed',
    ratingNotice: 'ai_synthesized_pending_review',
    importBatch: IMPORT_BATCH,
    chosenBaseSource: 'vndb',
    originalTitle,
    mediaGroup: 'game',
    mediaType: 'visual_novel',
    format: 'visual_novel',
    yuriCandidateScore: Math.max(0.1, Math.min(1, g97 / 3)),
    externalIds: externalIdsOf(row),
    sourceLinks: sourceLinks(row),
    candidateSources: candidateSources(row),
    searchText: searchTextOf(row, title, originalTitle),
    evidenceNote: [
      'Catalog draft generated from VNDB first-wave Girl x Girl Romance candidate metadata only.',
      'Human review and evidence assessment have not been applied.',
      CONFIRM_NOTE,
      `VNDB ID: ${vndbId}`,
      `VNDB Girl x Girl Romance tag rating: ${g97}`,
    ].join('\n'),
    status: 'draft',
  }

  return {
    key: val(row.key || vndbId),
    vndbId,
    title,
    action: 'create_vndb_yuri_first_wave_work_candidate',
    createType: 'ordinary_romance',
    planStatus: blockers.length ? 'blocked_or_review_required' : 'ready_for_create_dry_run',
    blockers,
    warnings: list(row.warnings),
    payload,
    sourceRow: {
      vndbUrl: val(row.vndbUrl),
      wikidataQid: val(row.wikidataQid),
      titleCandidates: uniqueBy(row.titleCandidates),
      yuriCreateCandidateV2: row.yuriCreateCandidateV2,
      yuriCreateCandidateV3: row.yuriCreateCandidateV3,
      raw: {
        released: row?.raw?.released,
        languages: row?.raw?.languages,
        platforms: row?.raw?.platforms,
        developers: row?.raw?.developers,
        image: row?.raw?.image,
        tags: row?.raw?.tags,
      },
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
    outputs: {
      rows: `${outDir}/vndb-yuri-create-works-v01.rows.jsonl`,
      ready: `${outDir}/vndb-yuri-create-works-v01-ready.jsonl`,
      blocked: `${outDir}/vndb-yuri-create-works-v01-blocked.jsonl`,
      sample: `${outDir}/vndb-yuri-create-works-v01-sample.jsonl`,
      summary: `${outDir}/vndb-yuri-create-works-v01-summary.json`,
    },
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      createsOnlyDraftWorksInFutureApply: true,
      inputMustBeV03FirstWaveOrdinaryRomance: true,
      requiresG97GirlXGirlRomance: true,
      excludesSensitiveRows: true,
      excludesSpacingRepairRows: true,
      doesNotDownloadImages: true,
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
