#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const SOURCE_PRIORITY = [
  'yurizukan',
  'bangumi',
  'mangadex',
  'ndl',
  'steam',
  'wikidata',
  'anilist',
]

const SOURCE_RANK = Object.fromEntries(SOURCE_PRIORITY.map((source, index) => [source, index + 1]))

const inputs = {
  mergeGroups: 'data_local/staging/merge-groups-v2/merge-groups-v2-dryrun-v02.jsonl',
  mergeSummary: 'data_local/staging/merge-groups-v2/merge-groups-v2-dryrun-v02-summary.json',
  radarSeed: 'data_local/staging/website-review-backend/baseline-radar-public-seed-v02.jsonl',
  wikidataAuto: 'data_local/staging/wikidata-identity/wikidata-identity-auto-v04.jsonl',
  wikidataCandidateReview: 'data_local/staging/wikidata-identity/wikidata-identity-candidate-review-v04.jsonl',
  wikidataQuarantine: 'data_local/staging/wikidata-identity/wikidata-identity-quarantine-v04.jsonl',
}

const outDir = path.join('data_local', 'staging', 'public-catalog-import')
const outJsonl = path.join(outDir, 'public-catalog-import-preview-v01.jsonl')
const outJson = path.join(outDir, 'public-catalog-import-preview-v01.json')
const outSummaryJson = path.join(outDir, 'public-catalog-import-preview-v01-summary.json')
const outMd = path.join(outDir, 'public-catalog-import-preview-v01.md')
const outReviewCsv = path.join(outDir, 'public-catalog-import-preview-v01-review-queue.csv')
const outPayloadSeed = path.join(outDir, 'public-catalog-import-preview-v01.payload.json')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return []

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`Failed to parse JSONL ${filePath}:${index + 1}: ${String(error?.message || error)}`)
      }
    })
}

function normText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function slugify(value, fallback) {
  const raw = String(value || fallback || 'work')
    .trim()
    .toLowerCase()

  const ascii = raw
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/giu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  return ascii || fallback || 'work'
}

function unique(values) {
  return Array.from(new Set(values.filter((value) => value !== null && value !== undefined && String(value).trim() !== '').map((value) => String(value).trim())))
}

function sourceRank(source) {
  return SOURCE_RANK[String(source || '').toLowerCase()] ?? 999
}

function sortVariantsByPriority(variants) {
  return [...variants].sort((a, b) => {
    const bySource = sourceRank(a.source) - sourceRank(b.source)
    if (bySource !== 0) return bySource

    const aTitle = String(a.title || '')
    const bTitle = String(b.title || '')
    return aTitle.localeCompare(bTitle)
  })
}

function indexByManyKeys(rows, keyGetter) {
  const map = new Map()

  for (const row of rows) {
    for (const key of keyGetter(row)) {
      if (!key) continue
      const normalized = normText(key)
      if (!normalized) continue

      if (!map.has(normalized)) map.set(normalized, [])
      map.get(normalized).push(row)
    }
  }

  return map
}

function radarKeys(seed) {
  return unique([
    seed.seedId,
    seed.reviewGroupKey,
    seed.canonicalReviewTitle,
    ...(Array.isArray(seed.displayTitles) ? seed.displayTitles : []),
    ...(Array.isArray(seed.localWorkKeys) ? seed.localWorkKeys : []),
  ])
}

function wikidataKeys(row) {
  return unique([
    row.mediaKey,
    row.titleNative,
    row.titleRomaji,
    row.bestLabel,
    row.bestQid,
  ])
}

function collectRadarForGroup(group, radarByKey) {
  const keys = unique([
    ...(Array.isArray(group.radarSeedRefs) ? group.radarSeedRefs : []),
    group.canonicalTitle,
    group.titleNorm,
    ...(Array.isArray(group.displayTitles) ? group.displayTitles : []),
    ...(Array.isArray(group.localWorkKeys) ? group.localWorkKeys : []),
  ])

  const found = new Map()

  for (const key of keys) {
    const rows = radarByKey.get(normText(key)) || []
    for (const row of rows) found.set(row.seedId || JSON.stringify(row), row)
  }

  return Array.from(found.values())
}

