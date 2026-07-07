#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'mangadex-ndl-creator-romanization-plan-v0.1'
const DEFAULT_READY_INPUT = 'data_local/staging/mangadex-ndl-integration/mangadex-ndl-work-integration-v01-ready.jsonl'
const DEFAULT_REVIEW_INPUT = 'data_local/staging/mangadex-ndl-integration/mangadex-ndl-blocked-review-v01.rows.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/mangadex-ndl-integration'
const TARGET_BUCKET = 'creator_romanization_alias_review'
const CREATOR_BLOCKER = 'review_warning_requires_manual_review:creator_diff_or_missing'
const SAFE_READY_WARNINGS = new Set([
  'raw_source_id_not_bangumi_subject_id',
  'has_search_text_additions',
  'creator_diff_or_missing',
])

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
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(','))
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8')
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function unique(values) {
  return [...new Set(values.map(val).filter(Boolean))]
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

function normalize(value) {
  return val(value).normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ')
}

function compactName(value) {
  return normalize(value)
    .replace(/[\s,，.・･:：;；'’`"“”\-—_()（）\[\]【】<>《》「」『』]+/gu, '')
    .replace(/著・文・その他|著・文|著|漫画・原作|漫画|原作|脚本|作画|構成|企画・原案|原案/gu, '')
}

function romanLike(value) {
  const text = normalize(value)
  return /^[\p{Script=Latin}\p{N}\s.'’`\-()&:!]+$/u.test(text) && /[a-z]/iu.test(text)
}

function nativeLike(value) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(val(value))
}

function embeddedNativeMatch(incomingCreators, existingCreators) {
  const incomingCompacts = incomingCreators.map(compactName)
  const existingCompacts = existingCreators.map(compactName).filter((item) => item.length >= 2)
  for (const existing of existingCompacts) {
    for (const incoming of incomingCompacts) {
      if (incoming.includes(existing) || existing.includes(incoming)) return true
    }
  }
  return false
}

function creatorEvidence(incomingCreators, existingCreators) {
  const romanIncoming = incomingCreators.filter(romanLike)
  const nativeIncoming = incomingCreators.filter(nativeLike)
  const nativeExisting = existingCreators.filter(nativeLike)
  const exactOrEmbeddedNative = embeddedNativeMatch(incomingCreators, existingCreators)

  if (exactOrEmbeddedNative) {
    return {
      evidence: 'embedded_native_name_match',
      confidence: 'high',
      reason: 'An incoming creator string contains a native-script name already present in the existing creator list.',
    }
  }

  if (romanIncoming.length && nativeExisting.length && !nativeIncoming.length) {
    return {
      evidence: 'latin_incoming_native_existing',
      confidence: 'medium',
      reason: 'Incoming creator is Latin-script while existing creator is CJK-script; this is likely romanization but not proven by string match.',
    }
  }

  if (romanIncoming.length && nativeExisting.length && nativeIncoming.length) {
    return {
      evidence: 'mixed_incoming_native_existing',
      confidence: 'medium',
      reason: 'Incoming creators include both Latin and native-script names while existing creator is native-script.',
    }
  }

  return {
    evidence: 'weak_creator_equivalence_signal',
    confidence: 'low',
    reason: 'Creator mismatch exists, but this row lacks a strong romanization/equivalence signal.',
  }
}

function safeReadyWarnings(warnings) {
  return unique(warnings).every((warning) => SAFE_READY_WARNINGS.has(warning))
}

function planDecision(reviewRow, readyPlan) {
  const blockers = unique(asArray(reviewRow.blockers))
  const warnings = unique(asArray(reviewRow.warnings))
  const readyWarnings = unique(asArray(readyPlan?.warnings))
  const readyBlockers = unique(asArray(readyPlan?.blockers))
  const fieldAdditions = readyPlan?.fieldAdditions || {}
  const searchTextAdditions = unique(asArray(fieldAdditions.searchTextAdditions))
  const sourceLinks = asArray(fieldAdditions.sourceLinks)
  const candidateSources = asArray(fieldAdditions.candidateSources)
  const diff = readyPlan?.diffReport || reviewRow.raw?.diffReport || reviewRow.diffReport || {}
  const incomingCreators = unique(asArray(diff.incomingCreators))
  const existingCreators = unique(asArray(diff.existingCreators))
  const incomingYears = unique(asArray(diff.incomingYears))
  const existingYears = unique(asArray(diff.existingYears))
  const incomingPublishers = unique(asArray(diff.incomingPublishers))
  const existingPublishers = unique(asArray(diff.existingPublishers))
  const evidence = creatorEvidence(incomingCreators, existingCreators)
  const issues = []

  if (reviewRow.bucket !== TARGET_BUCKET) issues.push('not_target_bucket')
  if (reviewRow.status !== 'blocked') issues.push('not_blocked_status')
  if (!readyPlan) issues.push('missing_ready_plan')
  if (readyPlan && readyPlan.planStatus !== 'ready_for_apply_review') issues.push('ready_plan_not_ready_for_apply_review')
  if (readyPlan && val(readyPlan.action) !== 'enrich_primary_title_matched_bangumi_work') issues.push('unsupported_action_for_this_pass')
  if (readyBlockers.length) issues.push('ready_plan_has_blockers')
  if (blockers.length !== 1 || blockers[0] !== CREATOR_BLOCKER) issues.push('unexpected_review_blockers')
  if (!safeReadyWarnings(readyWarnings)) issues.push('unsafe_ready_warnings')
  if (!searchTextAdditions.length) issues.push('no_search_text_additions')
  if (sourceLinks.length || candidateSources.length) issues.push('source_metadata_present_deferred')
  if (incomingYears.length || existingYears.length) {
    // This bucket should not contain year blockers, but record the signal for later review.
  }
  if (incomingPublishers.length || existingPublishers.length) {
    // Publisher values may be present without mismatch; report only.
  }

  let decision = 'manual_review'
  let pass = false
  if (!issues.length && evidence.confidence === 'high') {
    decision = 'candidate_high_confidence_search_text_only'
    pass = true
  } else if (!issues.length && evidence.confidence === 'medium') {
    decision = 'candidate_medium_confidence_sample_before_apply'
    pass = false
  } else if (issues.length === 1 && issues[0] === 'source_metadata_present_deferred' && evidence.confidence === 'high' && searchTextAdditions.length) {
    decision = 'candidate_high_confidence_search_text_only_source_metadata_deferred'
    pass = true
  } else if (issues.includes('source_metadata_present_deferred') && evidence.confidence !== 'low') {
    decision = 'manual_review_source_metadata_present'
  }

  return {
    decision,
    pass,
    issues,
    evidence,
    searchTextAdditions,
    sourceMetadataPresent: Boolean(sourceLinks.length || candidateSources.length),
    sourceLinkCount: sourceLinks.length,
    candidateSourceCount: candidateSources.length,
    incomingCreators,
    existingCreators,
    incomingYears,
    existingYears,
    incomingPublishers,
    existingPublishers,
  }
}

function compactRow(reviewRow, readyPlan) {
  const plan = planDecision(reviewRow, readyPlan)
  return {
    key: val(reviewRow.key),
    workId: val(reviewRow.workId || readyPlan?.work?.id),
    workTitle: val(reviewRow.workTitle || readyPlan?.work?.title),
    bucket: val(reviewRow.bucket),
    decision: plan.decision,
    pass: plan.pass,
    evidence: plan.evidence.evidence,
    confidence: plan.evidence.confidence,
    reason: plan.evidence.reason,
    issues: plan.issues.join(' | '),
    searchTextAdditions: plan.searchTextAdditions.join(' | '),
    sourceMetadataPresent: String(plan.sourceMetadataPresent),
    sourceLinkCount: String(plan.sourceLinkCount),
    candidateSourceCount: String(plan.candidateSourceCount),
    incomingCreators: plan.incomingCreators.join(' | '),
    existingCreators: plan.existingCreators.join(' | '),
    incomingYears: plan.incomingYears.join(' | '),
    existingYears: plan.existingYears.join(' | '),
    incomingPublishers: plan.incomingPublishers.join(' | '),
    existingPublishers: plan.existingPublishers.join(' | '),
    readyWarnings: unique(asArray(readyPlan?.warnings)).join(' | '),
    reviewBlockers: unique(asArray(reviewRow.blockers)).join(' | '),
    rawReview: reviewRow,
    rawReadyPlan: readyPlan || null,
  }
}

function sampleRows(rows, perDecision) {
  const out = []
  const seen = new Map()
  const sorted = [...rows].sort((a, b) => a.decision.localeCompare(b.decision) || a.key.localeCompare(b.key))
  for (const row of sorted) {
    const used = seen.get(row.decision) || 0
    if (used >= perDecision) continue
    out.push(row)
    seen.set(row.decision, used + 1)
  }
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const readyInput = String(args.ready || DEFAULT_READY_INPUT)
  const reviewInput = String(args.review || DEFAULT_REVIEW_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const sampleSize = Number(args['sample-size'] || 25)

  const readyRows = readJsonl(readyInput)
  const reviewRows = readJsonl(reviewInput)
  const readyByKey = new Map(readyRows.map((row) => [val(row.key), row]))
  const targetRows = reviewRows.filter((row) => row.status === 'blocked' && row.bucket === TARGET_BUCKET)
  const planned = targetRows.map((reviewRow) => compactRow(reviewRow, readyByKey.get(val(reviewRow.key))))
  const passRows = planned.filter((row) => row.pass)
  const nonPassRows = planned.filter((row) => !row.pass)

  const outputs = {
    rows: `${outDir}/mangadex-ndl-creator-romanization-plan-v01.rows.jsonl`,
    rowsCsv: `${outDir}/mangadex-ndl-creator-romanization-plan-v01.rows.csv`,
    passRows: `${outDir}/mangadex-ndl-creator-romanization-plan-v01-pass.rows.jsonl`,
    manualRows: `${outDir}/mangadex-ndl-creator-romanization-plan-v01-manual.rows.jsonl`,
    sample: `${outDir}/mangadex-ndl-creator-romanization-plan-v01-sample.jsonl`,
    summary: `${outDir}/mangadex-ndl-creator-romanization-plan-v01-summary.json`,
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    readyInput,
    reviewInput,
    readyRowsRead: readyRows.length,
    reviewRowsRead: reviewRows.length,
    targetBucket: TARGET_BUCKET,
    targetRows: targetRows.length,
    passRows: passRows.length,
    manualRows: nonPassRows.length,
    byDecision: countBy(planned, 'decision'),
    byEvidence: countBy(planned, 'evidence'),
    byConfidence: countBy(planned, 'confidence'),
    byIssue: countBy(planned.flatMap((row) => row.issues.split(' | ').filter(Boolean)), (item) => item),
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      proposedWritableFieldsForFuturePass: ['searchText'],
      sourceMetadataDeferred: true,
    },
    nextStep: passRows.length
      ? 'Review pass rows, then create a separate apply dry-run guarded by this pass list.'
      : 'No rows are safe enough for automated second pass; use manual review only.',
    outputs,
  }

  fs.mkdirSync(outDir, { recursive: true })
  writeJsonl(outputs.rows, planned)
  writeJsonl(outputs.passRows, passRows)
  writeJsonl(outputs.manualRows, nonPassRows)
  writeJsonl(outputs.sample, sampleRows(planned, sampleSize))
  writeCsv(outputs.rowsCsv, planned.map(({ rawReview, rawReadyPlan, ...row }) => row), [
    'key',
    'workId',
    'workTitle',
    'bucket',
    'decision',
    'pass',
    'evidence',
    'confidence',
    'reason',
    'issues',
    'searchTextAdditions',
    'sourceMetadataPresent',
    'sourceLinkCount',
    'candidateSourceCount',
    'incomingCreators',
    'existingCreators',
    'incomingYears',
    'existingYears',
    'incomingPublishers',
    'existingPublishers',
    'readyWarnings',
    'reviewBlockers',
  ])
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
}

main()
