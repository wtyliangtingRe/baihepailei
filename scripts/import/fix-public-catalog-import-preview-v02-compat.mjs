#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const inJson = 'data_local/staging/public-catalog-import/public-catalog-import-preview-v02.json'
const outDir = 'data_local/staging/public-catalog-import'

const outJson = path.join(outDir, 'public-catalog-import-preview-v02-compat.json')
const outJsonl = path.join(outDir, 'public-catalog-import-preview-v02-compat.jsonl')
const outSummary = path.join(outDir, 'public-catalog-import-preview-v02-compat-summary.json')
const outPayload = path.join(outDir, 'public-catalog-import-preview-v02-compat.payload.json')
const outMd = path.join(outDir, 'public-catalog-import-preview-v02-compat.md')

const allowedRanks = new Set(['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'trash', 'unknown'])
const allowedPayloadCandidateSources = new Set([
  'yurizukan',
  'bangumi',
  'mangadex',
  'ndl',
  'steam',
  'wikidata',
  'anilist',
  'vndb',
  'wikipedia',
  'manual',
  'other',
])

const allowedReviewReasons = new Set([
  'radar_seed_attached',
  'source_conflict',
  'multi_source_or_variant',
  'wikidata_candidate_review',
  'wikidata_quarantine',
  'manual_review',
  'other',
])

function norm(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeRank(value) {
  const raw = String(value || '').trim()
  if (!raw || raw === '未知') return 'unknown'
  if (allowedRanks.has(raw)) return raw
  return 'unknown'
}

function payloadCandidateSource(source) {
  const s = norm(source)

  if (s === 'bgm') return 'bangumi'
  if (allowedPayloadCandidateSources.has(s)) return s

  return 'other'
}

function normalizeRatingNotice(value) {
  const raw = String(value || '').trim()
  const normalized = norm(raw)

  if (!raw) return 'ai_synthesized_pending_review'
  if (normalized.includes('ai') || raw.includes('AI 综合')) return 'ai_synthesized_pending_review'
  if (raw.includes('信息不足') || normalized.includes('insufficient')) return 'insufficient_information'
  if (raw.includes('人工') || normalized.includes('manual')) return 'manual_reviewed'
  if (raw === '无' || normalized === 'none') return 'none'

  return 'other'
}

function normalizeReviewReasons(value, row) {
  const reasons = new Set()

  const add = (reason) => {
    if (allowedReviewReasons.has(reason)) reasons.add(reason)
  }

  const values = Array.isArray(value)
    ? value
    : String(value || '').split(/[;|,]/u)

  for (const item of values) {
    const reason = String(item || '').trim()
    if (allowedReviewReasons.has(reason)) add(reason)
  }

  const notes = Array.isArray(row.sourceConflictNotes) ? row.sourceConflictNotes : []
  if (notes.some((note) => String(note || '').startsWith('multi_source:'))) {
    add('source_conflict')
    add('multi_source_or_variant')
  }

  if ((row.radarSeedRefs || []).length) add('radar_seed_attached')
  if ((row.wikidataCandidateReviewRefs || []).length) add('wikidata_candidate_review')
  if ((row.wikidataQuarantineRefs || []).length) add('wikidata_quarantine')
  if (notes.includes('unresolved_source_candidate_refs')) add('other')

  return [...reasons]
}

function normalizeSourceConflictNotes(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).join('\n')
  return String(value || '').trim()
}

function needsReview(row) {
  const reviewReasons = row.payloadDraft?.reviewReasons || row.reviewReasons || []
  const sourceConflictNotes = row.payloadDraft?.sourceConflictNotes || row.sourceConflictNotes || ''

  return Boolean(
    (Array.isArray(reviewReasons) && reviewReasons.length) ||
    String(sourceConflictNotes || '').trim() ||
    (row.radarSeedRefs || []).length ||
    (row.wikidataCandidateReviewRefs || []).length ||
    (row.wikidataQuarantineRefs || []).length
  )
}

function countBy(rows, getter) {
  const result = {}

  for (const row of rows) {
    const key = String(getter(row) || 'unknown')
    result[key] = (result[key] || 0) + 1
  }

  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1]))
}