function collectWikidataForGroup(group, wikidataAutoByKey) {
  const explicit = Array.isArray(group.wikidataIdentityEvidence) ? group.wikidataIdentityEvidence : []

  const byExplicitQid = new Map()
  for (const row of wikidataAutoByKey.values()) {
    for (const item of row) {
      if (item.bestQid) byExplicitQid.set(normText(item.bestQid), item)
    }
  }

  const found = new Map()

  for (const item of explicit) {
    if (item?.bestQid && byExplicitQid.has(normText(item.bestQid))) {
      const row = byExplicitQid.get(normText(item.bestQid))
      found.set(row.bestQid, row)
    }
  }

  const keys = unique([
    group.canonicalTitle,
    group.titleNorm,
    ...(Array.isArray(group.displayTitles) ? group.displayTitles : []),
    ...(Array.isArray(group.localWorkKeys) ? group.localWorkKeys : []),
  ])

  for (const key of keys) {
    const rows = wikidataAutoByKey.get(normText(key)) || []
    for (const row of rows) {
      found.set(row.bestQid || row.mediaKey || JSON.stringify(row), row)
    }
  }

  return Array.from(found.values())
}

function chooseRadarNotice(radarRows, group) {
  if (radarRows.length > 0) return 'ai_synthesized_pending_review'
  if ((group.wikidataQuarantineRefs || []).length > 0) return 'quarantine_excluded'
  if ((group.wikidataCandidateReviewRefs || []).length > 0) return 'external_source_pending_review'
  return 'insufficient_information'
}

function chooseRank(radarRows) {
  const gradeOrder = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X']
  const grades = []

  for (const row of radarRows) {
    if (row.currentRatingGrade) grades.push(row.currentRatingGrade)
    if (row.currentRatingClass) grades.push(String(row.currentRatingClass).split('-')[0])
  }

  const valid = grades.filter((grade) => gradeOrder.includes(grade))
  if (valid.length === 0) return '未知'

  return valid.sort((a, b) => gradeOrder.indexOf(b) - gradeOrder.indexOf(a))[0]
}

function chooseRatingClass(radarRows) {
  const classes = []

  for (const row of radarRows) {
    if (row.currentRatingClass) classes.push(row.currentRatingClass)
    if (Array.isArray(row.currentRatingClasses)) classes.push(...row.currentRatingClasses)
  }

  return unique(classes)
}

function chooseAdultVisibilityNote(radarRows) {
  return unique(radarRows.map((row) => row.adultVisibilityNote)).join('\n')
}

function buildCandidateSources(group) {
  const variants = Array.isArray(group.suggestedVariants) ? group.suggestedVariants : []

  return sortVariantsByPriority(variants).map((variant) => ({
    source: String(variant.source || 'other').toLowerCase(),
    label: variant.title || group.canonicalTitle || '',
    externalId: variant.externalId || variant.sourceCandidateId || '',
    url: '',
    note: [
      variant.sourceCandidateId ? `sourceCandidateId=${variant.sourceCandidateId}` : '',
      variant.mediaType ? `mediaType=${variant.mediaType}` : '',
    ].filter(Boolean).join('; '),
  }))
}

function buildSourceConflictNotes(group, sortedVariants) {
  const sources = unique(sortedVariants.map((variant) => String(variant.source || 'unknown').toLowerCase()))
  const titles = unique(sortedVariants.map((variant) => variant.title || group.canonicalTitle))
  const notes = []

  if (sources.length > 1) notes.push(`multi_source: ${sources.join(', ')}`)
  if (titles.length > 1) notes.push(`multi_title_variant: ${titles.join(' | ')}`)
  if ((group.doNotAutoMergeReasons || []).length > 0) notes.push(`do_not_auto_merge: ${group.doNotAutoMergeReasons.join('; ')}`)
  if ((group.reviewReasons || []).length > 0) notes.push(`review_reasons: ${group.reviewReasons.join('; ')}`)
  if ((group.wikidataCandidateReviewRefs || []).length > 0) notes.push('wikidata_candidate_review_refs_present')
  if ((group.wikidataQuarantineRefs || []).length > 0) notes.push('wikidata_quarantine_refs_present')

  return notes
}

