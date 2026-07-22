#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildAssessmentTracks,
  grade,
  normalizeRadarAssessment,
  relationshipID,
  text,
} from './assessment-track-presentation.mjs'

const DEFAULT_FILE = 'public/search-index.json'
const COLLECTION = 'radar-public-conclusions'
const PAGE_LIMIT = 500
const RADAR_REASONS = new Set([
  'radar_v06_package_import',
  'radar_publication_guard',
  'radar_guard_low_evidence_coverage',
  'radar_guard_weak_or_conflicting_source',
  'radar_guard_unclear_provisional_grade',
])

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function unique(values) {
  const seen = new Set()
  const output = []
  for (const raw of values.flat(Infinity)) {
    const value = text(raw)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output
}

function readJson(file) {
  const resolved = path.resolve(file)
  if (!fs.existsSync(resolved)) throw new Error(`Missing file: ${resolved}`)
  return JSON.parse(fs.readFileSync(resolved, 'utf8'))
}

function writeJson(file, value) {
  const resolved = path.resolve(file)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const temporary = `${resolved}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.rmSync(resolved, { force: true })
  fs.renameSync(temporary, resolved)
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const bodyText = await response.text()
  let body = null
  try {
    body = bodyText ? JSON.parse(bodyText) : null
  } catch {
    body = { raw: bodyText }
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${bodyText.slice(0, 1200)}`)
  }
  return body
}

export async function fetchPublicConclusions(baseUrl, fetcher = requestJson) {
  const docs = []
  let page = 1
  let totalPages = 1
  do {
    const params = new URLSearchParams({
      depth: '0',
      limit: String(PAGE_LIMIT),
      page: String(page),
      'where[recordStatus][equals]': 'current',
    })
    const body = await fetcher(`${baseUrl}/api/${COLLECTION}?${params.toString()}`)
    docs.push(...(body?.docs || []))
    totalPages = Number(body?.totalPages || 1)
    page += 1
  } while (page <= totalPages)
  return docs
}

function preservedReviewReasons(value) {
  const reasons = Array.isArray(value) ? value : []
  return reasons.map(text).filter((reason) => reason && !RADAR_REASONS.has(reason))
}

function conclusionReviewReasons(conclusion) {
  return Array.isArray(conclusion?.reviewReasons)
    ? conclusion.reviewReasons.map(text).filter((reason) => RADAR_REASONS.has(reason))
    : []
}

function researchPreview(conclusion) {
  if (!conclusion || text(conclusion.conclusionMode) !== 'bounded_range') return undefined
  const radar = normalizeRadarAssessment(conclusion.radarAssessment)
  return {
    researchStatus: 'partial',
    likelyGrade: grade(conclusion.likelyGrade || conclusion.compatibilityGrade) || undefined,
    bestGrade: grade(conclusion.bestGrade) || undefined,
    worstGrade: grade(conclusion.worstGrade) || undefined,
    sourceSummary: text(radar?.sourceSummary) || undefined,
    sourceCount: Number(radar?.sourceCount || 0),
    confidencePercent: radar?.confidencePercent ?? undefined,
    importedAt: text(conclusion.publishedAt) || undefined,
  }
}

export function conclusionByWorkID(conclusions) {
  const byWork = new Map()
  for (const conclusion of conclusions || []) {
    if (text(conclusion?.recordStatus || 'current') !== 'current') continue
    const workID = relationshipID(conclusion?.work) || text(conclusion?.workIdSnapshot)
    if (!workID) continue
    const existing = byWork.get(workID)
    const existingTime = Date.parse(existing?.publishedAt || existing?.updatedAt || '') || 0
    const candidateTime = Date.parse(conclusion?.publishedAt || conclusion?.updatedAt || '') || 0
    if (!existing || candidateTime >= existingTime) byWork.set(workID, conclusion)
  }
  return byWork
}

