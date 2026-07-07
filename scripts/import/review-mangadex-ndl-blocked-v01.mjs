#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'mangadex-ndl-blocked-review-v0.1'
const DEFAULT_INPUT = 'data_local/staging/mangadex-ndl-integration/mangadex-ndl-work-integration-apply-v01.rows.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/mangadex-ndl-integration'
const REVIEW_WARNING_PREFIX = 'review_warning_requires_manual_review:'

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

function csvCell(value) {
  const text = val(value)
  if (!/[",\n]/u.test(text)) return text
  return `"${text.replace(/"/gu, '""')}"`
}

function writeCsv(file, rows, columns) {
  const lines = [columns.join(',')]
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(','))
  }
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8')
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

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function unique(values) {
  return [...new Set(values.map(val).filter(Boolean))]
}

function reviewWarnings(row) {
  return unique(asArray(row.blockers)
    .filter((blocker) => blocker.startsWith(REVIEW_WARNING_PREFIX))
    .map((blocker) => blocker.slice(REVIEW_WARNING_PREFIX.length)))
}

function normalizedText(value) {
  return val(value).normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ')
}

function romanish(value) {
  const text = normalizedText(value)
  return /^[\p{Script=Latin}\p{N}\s.'’`\-()&:!]+$/u.test(text) && /[a-z]/iu.test(text)
}

function nativeish(value) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(val(value))
}

function hasOnly(set, values) {
  if (set.length !== values.length) return false
  return values.every((value) => set.includes(value))
}

function blockersContain(row, text) {
  return asArray(row.blockers).some((blocker) => val(blocker).includes(text))
}

function additionsCount(row) {
  return asArray(row.additions?.searchText).length
    + asArray(row.additions?.sourceLinks).length
    + asArray(row.additions?.candidateSources).length
}

function classifyBlocked(row) {
  const blockers = unique(asArray(row.blockers))
  const warningSet = reviewWarnings(row)
  const diff = row.diffReport || {}
  const incomingCreators = unique(asArray(diff.incomingCreators))
  const existingCreators = unique(asArray(diff.existingCreators))
  const incomingPublishers = unique(asArray(diff.incomingPublishers))
  const existingPublishers = unique(asArray(diff.existingPublishers))
  const incomingYears = unique(asArray(diff.incomingYears))
  const existingYears = unique(asArray(diff.existingYears))
  const notes = []

  if (blockersContain(row, 'pornographic') || blockersContain(row, 'erotica')) {
    return {
      bucket: 'high_risk_content_rating_manual',
      priority: 90,
      confidence: 'manual_required',
      recommendation: 'Keep blocked. Review only with explicit adult-content policy and source handling rules.',
      notes,
    }
  }

  if (blockersContain(row, 'doujinshi_or_loose_extra')) {
    return {
      bucket: 'doujinshi_or_extra_manual',
      priority: 85,
      confidence: 'manual_required',
      recommendation: 'Keep blocked. These often point to doujinshi, extras, or derivative titles rather than the main work.',
      notes,
    }
  }

  if (blockersContain(row, 'suggestive')) {
    return {
      bucket: 'suggestive_content_rating_review',
      priority: 75,
      confidence: 'manual_required',
      recommendation: 'Keep blocked until matched source quality and site display policy are reviewed.',
      notes,
    }
  }

  if (blockersContain(row, 'source_metadata_requires_manual_review')) {
    return {
      bucket: 'source_metadata_opt_in_review',
      priority: 70,
      confidence: 'review_required',
      recommendation: 'Review sourceLinks/candidateSources separately. Do not mix with searchText-only alias updates.',
      notes,
    }
  }

  if (blockersContain(row, 'short_search_text_fragment')) {
    return {
      bucket: 'short_fragment_review',
      priority: 65,
      confidence: 'review_required',
      recommendation: 'Review split title fragments and punctuation handling before allowing this alias.',
      notes,
    }
  }

  if (hasOnly(warningSet, ['creator_diff_or_missing'])) {
    const romanIncoming = incomingCreators.filter(romanish)
    const nativeExisting = existingCreators.filter(nativeish)
    if (romanIncoming.length && nativeExisting.length) notes.push('incoming creator is Latin-script while existing creator is CJK-script; likely romanization alias case')
    return {
      bucket: romanIncoming.length && nativeExisting.length ? 'creator_romanization_alias_review' : 'creator_only_review',
      priority: romanIncoming.length && nativeExisting.length ? 30 : 45,
      confidence: romanIncoming.length && nativeExisting.length ? 'likely_safe_after_name_equivalence' : 'review_required',
      recommendation: romanIncoming.length && nativeExisting.length
        ? 'Good candidate for a future creator-name equivalence rule; sample before allowing.'
        : 'Review creator mismatch before allowing.',
      notes,
    }
  }

  if (hasOnly(warningSet, ['year_diff_or_missing'])) {
    if (incomingYears.length && existingYears.length) notes.push(`incoming years ${incomingYears.join('|')} vs existing years ${existingYears.join('|')}`)
    return {
      bucket: 'year_only_series_volume_review',
      priority: 35,
      confidence: 'likely_series_volume_year_issue',
      recommendation: 'Good candidate for a volume-vs-series year rule; do not auto-accept until title/volume logic is checked.',
      notes,
    }
  }

  if (hasOnly(warningSet, ['publisher_diff_or_missing'])) {
    if (incomingPublishers.length && existingPublishers.length) notes.push(`incoming publishers ${incomingPublishers.join('|')} vs existing publishers ${existingPublishers.join('|')}`)
    return {
      bucket: 'publisher_only_review',
      priority: 45,
      confidence: 'review_required',
      recommendation: 'Review publisher mismatch; it may be edition/localization related.',
      notes,
    }
  }

  if (warningSet.includes('creator_diff_or_missing') && warningSet.includes('year_diff_or_missing')) {
    return {
      bucket: 'creator_and_year_mixed_review',
      priority: 60,
      confidence: 'review_required',
      recommendation: 'Keep blocked. Creator plus year mismatch can indicate wrong work, edition, or series/volume mismatch.',
      notes,
    }
  }

  if (warningSet.includes('publisher_diff_or_missing') && (warningSet.includes('creator_diff_or_missing') || warningSet.includes('year_diff_or_missing'))) {
    return {
      bucket: 'mixed_metadata_review',
      priority: 70,
      confidence: 'manual_required',
      recommendation: 'Keep blocked. Multiple metadata mismatches need manual source review.',
      notes,
    }
  }

  if (blockers.length) {
    return {
      bucket: 'other_blocked_review',
      priority: 80,
      confidence: 'review_required',
      recommendation: 'Review blockers manually before any future apply.',
      notes,
    }
  }

  return {
    bucket: 'not_blocked',
    priority: 0,
    confidence: 'not_applicable',
    recommendation: 'No blockers on this row.',
    notes,
  }
}

function classifyRow(row) {
  if (row.status === 'already_current') {
    return {
      bucket: 'already_current',
      priority: 0,
      confidence: 'done',
      recommendation: 'No action needed.',
      notes: [],
    }
  }
  if (row.status === 'patched') {
    return {
      bucket: 'first_pass_applied',
      priority: 0,
      confidence: 'done',
      recommendation: 'Already applied in the safe first pass.',
      notes: [],
    }
  }
  if (row.status === 'would_patch') {
    return {
      bucket: 'pending_first_pass_patch',
      priority: 5,
      confidence: 'safe_first_pass_candidate',
      recommendation: 'Run the first-pass apply before reviewing deeper blocked rows.',
      notes: [],
    }
  }
  if (row.status === 'failed') {
    return {
      bucket: 'failed_run_review',
      priority: 100,
      confidence: 'manual_required',
      recommendation: 'Fix runtime failure before data review.',
      notes: [],
    }
  }
  if (row.status === 'blocked') return classifyBlocked(row)
  return {
    bucket: 'unknown_status_review',
    priority: 95,
    confidence: 'manual_required',
    recommendation: 'Unknown row status; inspect manually.',
    notes: [],
  }
}

function compactRow(row) {
  const classification = classifyRow(row)
  return {
    key: val(row.key),
    workId: val(row.workId),
    workTitle: val(row.workTitle),
    status: val(row.status),
    bucket: classification.bucket,
    priority: classification.priority,
    confidence: classification.confidence,
    recommendation: classification.recommendation,
    blockers: unique(asArray(row.blockers)).join(' | '),
    warnings: unique(asArray(row.warnings)).join(' | '),
    changedFields: unique(asArray(row.changedFields)).join(' | '),
    searchTextAdditions: unique(asArray(row.additions?.searchText)).join(' | '),
    sourceLinkAdditions: asArray(row.additions?.sourceLinks).map((item) => `${val(item?.label)} ${val(item?.url)}`.trim()).join(' | '),
    candidateSourceAdditions: asArray(row.additions?.candidateSources).map((item) => `${val(item?.source)} ${val(item?.externalId)} ${val(item?.url)}`.trim()).join(' | '),
    incomingCreators: unique(asArray(row.diffReport?.incomingCreators)).join(' | '),
    existingCreators: unique(asArray(row.diffReport?.existingCreators)).join(' | '),
    incomingPublishers: unique(asArray(row.diffReport?.incomingPublishers)).join(' | '),
    existingPublishers: unique(asArray(row.diffReport?.existingPublishers)).join(' | '),
    incomingYears: unique(asArray(row.diffReport?.incomingYears)).join(' | '),
    existingYears: unique(asArray(row.diffReport?.existingYears)).join(' | '),
    notes: classification.notes.join(' | '),
    raw: row,
  }
}

function sampleByBucket(rows, perBucket) {
  const out = []
  const seen = new Map()
  const sorted = [...rows].sort((a, b) => b.priority - a.priority || a.bucket.localeCompare(b.bucket) || a.key.localeCompare(b.key))
  for (const row of sorted) {
    const used = seen.get(row.bucket) || 0
    if (used >= perBucket) continue
    out.push(row)
    seen.set(row.bucket, used + 1)
  }
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const sampleSize = Number(args['sample-size'] || 20)
  const rows = readJsonl(input)
  const reviewed = rows.map(compactRow)
  const blocked = reviewed.filter((row) => row.status === 'blocked')
  const outputs = {
    rows: `${outDir}/mangadex-ndl-blocked-review-v01.rows.jsonl`,
    rowsCsv: `${outDir}/mangadex-ndl-blocked-review-v01.rows.csv`,
    blockedRows: `${outDir}/mangadex-ndl-blocked-review-v01-blocked.rows.jsonl`,
    sample: `${outDir}/mangadex-ndl-blocked-review-v01-sample.jsonl`,
    summary: `${outDir}/mangadex-ndl-blocked-review-v01-summary.json`,
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    inputFile: input,
    rowsRead: rows.length,
    blockedRows: blocked.length,
    byStatus: countBy(reviewed, 'status'),
    byBucket: countBy(reviewed, 'bucket'),
    byConfidence: countBy(reviewed, 'confidence'),
    topBlockers: countBy(blocked.flatMap((row) => row.blockers.split(' | ').filter(Boolean)), (item) => item),
    nextRecommendedOrder: [
      'creator_romanization_alias_review',
      'year_only_series_volume_review',
      'publisher_only_review',
      'source_metadata_opt_in_review',
      'creator_only_review',
      'creator_and_year_mixed_review',
      'mixed_metadata_review',
      'suggestive_content_rating_review',
      'doujinshi_or_extra_manual',
      'high_risk_content_rating_manual',
    ],
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
    },
    outputs,
  }

  fs.mkdirSync(outDir, { recursive: true })
  writeJsonl(outputs.rows, reviewed)
  writeJsonl(outputs.blockedRows, blocked)
  writeJsonl(outputs.sample, sampleByBucket(blocked, sampleSize))
  writeCsv(outputs.rowsCsv, reviewed.map(({ raw, ...row }) => ({
    ...row,
    additionsCount: additionsCount(raw),
  })), [
    'key',
    'workId',
    'workTitle',
    'status',
    'bucket',
    'priority',
    'confidence',
    'recommendation',
    'blockers',
    'warnings',
    'changedFields',
    'searchTextAdditions',
    'sourceLinkAdditions',
    'candidateSourceAdditions',
    'incomingCreators',
    'existingCreators',
    'incomingPublishers',
    'existingPublishers',
    'incomingYears',
    'existingYears',
    'notes',
    'additionsCount',
  ])
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
}

main()