function buildWorkPreview(group, radarByKey, wikidataAutoByKey) {
  const variants = Array.isArray(group.suggestedVariants) ? group.suggestedVariants : []
  const sortedVariants = sortVariantsByPriority(variants)
  const baseVariant = sortedVariants[0] || null
  const candidateSources = buildCandidateSources(group)
  const radarRows = collectRadarForGroup(group, radarByKey)
  const wikidataRows = collectWikidataForGroup(group, wikidataAutoByKey)
  const ratingClasses = chooseRatingClass(radarRows)
  const rank = chooseRank(radarRows)
  const sourceConflictNotes = buildSourceConflictNotes(group, sortedVariants)

  const canonicalTitle = group.canonicalTitle || baseVariant?.title || group.mergeGroupId
  const slug = slugify(canonicalTitle, group.mergeGroupId)
  const siteId = `work:${group.mergeGroupId}`

  const externalIds = {}

  for (const variant of sortedVariants) {
    const source = String(variant.source || '').toLowerCase()
    const externalId = String(variant.externalId || '').trim()

    if (!externalId) continue

    if (source === 'bangumi') externalIds.bangumiSubjectId = externalId
    if (source === 'anilist') externalIds.anilistMediaId = externalId
    if (source === 'wikidata') externalIds.wikidataQid = externalId
    if (source === 'vndb') externalIds.vndbId = externalId
  }

  for (const row of wikidataRows) {
    if (row.bestQid && !externalIds.wikidataQid) externalIds.wikidataQid = row.bestQid
  }

  const reviewStatus = sourceConflictNotes.length > 0 || group.mergeStatus === 'dry_run_review'
    ? 'needs_review'
    : 'draft'

  const evidenceStrength = radarRows.length > 0 || wikidataRows.length > 0
    ? 'medium'
    : 'weak'

  const ratingNotice = chooseRadarNotice(radarRows, group)

  const preview = {
    previewId: `pcipv01-${group.mergeGroupId}`,
    mergeGroupId: group.mergeGroupId,
    title: canonicalTitle,
    slug,
    siteId,
    mediaTypes: Array.isArray(group.mediaTypes) ? group.mediaTypes : [],
    chosenBaseSource: baseVariant?.source || 'unknown',
    chosenBaseSourceRank: sourceRank(baseVariant?.source),
    sourcePriorityPolicy: {
      policyId: 'source-priority-policy-v0.1',
      order: SOURCE_PRIORITY,
    },
    sourceRefs: Array.isArray(group.sourceRefs) ? group.sourceRefs : [],
    sourceCandidateIds: Array.isArray(group.sourceCandidateIds) ? group.sourceCandidateIds : [],
    displayTitles: Array.isArray(group.displayTitles) ? group.displayTitles : [],
    suggestedVariants: sortedVariants,
    candidateSources,
    externalIds,
    rank,
    ratingClasses,
    ratingPolicyVersion: 'radar-rating-policy-v0.2-draft',
    ratingNotice,
    adultVisibilityNote: chooseAdultVisibilityNote(radarRows),
    radarSeedRefs: Array.isArray(group.radarSeedRefs) ? group.radarSeedRefs : [],
    radarSeedEvidence: radarRows.map((row) => ({
      seedId: row.seedId,
      canonicalReviewTitle: row.canonicalReviewTitle,
      currentRatingGrade: row.currentRatingGrade,
      currentRatingClass: row.currentRatingClass,
      possibleRatingClasses: row.possibleRatingClasses,
      confidence: row.confidence,
      publicNoticeText: row.publicNoticeText,
    })),
    wikidataIdentityEvidence: wikidataRows.map((row) => ({
      mediaKey: row.mediaKey,
      bestQid: row.bestQid,
      bestLabel: row.bestLabel,
      reviewStatus: row.reviewStatus,
      useFor: row.useFor,
      doNotUseFor: row.doNotUseFor,
    })),
    wikidataCandidateReviewRefs: Array.isArray(group.wikidataCandidateReviewRefs) ? group.wikidataCandidateReviewRefs : [],
    wikidataQuarantineRefs: Array.isArray(group.wikidataQuarantineRefs) ? group.wikidataQuarantineRefs : [],
    sourceConflictNotes,
    reviewReasons: Array.isArray(group.reviewReasons) ? group.reviewReasons : [],
    mergeConfidence: group.mergeConfidence,
    mergeStatus: group.mergeStatus,
    payloadDraft: {
      collection: 'works',
      title: canonicalTitle,
      slug,
      siteId,
      rank,
      reviewStatus,
      evidenceStrength,
      externalIds,
      candidateSources,
      workGroup: group.mergeGroupId,
      sourceLinks: [],
      searchText: unique([
        canonicalTitle,
        ...(Array.isArray(group.displayTitles) ? group.displayTitles : []),
        ...(sortedVariants.map((variant) => variant.title)),
        group.mergeGroupId,
        ...Object.values(externalIds),
      ]).join('\n'),
      evidenceNote: [
        `Preview generated from ${group.mergeGroupId}.`,
        `Source priority: ${SOURCE_PRIORITY.join(' > ')}.`,
        ratingNotice ? `Rating notice: ${ratingNotice}.` : '',
        ratingClasses.length ? `Rating classes: ${ratingClasses.join(', ')}.` : '',
        sourceConflictNotes.length ? `Review notes: ${sourceConflictNotes.join(' | ')}` : '',
        'AI 综合，待复核。',
      ].filter(Boolean).join('\n'),
    },
    safetyFlags: {
      noPayloadWrite: true,
      noPostgresqlWrite: true,
      noImporterApply: true,
      notPublicRating: true,
      needsReview: true,
    },
  }

  return preview
}