function fixCandidateSource(item) {
  const originalSource = item.source || 'unknown'
  const source = payloadCandidateSource(originalSource)

  const noteParts = [
    `originalSource=${originalSource}`,
    item.note || '',
  ].filter(Boolean)

  return {
    ...item,
    source,
    note: noteParts.join('; '),
  }
}

function candidateSourceKey(item) {
  return [
    item.source || '',
    item.externalId || '',
    item.url || '',
    item.label || '',
  ].join('|')
}

function dedupeCandidateSources(candidateSources) {
  const seen = new Set()
  const deduped = []

  for (const item of candidateSources || []) {
    const key = candidateSourceKey(item)
    if (seen.has(key)) continue

    seen.add(key)
    deduped.push(item)
  }

  return deduped
}

const rows = JSON.parse(fs.readFileSync(inJson, 'utf8'))

const fixed = rows.map((row) => {
  const rank = normalizeRank(row.rank)
  const reviewStatus = 'pending'
  const rawCandidateSources = (row.candidateSources || []).map(fixCandidateSource)
  const candidateSources = dedupeCandidateSources(rawCandidateSources)
  const dedupedCandidateSources = rawCandidateSources.length - candidateSources.length
  const importBatch = row.payloadDraft?.importBatch || row.importBatch || 'public-catalog-import-v02'
  const ratingNotice = normalizeRatingNotice(row.payloadDraft?.ratingNotice || row.ratingNotice)
  const chosenBaseSource = payloadCandidateSource(row.payloadDraft?.chosenBaseSource || row.chosenBaseSource)
  const reviewReasons = [
    ...new Set([
      ...normalizeReviewReasons(row.payloadDraft?.reviewReasons || row.reviewReasons, row),
      ...(dedupedCandidateSources > 0 ? ['multi_source_or_variant'] : []),
    ]),
  ]
  const sourceConflictNotes = [
    normalizeSourceConflictNotes(row.payloadDraft?.sourceConflictNotes || row.sourceConflictNotes),
    dedupedCandidateSources > 0 ? `duplicate_candidate_sources_removed: ${dedupedCandidateSources}` : '',
  ].filter(Boolean).join('\n')

  const evidenceNote = [
    row.payloadDraft?.evidenceNote || '',
    'Payload compat: rank normalized; reviewStatus normalized to pending; candidate source enums preserved when supported; originalSource kept in note.',
    dedupedCandidateSources > 0
      ? `Payload compat: removed ${dedupedCandidateSources} duplicate candidate source row(s).`
      : '',
  ].filter(Boolean).join('\n')

  return {
    ...row,
    rank,
    compatFixes: {
      rankBefore: row.rank,
      rankAfter: rank,
      reviewStatusAfter: reviewStatus,
      payloadCandidateSourcesMapped: rawCandidateSources.some((item, index) =>
        item.source !== row.candidateSources?.[index]?.source
      ),
      candidateSourcesBeforeDedupe: rawCandidateSources.length,
      candidateSourcesAfterDedupe: candidateSources.length,
      duplicateCandidateSourcesRemoved: dedupedCandidateSources,
    },
    payloadDraft: {
      ...row.payloadDraft,
      rank,
      reviewStatus,
      importBatch,
      ratingNotice,
      chosenBaseSource,
      reviewReasons,
      sourceConflictNotes,
      candidateSources,
      evidenceNote,
    },
  }
})

const payloadWorks = fixed.map((row) => row.payloadDraft)

const qaErrors = []
const qaWarnings = []

const invalidRanks = payloadWorks.filter((work) => !allowedRanks.has(work.rank))
if (invalidRanks.length) {
  qaErrors.push(`Invalid payload ranks after compat: ${invalidRanks.length}`)
}