export function overlayConclusion(item, conclusion = null) {
  if (!item || item.collection !== 'works') return item

  const tracks = buildAssessmentTracks(item, conclusion)
  const humanPriority = tracks.effectiveGradeSource === 'human'
  const aiTrack = tracks.ai
  const radarAssessment = aiTrack
    ? normalizeRadarAssessment(conclusion?.radarAssessment)
    : null
  const reasons = unique([
    preservedReviewReasons(item.reviewReasons),
    conclusionReviewReasons(conclusion),
  ])
  const preview = researchPreview(conclusion)
  const searchText = unique([
    text(item.searchText),
    tracks.effectiveGrade,
    tracks.human
      ? [
          tracks.human.summary,
          tracks.human.sourceSummary,
          tracks.human.decisiveRuleCode,
          tracks.human.decisiveRuleReason,
          tracks.human.matchedRules.flatMap((rule) => [rule.code, rule.grade, rule.reason]),
          tracks.human.contradictions,
        ]
      : [],
    aiTrack
      ? [
          aiTrack.summary,
          aiTrack.sourceSummary,
          aiTrack.decisiveRuleCode,
          aiTrack.decisiveRuleReason,
          aiTrack.matchedRules.flatMap((rule) => [rule.code, rule.grade, rule.reason]),
          aiTrack.contradictions,
          aiTrack.bestGrade,
          aiTrack.likelyGrade,
          aiTrack.worstGrade,
        ]
      : [],
  ]).join('\n')

  const assessmentTracks = tracks.human || aiTrack
    ? { human: tracks.human, ai: aiTrack }
    : undefined

  return {
    ...item,
    // Compatibility output only. It is derived from the two assessment tracks
    // and is never treated as an independent source of truth.
    rank: tracks.effectiveGrade,
    effectiveGrade: tracks.effectiveGrade,
    effectiveGradeSource: tracks.effectiveGradeSource,
    assessmentTracks,
    ratingNotice: humanPriority
      ? 'manual_reviewed'
      : (aiTrack
          ? (text(conclusion?.ratingNotice) || 'ai_synthesized_pending_review')
          : 'insufficient_information'),
    reviewReasons: reasons,
    evidenceStrength: humanPriority
      ? (text(tracks.human?.evidenceStrength) || 'unassessed')
      : (text(aiTrack?.evidenceStrength) || 'unassessed'),
    radarAssessment: radarAssessment || undefined,
    researchPreview: preview,
    searchText,
  }
}

export function overlayPublicConclusions(index, conclusions) {
  const byWork = conclusionByWorkID(conclusions)
  let matchedWorks = 0
  const items = (index?.items || []).map((item) => {
    if (item.collection !== 'works') return item
    const workID = text(item.recordId)
    const conclusion = byWork.get(workID) || null
    if (conclusion) matchedWorks += 1
    return overlayConclusion(item, conclusion)
  })
  return {
    index: {
      ...index,
      schemaVersion: Math.max(Number(index?.schemaVersion || 1), 7),
      counts: {
        ...(index?.counts || {}),
        [COLLECTION]: byWork.size,
      },
      radarPublicConclusions: {
        overlaidAt: new Date().toISOString(),
        currentRecords: byWork.size,
        matchedWorks,
        gradePriority: ['human', 'ai', 'unknown'],
        rankIsCompatibilityOnly: true,
      },
      items,
    },
    currentRecords: byWork.size,
    matchedWorks,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const file = text(args.file || args.out || DEFAULT_FILE)
  const index = readJson(file)
  const baseUrl = text(args.url || index.source || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const conclusions = await fetchPublicConclusions(baseUrl)
  const result = overlayPublicConclusions(index, conclusions)
  writeJson(file, result.index)
  console.log('Public Radar conclusions overlaid')
  console.log(JSON.stringify({ file: path.resolve(file), currentRecords: result.currentRecords, matchedWorks: result.matchedWorks }, null, 2))
}

const isDirectRun = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isDirectRun) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