function csvEscape(value) {
  const text = String(value ?? '')
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

function toReviewCsv(rows) {
  const headers = [
    'previewId',
    'mergeGroupId',
    'title',
    'chosenBaseSource',
    'rank',
    'ratingNotice',
    'ratingClasses',
    'sourceConflictNotes',
    'radarSeedRefs',
    'wikidataIdentityEvidence',
  ]

  return [
    headers.join(','),
    ...rows.map((row) => headers.map((key) => {
      if (key === 'ratingClasses') return csvEscape(row.ratingClasses.join('|'))
      if (key === 'sourceConflictNotes') return csvEscape(row.sourceConflictNotes.join('|'))
      if (key === 'radarSeedRefs') return csvEscape(row.radarSeedRefs.join('|'))
      if (key === 'wikidataIdentityEvidence') return csvEscape(row.wikidataIdentityEvidence.map((item) => item.bestQid).join('|'))
      return csvEscape(row[key])
    }).join(',')),
  ].join('\n')
}

function summaryOf(previews, mergeSummary) {
  const bySource = {}
  const byRank = {}
  const byNotice = {}
  const byReviewReason = {}

  for (const row of previews) {
    bySource[row.chosenBaseSource] = (bySource[row.chosenBaseSource] || 0) + 1
    byRank[row.rank] = (byRank[row.rank] || 0) + 1
    byNotice[row.ratingNotice] = (byNotice[row.ratingNotice] || 0) + 1

    for (const reason of row.sourceConflictNotes) {
      const key = reason.split(':')[0]
      byReviewReason[key] = (byReviewReason[key] || 0) + 1
    }
  }

  const reviewQueue = previews.filter((row) =>
    row.sourceConflictNotes.length > 0 ||
    row.radarSeedRefs.length > 0 ||
    row.wikidataCandidateReviewRefs.length > 0 ||
    row.wikidataQuarantineRefs.length > 0 ||
    row.mergeStatus === 'dry_run_review'
  )

  return {
    generatedAt: new Date().toISOString(),
    readyForHumanReview: true,
    previews: previews.length,
    payloadDraftWorks: previews.length,
    reviewQueueRows: reviewQueue.length,
    bySource,
    byRank,
    byNotice,
    byReviewReason,
    inputMergeSummary: {
      sourceCandidatesGrouped: mergeSummary.sourceCandidatesGrouped,
      mergeGroups: mergeSummary.mergeGroups,
      multiSourceGroups: mergeSummary.multiSourceGroups,
      radarSeeds: mergeSummary.radarSeeds,
      radarSeedAttachments: mergeSummary.radarSeedAttachments,
      radarOnlyReviewQueueRows: mergeSummary.radarOnlyReviewQueueRows,
      radarAttachmentAmbiguityQueueRows: mergeSummary.radarAttachmentAmbiguityQueueRows,
      readyForMergeGroupsV2Preview: mergeSummary.readyForMergeGroupsV2Preview,
      blockers: mergeSummary.blockers,
      warnings: mergeSummary.warnings,
    },
    safety: {
      payloadWrite: false,
      postgresqlWrite: false,
      importerApply: false,
      delete: false,
    },
  }
}

function markdownReport(summary, sampleRows) {
  return [
    '# Public Catalog Import Preview v0.1',
    '',
    `Generated at: ${summary.generatedAt}`,
    '',
    '## Safety',
    '',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No importer apply.',
    '- No delete.',
    '- Preview only.',
    '',
    '## Summary',
    '',
    `- previews: ${summary.previews}`,
    `- payloadDraftWorks: ${summary.payloadDraftWorks}`,
    `- reviewQueueRows: ${summary.reviewQueueRows}`,
    '',
    '## By source',
    '',
    '```json',
    JSON.stringify(summary.bySource, null, 2),
    '```',
    '',
    '## By rank',
    '',
    '```json',
    JSON.stringify(summary.byRank, null, 2),
    '```',
    '',
    '## By rating notice',
    '',
    '```json',
    JSON.stringify(summary.byNotice, null, 2),
    '```',
    '',
    '## By review reason',
    '',
    '```json',
    JSON.stringify(summary.byReviewReason, null, 2),
    '```',
    '',
    '## Input merge summary',
    '',
    '```json',
    JSON.stringify(summary.inputMergeSummary, null, 2),
    '```',
    '',
    '## Sample rows',
    '',
    '```json',
    JSON.stringify(sampleRows, null, 2),
    '```',
    '',
  ].join('\n')
}

const generatedAt = new Date().toISOString()

const mergeGroups = readJsonl(inputs.mergeGroups)
const mergeSummary = readJson(inputs.mergeSummary)
const radarSeeds = readJsonl(inputs.radarSeed)
const wikidataAuto = readJsonl(inputs.wikidataAuto)

const radarByKey = indexByManyKeys(radarSeeds, radarKeys)
const wikidataAutoByKey = indexByManyKeys(wikidataAuto, wikidataKeys)

const previews = mergeGroups.map((group) => buildWorkPreview(group, radarByKey, wikidataAutoByKey))
const summary = summaryOf(previews, mergeSummary)
summary.generatedAt = generatedAt

const reviewQueue = previews.filter((row) =>
  row.sourceConflictNotes.length > 0 ||
  row.radarSeedRefs.length > 0 ||
  row.wikidataCandidateReviewRefs.length > 0 ||
  row.wikidataQuarantineRefs.length > 0 ||
  row.mergeStatus === 'dry_run_review'
)

const payloadSeed = {
  generatedAt,
  seedId: 'public-catalog-import-preview-v01',
  safety: {
    payloadWrite: false,
    postgresqlWrite: false,
    importerApply: false,
    delete: false,
  },
  works: previews.map((row) => row.payloadDraft),
}

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outJsonl, previews.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
fs.writeFileSync(outJson, JSON.stringify(previews, null, 2), 'utf8')
fs.writeFileSync(outSummaryJson, JSON.stringify(summary, null, 2), 'utf8')
fs.writeFileSync(outReviewCsv, toReviewCsv(reviewQueue), 'utf8')
fs.writeFileSync(outPayloadSeed, JSON.stringify(payloadSeed, null, 2), 'utf8')
fs.writeFileSync(outMd, markdownReport(summary, previews.slice(0, 5)), 'utf8')

console.log(JSON.stringify({
  ok: true,
  previews: previews.length,
  reviewQueueRows: reviewQueue.length,
  outputs: {
    jsonl: outJsonl,
    json: outJson,
    summary: outSummaryJson,
    md: outMd,
    reviewCsv: outReviewCsv,
    payloadSeed: outPayloadSeed,
  },
}, null, 2))