const invalidCandidateSources = payloadWorks.flatMap((work) =>
  (work.candidateSources || [])
    .filter((item) => !allowedPayloadCandidateSources.has(item.source))
    .map((item) => ({ title: work.title, source: item.source }))
)

if (invalidCandidateSources.length) {
  qaErrors.push(`Invalid payload candidateSources.source after compat: ${invalidCandidateSources.length}`)
}

const duplicateCandidateSources = payloadWorks.flatMap((work) => {
  const seen = new Set()
  const duplicates = []

  for (const item of work.candidateSources || []) {
    const key = candidateSourceKey(item)
    if (seen.has(key)) {
      duplicates.push({ title: work.title, source: item.source, key })
      continue
    }

    seen.add(key)
  }

  return duplicates
})

if (duplicateCandidateSources.length) {
  qaErrors.push(`Duplicate payload candidateSources remain after compat: ${duplicateCandidateSources.length}`)
}

const mappedToOther = payloadWorks.flatMap((work) =>
  (work.candidateSources || [])
    .filter((item) => item.source === 'other' && String(item.note || '').includes('originalSource='))
    .map((item) => ({ title: work.title, note: item.note }))
)

if (mappedToOther.length) {
  qaWarnings.push(`candidateSources mapped to other with originalSource note: ${mappedToOther.length}`)
}

const unresolvedRows = fixed.filter((row) =>
  (row.suggestedVariants || []).some((variant) => !variant.resolvedSourceCandidate)
)

if (unresolvedRows.length) {
  qaErrors.push(`Unresolved source candidate rows remain: ${unresolvedRows.length}`)
}

const duplicateCandidateSourceRows = fixed.filter((row) =>
  (row.compatFixes?.duplicateCandidateSourcesRemoved || 0) > 0
)

const structuredReviewFieldMissing = payloadWorks.filter((work) =>
  !work.importBatch ||
  !work.ratingNotice ||
  !work.chosenBaseSource ||
  !Array.isArray(work.reviewReasons)
)

const invalidReviewReasons = payloadWorks.flatMap((work) =>
  (work.reviewReasons || [])
    .filter((reason) => !allowedReviewReasons.has(reason))
    .map((reason) => ({ title: work.title, reason }))
)

if (invalidReviewReasons.length) {
  qaErrors.push(`Invalid structured review reasons after compat: ${invalidReviewReasons.length}`)
}

if (structuredReviewFieldMissing.length) {
  qaWarnings.push(`Structured review fields missing after compat: ${structuredReviewFieldMissing.length}`)
}

const summary = {
  generatedAt: new Date().toISOString(),
  readyForPayloadSeedDryRun: qaErrors.length === 0,
  previews: fixed.length,
  payloadDraftWorks: payloadWorks.length,
  reviewQueueRows: fixed.filter(needsReview).length,
  structuredReviewFieldMissing: structuredReviewFieldMissing.length,
  resolvedSourceCandidateRows: fixed.filter((row) =>
    (row.suggestedVariants || []).some((variant) => variant.resolvedSourceCandidate)
  ).length,
  unresolvedSourceCandidateRows: unresolvedRows.length,
  duplicateCandidateSourceRows: duplicateCandidateSourceRows.length,
  duplicateCandidateSourcesRemoved: duplicateCandidateSourceRows.reduce(
    (sum, row) => sum + (row.compatFixes?.duplicateCandidateSourcesRemoved || 0),
    0
  ),
  mappedToOtherCandidateSources: mappedToOther.length,
  bySource: countBy(fixed, (row) => row.chosenBaseSource),
  byRank: countBy(fixed, (row) => row.rank),
  byPayloadRank: countBy(payloadWorks, (work) => work.rank),
  byPayloadReviewStatus: countBy(payloadWorks, (work) => work.reviewStatus),
  byImportBatch: countBy(payloadWorks, (work) => work.importBatch),
  byRatingNotice: countBy(payloadWorks, (work) => work.ratingNotice),
  byChosenBaseSource: countBy(payloadWorks, (work) => work.chosenBaseSource),
  byReviewReason: countBy(
    payloadWorks.flatMap((work) => (work.reviewReasons || []).map((reason) => ({ reason }))),
    (row) => row.reason
  ),
  byPayloadCandidateSource: countBy(
    payloadWorks.flatMap((work) => work.candidateSources || []),
    (item) => item.source
  ),
  qaErrors,
  qaWarnings,
  safety: {
    payloadWrite: false,
    postgresqlWrite: false,
    importerApply: false,
    delete: false,
  },
}

