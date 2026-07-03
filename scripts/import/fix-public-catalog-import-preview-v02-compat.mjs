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

function needsReview(row) {
  return Boolean(
    (row.sourceConflictNotes || []).length ||
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

const rows = JSON.parse(fs.readFileSync(inJson, 'utf8'))

const fixed = rows.map((row) => {
  const rank = normalizeRank(row.rank)
  const reviewStatus = 'pending'
  const candidateSources = (row.candidateSources || []).map(fixCandidateSource)

  const evidenceNote = [
    row.payloadDraft?.evidenceNote || '',
    'Payload compat: rank normalized; reviewStatus normalized to pending; candidate source enums preserved when supported; originalSource kept in note.',
  ].filter(Boolean).join('\n')

  return {
    ...row,
    rank,
    compatFixes: {
      rankBefore: row.rank,
      rankAfter: rank,
      reviewStatusAfter: reviewStatus,
      payloadCandidateSourcesMapped: candidateSources.some((item, index) =>
        item.source !== row.candidateSources?.[index]?.source
      ),
    },
    payloadDraft: {
      ...row.payloadDraft,
      rank,
      reviewStatus,
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

const summary = {
  generatedAt: new Date().toISOString(),
  readyForPayloadSeedDryRun: qaErrors.length === 0,
  previews: fixed.length,
  payloadDraftWorks: payloadWorks.length,
  reviewQueueRows: fixed.filter(needsReview).length,
  resolvedSourceCandidateRows: fixed.filter((row) =>
    (row.suggestedVariants || []).some((variant) => variant.resolvedSourceCandidate)
  ).length,
  unresolvedSourceCandidateRows: unresolvedRows.length,
  bySource: countBy(fixed, (row) => row.chosenBaseSource),
  byRank: countBy(fixed, (row) => row.rank),
  byPayloadRank: countBy(payloadWorks, (work) => work.rank),
  byPayloadReviewStatus: countBy(payloadWorks, (work) => work.reviewStatus),
  byPayloadCandidateSource: countBy(
    payloadWorks.flatMap((work) => work.candidateSources || []),
    (item) => item.source,
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
  '## Ready',
  '',
  `readyForPayloadSeedDryRun: ${summary.readyForPayloadSeedDryRun}`,
  '',
  '## Summary',
  '',
  `- previews: ${summary.previews}`,
  `- payloadDraftWorks: ${summary.payloadDraftWorks}`,
  `- reviewQueueRows: ${summary.reviewQueueRows}`,
  `- resolvedSourceCandidateRows: ${summary.resolvedSourceCandidateRows}`,
  `- unresolvedSourceCandidateRows: ${summary.unresolvedSourceCandidateRows}`,
  '',
  '## By source',
  '',
  '```json',
  JSON.stringify(summary.bySource, null, 2),
  '```',
  '',
  '## By payload rank',
  '',
  '```json',
  JSON.stringify(summary.byPayloadRank, null, 2),
  '```',
  '',
  '## By payload reviewStatus',
  '',
  '```json',
  JSON.stringify(summary.byPayloadReviewStatus, null, 2),
  '```',
  '',
  '## By payload candidate source',
  '',
  '```json',
  JSON.stringify(summary.byPayloadCandidateSource, null, 2),
  '```',
  '',
  '## QA Errors',
  '',
  ...(summary.qaErrors.length ? summary.qaErrors.map((x) => `- ${x}`) : ['- none']),
  '',
  '## QA Warnings',
  '',
  ...(summary.qaWarnings.length ? summary.qaWarnings.map((x) => `- ${x}`) : ['- none']),
  '',
  '## Sample payload works',
  '',
  '```json',
  JSON.stringify(payloadWorks.slice(0, 3), null, 2),
  '```',
  '',
].join('\n'), 'utf8')

console.log(JSON.stringify({
  ok: qaErrors.length === 0,
  readyForPayloadSeedDryRun: summary.readyForPayloadSeedDryRun,
  previews: summary.previews,
  reviewQueueRows: summary.reviewQueueRows,
  byPayloadRank: summary.byPayloadRank,
  byPayloadReviewStatus: summary.byPayloadReviewStatus,
  byPayloadCandidateSource: summary.byPayloadCandidateSource,
  qaErrors: summary.qaErrors.length,
  qaWarnings: summary.qaWarnings.length,
  outputs: {
    json: outJson,
    jsonl: outJsonl,
    summary: outSummary,
    md: outMd,
    payloadSeed: outPayload,
  },
}, null, 2))
