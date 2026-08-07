#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ACCELERATED_RADAR_AI_REVIEW_TAG,
  RADAR_AI_PENDING_DATABASE_STATUS,
  RADAR_AI_PENDING_WARNING_TEMPLATE_ID,
  isLegalRadarRange,
  normalizeRadarConclusion,
  normalizeRadarDatabaseStatus,
  normalizeRadarGrade,
  normalizeRadarWarningTemplateId,
} from '../../src/lib/radar/conclusionNormalizer.mjs'

function clean(value) {
  return String(value ?? '').trim()
}

function rowValues(rows) {
  if (!Array.isArray(rows)) return []
  return rows.map((item) => clean(typeof item === 'string' ? item : item?.value)).filter(Boolean)
}

function tags(rows) {
  return Array.isArray(rows) ? rows : []
}

function hasCanonicalPendingTag(record) {
  return tags(record.publicTagHints || record.publicTags).some((tag) =>
    clean(tag?.key) === ACCELERATED_RADAR_AI_REVIEW_TAG.key
    || (
      clean(tag?.group) === ACCELERATED_RADAR_AI_REVIEW_TAG.group
      && clean(tag?.value) === ACCELERATED_RADAR_AI_REVIEW_TAG.value
      && normalizeRadarWarningTemplateId(tag?.warningTemplateId) === RADAR_AI_PENDING_WARNING_TEMPLATE_ID
    ),
  )
}

function warningIds(record) {
  return [
    ...rowValues(record.publicWarningTemplateIds),
    clean(record.warningTemplateId),
  ].filter(Boolean)
}

export function auditRadarPublicRatingConclusions(records) {
  const report = {
    schemaVersion: 1,
    readOnly: true,
    total: 0,
    modeCounts: {
      fixed_grade: 0,
      bounded_range: 0,
      labels_only: 0,
      unscanned: 0,
      blocked: 0,
    },
    fixedRanges: 0,
    trueBoundedRanges: 0,
    malformedRanges: 0,
    missingFields: 0,
    coreLikelyMismatch: 0,
    dUnclearBoundedRange: 0,
    aiPendingTagMissing: 0,
    warningTemplateAliasUsage: 0,
    pageNoticeAliasUsage: 0,
    warningTemplateAliases: {},
    pageNoticeAliases: {},
    findings: [],
  }

  for (const [index, record] of records.entries()) {
    report.total += 1
    const id = clean(record.publicationKey || record.identityKey || record.id || `row:${index + 1}`)
    const best = normalizeRadarGrade(record.bestGrade)
    const likely = normalizeRadarGrade(record.likelyGrade)
    const worst = normalizeRadarGrade(record.worstGrade)
    const rawRange = [record.bestGrade, record.likelyGrade, record.worstGrade].map(clean)
    const missing = rawRange.filter((value) => !value).length
    const complete = Boolean(best && likely && worst)
    const legal = complete && isLegalRadarRange(best, likely, worst)
    const fixed = legal && best === likely && likely === worst
    const bounded = legal && !fixed

    if (missing > 0) report.missingFields += 1
    if (fixed) report.fixedRanges += 1
    if (bounded) report.trueBoundedRanges += 1
    if (rawRange.some(Boolean) && !legal) report.malformedRanges += 1

    const core = normalizeRadarGrade(record.coreGrade)
    if (core && likely && core !== likely) report.coreLikelyMismatch += 1

    const matchedClasses = rowValues(record.matchedClasses)
    const classificationRule = clean(record.classificationRule)
    const unresolved = rowValues(record.unresolvedDimensions)
    const conclusion = normalizeRadarConclusion({
      coreGrade: record.coreGrade,
      bestGrade: record.bestGrade,
      likelyGrade: record.likelyGrade,
      worstGrade: record.worstGrade,
      classificationRule,
      matchedClasses,
      unresolvedDimensions: unresolved,
      requiresHumanReview: record.requiresHumanReview
        ?? clean(record.humanReview?.status) !== 'reviewed',
      recommendedNextQueue: record.recommendedNextQueue,
      evidenceStatus: record.evidenceStatus,
      researchStatus: record.researchStatus,
      publicState: record.publicState,
      recordShape: record.recordShape,
      ratingNotice: record.ratingNotice,
      pageNotice: record.pageNotice,
      publicTagHints: record.publicTagHints,
      publicWarningTemplateIds: record.publicWarningTemplateIds,
    })
    report.modeCounts[conclusion.conclusionMode] += 1

    if (
      bounded
      && [classificationRule, ...matchedClasses].some((value) => clean(value).toUpperCase() === 'D-UNCLEAR')
    ) {
      report.dUnclearBoundedRange += 1
    }

    if (conclusion.needsPendingTag && !hasCanonicalPendingTag(record)) {
      report.aiPendingTagMissing += 1
    }

    for (const warningId of warningIds(record)) {
      const normalized = normalizeRadarWarningTemplateId(warningId)
      if (normalized === RADAR_AI_PENDING_WARNING_TEMPLATE_ID && warningId !== normalized) {
        report.warningTemplateAliasUsage += 1
        report.warningTemplateAliases[warningId] = (report.warningTemplateAliases[warningId] || 0) + 1
      }
    }

    const pageNotice = clean(record.ratingNotice || record.pageNotice)
    const normalizedPageNotice = normalizeRadarDatabaseStatus(pageNotice)
    if (
      normalizedPageNotice === RADAR_AI_PENDING_DATABASE_STATUS
      && pageNotice
      && pageNotice !== normalizedPageNotice
    ) {
      report.pageNoticeAliasUsage += 1
      report.pageNoticeAliases[pageNotice] = (report.pageNoticeAliases[pageNotice] || 0) + 1
    }

    if (conclusion.validationIssues.length || (conclusion.needsPendingTag && !hasCanonicalPendingTag(record))) {
      report.findings.push({
        id,
        conclusionMode: conclusion.conclusionMode,
        validationIssues: conclusion.validationIssues,
        pendingTagMissing: conclusion.needsPendingTag && !hasCanonicalPendingTag(record),
      })
    }
  }

  return report
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    args[token.slice(2)] = argv[index + 1]
    index += 1
  }
  return args
}

export function runAuditCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (!args.input) throw new Error('Missing --input <json>')
  const inputPath = path.resolve(args.input)
  const outputPath = args.output ? path.resolve(args.output) : ''
  const parsed = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
  const records = Array.isArray(parsed) ? parsed : parsed.records
  if (!Array.isArray(records)) throw new Error('Input must be an array or { records: [] }')
  const report = auditRadarPublicRatingConclusions(records)
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, serialized)
  } else {
    process.stdout.write(serialized)
  }
  return report
}

const isDirect = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirect) runAuditCli()