const payloadSeed = {
  generatedAt: summary.generatedAt,
  seedId: 'public-catalog-import-preview-v02-compat',
  safety: summary.safety,
  works: payloadWorks,
}

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outJson, JSON.stringify(fixed, null, 2), 'utf8')
fs.writeFileSync(outJsonl, fixed.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2), 'utf8')
fs.writeFileSync(outPayload, JSON.stringify(payloadSeed, null, 2), 'utf8')
fs.writeFileSync(outMd, [
  '# Public Catalog Import Preview v0.2 Compat',
  '',
  '## Safety',
  '',
  '- No Payload write.',
  '- No PostgreSQL write.',
  '- No importer apply.',
  '- No delete.',
  '',
  '## Summary',
  '',
  `- previews: ${summary.previews}`,
  `- payloadDraftWorks: ${summary.payloadDraftWorks}`,
  `- reviewQueueRows: ${summary.reviewQueueRows}`,
  `- structuredReviewFieldMissing: ${summary.structuredReviewFieldMissing}`,
  `- readyForPayloadSeedDryRun: ${summary.readyForPayloadSeedDryRun}`,
  `- duplicateCandidateSourceRows: ${summary.duplicateCandidateSourceRows}`,
  `- duplicateCandidateSourcesRemoved: ${summary.duplicateCandidateSourcesRemoved}`,
  '',
  '## By import batch',
  '',
  '```json',
  JSON.stringify(summary.byImportBatch, null, 2),
  '```',
  '',
  '## By rating notice',
  '',
  '```json',
  JSON.stringify(summary.byRatingNotice, null, 2),
  '```',
  '',
  '## By chosen base source',
  '',
  '```json',
  JSON.stringify(summary.byChosenBaseSource, null, 2),
  '```',
  '',
  '## By review reason',
  '',
  '```json',
  JSON.stringify(summary.byReviewReason, null, 2),
  '```',
  '',
  '## By payload candidate source',
  '',
  '```json',
  JSON.stringify(summary.byPayloadCandidateSource, null, 2),
  '```',
  '',
  '## QA',
  '',
  `- qaErrors: ${qaErrors.length}`,
  `- qaWarnings: ${qaWarnings.length}`,
  '',
].join('\n'), 'utf8')

console.log(JSON.stringify({
  ok: qaErrors.length === 0,
  readyForPayloadSeedDryRun: summary.readyForPayloadSeedDryRun,
  previews: summary.previews,
  reviewQueueRows: summary.reviewQueueRows,
  structuredReviewFieldMissing: summary.structuredReviewFieldMissing,
  duplicateCandidateSourceRows: summary.duplicateCandidateSourceRows,
  duplicateCandidateSourcesRemoved: summary.duplicateCandidateSourcesRemoved,
  byPayloadRank: summary.byPayloadRank,
  byPayloadReviewStatus: summary.byPayloadReviewStatus,
  byPayloadCandidateSource: summary.byPayloadCandidateSource,
  byReviewReason: summary.byReviewReason,
  qaErrors: qaErrors.length,
  qaWarnings: qaWarnings.length,
  outputs: {
    json: outJson,
    jsonl: outJsonl,
    summary: outSummary,
    md: outMd,
    payloadSeed: outPayload,
  },
}, null, 2))
