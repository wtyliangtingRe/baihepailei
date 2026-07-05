#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_ELIGIBILITY = 'data_local/staging/import/catalog-import-eligibility-v01.rows.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/import'
const IMPORT_BATCH = 'payload-work-draft-plan-v01'
const SAMPLE_LIMIT = 40

const SOURCE_MAP = new Map([
  ['anilist', 'anilist'],
  ['bangumi', 'bangumi'],
  ['vndb', 'vndb'],
  ['wikidata', 'wikidata'],
  ['mangadex', 'mangadex'],
  ['steam', 'steam'],
  ['ndl', 'ndl'],
  ['wikipedia', 'wikipedia'],
  ['yurizukan', 'yurizukan'],
  ['manual', 'manual'],
])

const MEDIA_MAP = {
  anime: { mediaGroup: 'anime', mediaType: 'anime', format: 'unknown' },
  manga: { mediaGroup: 'manga', mediaType: 'manga', format: 'unknown' },
  novel: { mediaGroup: 'novel', mediaType: 'novel', format: 'unknown' },
  novel_or_book: { mediaGroup: 'novel', mediaType: 'novel', format: 'unknown' },
  light_novel: { mediaGroup: 'novel', mediaType: 'light_novel', format: 'unknown' },
  visual_novel: { mediaGroup: 'game', mediaType: 'visual_novel', format: 'visual_novel' },
  game: { mediaGroup: 'game', mediaType: 'game', format: 'unknown' },
  webtoon: { mediaGroup: 'manga', mediaType: 'webtoon', format: 'unknown' },
  doujin: { mediaGroup: 'other', mediaType: 'doujin', format: 'unknown' },
  anthology: { mediaGroup: 'other', mediaType: 'anthology', format: 'unknown' },
}

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
    if (!next || next.startsWith('--')) {
      args[key] = true
      continue
    }
    args[key] = next
    i += 1
  }
  return args
}

async function readJsonl(file) {
  const rows = []
  let read = 0
  let failed = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const body = line.trim()
    if (!body) continue
    try {
      rows.push(JSON.parse(body))
    } catch {
      failed += 1
    }
    read += 1
  }

  return { rows, read, failed }
}

function stableHash(input) {
  const text = val(input)
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).padStart(7, '0').slice(0, 8)
}

function compactAscii(value) {
  return val(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

function slugify(value) {
  const slug = val(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[「」『』【】\[\]（）()〈〉《》]/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-')
  return slug || 'work'
}

function countBy(rows, key) {
  const out = {}
  for (const row of rows) {
    const bucket = val(row[key]) || 'missing'
    out[bucket] = (out[bucket] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function countPayloadBy(rows, key) {
  const out = {}
  for (const row of rows) {
    const bucket = val(row.payload?.[key]) || 'missing'
    out[bucket] = (out[bucket] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function duplicates(rows, selector) {
  const seen = new Map()
  for (const row of rows) {
    const key = selector(row)
    if (!key) continue
    if (!seen.has(key)) seen.set(key, [])
    seen.get(key).push(row)
  }
  return [...seen.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([key, values]) => ({ key, count: values.length, samples: values.slice(0, 10).map((row) => row.planId) }))
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ')
}

function formatCountTable(title, entries, keyLabel = 'Key') {
  return [
    `## ${title}`,
    '',
    `| ${keyLabel} | Count |`,
    '|---|---:|',
    ...Object.entries(entries || {}).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
    '',
  ]
}

function sourceOption(sourceName) {
  return SOURCE_MAP.get(val(sourceName).toLowerCase()) || 'other'
}

function sourceLabel(sourceName) {
  const source = val(sourceName)
  if (!source) return 'Unknown source'
  if (source.toLowerCase() === 'anilist') return 'AniList'
  if (source.toLowerCase() === 'bangumi') return 'Bangumi'
  return source
}

function mapMedia(sourceMediaType) {
  return MEDIA_MAP[val(sourceMediaType)] || { mediaGroup: 'other', mediaType: 'other', format: 'unknown' }
}

function externalIdsFor(row) {
  const sourceName = val(row.sourceName).toLowerCase()
  const sourceId = val(row.sourceId)
  const out = {}

  if (sourceName === 'anilist' && /^\d+$/u.test(sourceId)) out.anilistMediaId = sourceId
  if (sourceName === 'bangumi' && /^\d+$/u.test(sourceId)) out.bangumiSubjectId = sourceId
  if (sourceName === 'vndb' && /^v\d+$/iu.test(sourceId)) out.vndbId = sourceId
  if (sourceName === 'wikidata' && /^Q\d+$/iu.test(sourceId)) out.wikidataQid = sourceId.toUpperCase()

  return out
}

function sourceIdentity(row) {
  const sourceName = compactAscii(row.sourceName) || 'source'
  const sourceId = compactAscii(row.sourceId)
  if (sourceId) return `${sourceName}-${sourceId}`
  return `${sourceName}-${stableHash(row.sourceRecordKey || row.nodeId || row.title)}`
}

function buildSearchText(row, payload) {
  return [
    payload.title,
    row.normalizedTitle,
    row.sourceName && row.sourceId ? `${row.sourceName}:${row.sourceId}` : '',
    row.sourceRecordKey,
    row.sourceUrl,
  ].map(val).filter(Boolean).join('\n')
}

function validateEligibleRow(row) {
  const problems = []
  if (row.eligibility !== 'eligible_for_draft_plan') problems.push('not_eligible_for_draft_plan')
  if (!val(row.title)) problems.push('missing_title')
  if (!val(row.normalizedTitle)) problems.push('missing_normalized_title')
  if (!/[\p{L}\p{N}]/u.test(val(row.normalizedTitle))) problems.push('normalized_title_has_no_letters_or_numbers')
  if (!val(row.sourceName)) problems.push('missing_source_name')
  if (!val(row.sourceRecordKey) && !val(row.sourceId)) problems.push('missing_source_identity')
  if (!val(row.sourceMediaType) || val(row.sourceMediaType) === 'unknown') problems.push('unknown_source_media_type')
  if (row.importPlanAllowed === true || row.payloadWriteAllowed === true) problems.push('unsafe_input_write_flag')
  return problems
}

function buildPlanRow(row, generatedAt) {
  const identity = sourceIdentity(row)
  const media = mapMedia(row.sourceMediaType)
  const baseSlug = slugify(row.normalizedTitle || row.title)
  const slug = `${baseSlug}-${identity}`
  const siteId = `catalog-${identity}`
  const source = sourceOption(row.sourceName)
  const externalId = val(row.sourceId || row.sourceRecordKey)

  const payload = {
    title: val(row.title),
    slug,
    siteId,
    rank: 'unknown',
    reviewStatus: 'pending',
    importBatch: IMPORT_BATCH,
    ratingNotice: 'ai_synthesized_pending_review',
    chosenBaseSource: source,
    reviewReasons: ['other'],
    sourceConflictNotes: 'Auto-generated draft plan from catalog eligibility audit. Not manually reviewed; do not publish as a final rating.',
    evidenceStrength: 'unassessed',
    originalTitle: val(row.title),
    aliases: [],
    localizedTitles: [],
    mediaGroup: media.mediaGroup,
    mediaType: media.mediaType,
    format: media.format,
    externalIds: externalIdsFor(row),
    candidateSources: [
      {
        source,
        label: sourceLabel(row.sourceName),
        externalId,
        url: val(row.sourceUrl),
        fetchedAt: generatedAt,
        note: `Generated from ${val(row.sourceRecordKey || row.nodeId)} via catalog eligibility audit.`,
      },
    ],
    sourceLinks: val(row.sourceUrl)
      ? [{ label: sourceLabel(row.sourceName), url: val(row.sourceUrl) }]
      : [],
    searchText: '',
    isLiteVisible: true,
    isFullVisible: false,
    hasEvidence: false,
    riskMatrix: {
      maleImpact: 'unassessed',
      relationshipClarity: 'unassessed',
      endingSafety: 'unassessed',
      creatorSpeechRisk: 'unassessed',
      note: 'Unassessed catalog draft.',
    },
    evidenceNote: 'Catalog draft generated from source metadata only. No human review or evidence assessment has been applied.',
    status: 'draft',
  }

  payload.searchText = buildSearchText(row, payload)

  return {
    planId: `work-draft:${identity}`,
    version: 'payload-work-draft-plan-v0.1',
    action: 'create_payload_work_draft',
    collection: 'works',
    sourceEligibilityRow: {
      nodeId: val(row.nodeId),
      sourceName: val(row.sourceName),
      sourceId: val(row.sourceId),
      sourceRecordKey: val(row.sourceRecordKey),
      sourceUrl: val(row.sourceUrl),
      sourceMediaType: val(row.sourceMediaType),
      eligibility: val(row.eligibility),
      eligibilityReasons: Array.isArray(row.eligibilityReasons) ? row.eligibilityReasons : [],
    },
    payload,
    safety: {
      reviewOnly: true,
      payloadWriteAllowed: false,
      postgresqlWriteAllowed: false,
      importerActionAllowed: false,
      applyAllowed: false,
    },
  }
}

function markdown(report) {
  return [
    '# Payload Work Draft Plan v0.1',
    '',
    'This is a local, read-only draft plan generated from catalog eligibility rows. It does not write Payload or PostgreSQL.',
    '',
    '## Safety',
    '',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No importer action.',
    '- Every plan row has `safety.applyAllowed: false` and `safety.payloadWriteAllowed: false`.',
    '- Output files under `data_local` should not be committed.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${report.summary.generatedAt}`,
    `- readyForPlanAudit: ${report.summary.readyForPlanAudit}`,
    `- eligibilityRowsRead: ${report.summary.eligibilityRowsRead}`,
    `- eligibilityRowsFailed: ${report.summary.eligibilityRowsFailed}`,
    `- eligibleRowsInput: ${report.summary.eligibleRowsInput}`,
    `- planRows: ${report.summary.planRows}`,
    `- skippedRows: ${report.summary.skippedRows}`,
    `- invalidEligibleRows: ${report.summary.invalidEligibleRows}`,
    `- duplicateSiteIds: ${report.summary.duplicateSiteIds}`,
    `- duplicateSlugs: ${report.summary.duplicateSlugs}`,
    `- applyAllowedRows: ${report.summary.safety.applyAllowedRows}`,
    `- payloadWriteAllowedRows: ${report.summary.safety.payloadWriteAllowedRows}`,
    '',
    ...formatCountTable('Plan rows by source', report.summary.bySource, 'Source'),
    ...formatCountTable('Plan rows by media group', report.summary.byMediaGroup, 'Media Group'),
    ...formatCountTable('Plan rows by media type', report.summary.byMediaType, 'Media Type'),
    ...formatCountTable('Plan rows by status', report.summary.byStatus, 'Status'),
    '## Samples',
    '',
    '```json',
    JSON.stringify(report.samples, null, 2),
    '```',
    '',
    '## Blockers',
    '',
    report.blockers.length ? report.blockers.map((item) => `- ${item}`).join('\n') : '- none',
    '',
    '## Next step',
    '',
    '- Run a separate plan audit before any draft importer is added.',
    '- Keep this file as a plan only; do not write Payload from this script.',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const eligibilityPath = args.eligibility || DEFAULT_ELIGIBILITY
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR

  if (!fs.existsSync(eligibilityPath)) throw new Error(`Eligibility rows file not found: ${eligibilityPath}`)

  const generatedAt = new Date().toISOString()
  const eligibility = await readJsonl(eligibilityPath)
  const invalidEligibleRows = []
  const planRows = []

  for (const row of eligibility.rows) {
    if (row.eligibility !== 'eligible_for_draft_plan') continue
    const problems = validateEligibleRow(row)
    if (problems.length) {
      invalidEligibleRows.push({ row, problems })
      continue
    }
    planRows.push(buildPlanRow(row, generatedAt))
  }

  const duplicateSiteIds = duplicates(planRows, (row) => row.payload.siteId)
  const duplicateSlugs = duplicates(planRows, (row) => row.payload.slug)
  const unsafeRows = planRows.filter((row) => (
    row.safety?.applyAllowed === true
    || row.safety?.payloadWriteAllowed === true
    || row.safety?.postgresqlWriteAllowed === true
    || row.safety?.importerActionAllowed === true
  ))

  const blockers = []
  if (eligibility.failed) blockers.push(`eligibility_rows_failed_to_parse:${eligibility.failed}`)
  if (invalidEligibleRows.length) blockers.push(`invalid_eligible_rows:${invalidEligibleRows.length}`)
  if (duplicateSiteIds.length) blockers.push(`duplicate_site_ids:${duplicateSiteIds.length}`)
  if (duplicateSlugs.length) blockers.push(`duplicate_slugs:${duplicateSlugs.length}`)
  if (unsafeRows.length) blockers.push(`unsafe_plan_rows:${unsafeRows.length}`)

  const skippedRows = eligibility.rows.length - planRows.length
  const eligibleRowsInput = eligibility.rows.filter((row) => row.eligibility === 'eligible_for_draft_plan').length

  const summary = {
    generatedAt,
    version: 'payload-work-draft-plan-v0.1',
    readyForPlanAudit: blockers.length === 0 && planRows.length > 0,
    eligibilityRowsRead: eligibility.read,
    eligibilityRowsFailed: eligibility.failed,
    eligibilityRowsLoaded: eligibility.rows.length,
    eligibleRowsInput,
    planRows: planRows.length,
    skippedRows,
    invalidEligibleRows: invalidEligibleRows.length,
    duplicateSiteIds: duplicateSiteIds.length,
    duplicateSlugs: duplicateSlugs.length,
    bySource: countBy(planRows.map((row) => ({ source: row.sourceEligibilityRow.sourceName })), 'source'),
    byMediaGroup: countPayloadBy(planRows, 'mediaGroup'),
    byMediaType: countPayloadBy(planRows, 'mediaType'),
    byStatus: countPayloadBy(planRows, 'status'),
    inputs: {
      eligibility: eligibilityPath,
    },
    outputs: {
      rows: path.join(outDir, 'payload-work-draft-plan-v01.rows.jsonl'),
      json: path.join(outDir, 'payload-work-draft-plan-v01.json'),
      summary: path.join(outDir, 'payload-work-draft-plan-v01-summary.json'),
      md: path.join(outDir, 'payload-work-draft-plan-v01.md'),
    },
    safety: {
      readOnly: true,
      payloadRead: false,
      payloadWrite: false,
      postgresqlWrite: false,
      importerAction: false,
      applyAllowedRows: planRows.filter((row) => row.safety?.applyAllowed === true).length,
      payloadWriteAllowedRows: planRows.filter((row) => row.safety?.payloadWriteAllowed === true).length,
      postgresqlWriteAllowedRows: planRows.filter((row) => row.safety?.postgresqlWriteAllowed === true).length,
      importerActionAllowedRows: planRows.filter((row) => row.safety?.importerActionAllowed === true).length,
    },
  }

  const samples = {
    planRows: planRows.slice(0, SAMPLE_LIMIT),
    invalidEligibleRows: invalidEligibleRows.slice(0, SAMPLE_LIMIT),
    duplicateSiteIds: duplicateSiteIds.slice(0, SAMPLE_LIMIT),
    duplicateSlugs: duplicateSlugs.slice(0, SAMPLE_LIMIT),
  }

  const report = {
    ok: blockers.length === 0,
    summary,
    blockers,
    samples,
    rows: planRows,
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(summary.outputs.rows, planRows.map((row) => JSON.stringify(row)).join('\n') + (planRows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(summary.outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(summary.outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(summary.outputs.md, markdown(report), 'utf8')

  console.log(JSON.stringify({ ok: blockers.length === 0, summary, blockers, outputs: summary.outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
