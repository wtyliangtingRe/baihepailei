import type { DetailItem, WorkRiskMatrix } from './detail-index'

export type RecommendationBucket = 'priority' | 'cautious' | 'not-recommended'

export type RecommendedWork = {
  item: DetailItem
  score: number
  bucket: RecommendationBucket
  reasonCodes: string[]
}

const scoreCache = new WeakMap<DetailItem, RecommendedWork>()
const listCache = new WeakMap<DetailItem[], RecommendedWork[]>()

function rankScore(rank?: string) {
  if (rank === 'S' || rank === 'AA') return 50
  if (rank === 'A') return 42
  if (rank === 'B') return 24
  if (rank === 'C') return 8
  if (rank === 'D') return -22
  if (rank === 'E') return -38
  if (rank === 'F') return -55
  if (rank === 'X' || rank === 'trash') return -75
  return -8
}

function reviewScore(value?: string) {
  if (value === 'reviewed') return 16
  if (value === 'disputed') return -28
  if (value === 'deprecated') return -70
  return -4
}

function noticeScore(value?: string) {
  if (value === 'manual_reviewed') return 10
  if (value === 'ai_synthesized_pending_review' || value === 'external_source_pending_review') return -12
  if (value === 'insufficient_information') return -22
  if (value === 'identity_conflict' || value === 'quarantine_excluded') return -45
  return 0
}

function evidenceScore(value?: string) {
  if (value === 'strong') return 16
  if (value === 'medium') return 10
  if (value === 'weak') return -10
  if (value === 'unassessed') return -7
  return 0
}

function metricScore(item: DetailItem) {
  const confidence = item.radarAssessment?.confidencePercent
  const coverage = item.radarAssessment?.evidenceCoveragePercent
  let score = 0
  if (typeof confidence === 'number') score += confidence >= 85 ? 8 : confidence < 50 ? -12 : 0
  if (typeof coverage === 'number') score += coverage >= 80 ? 8 : coverage < 45 ? -14 : 0
  if (item.radarAssessment?.requiresHumanReview) score -= 12
  if ((item.radarAssessment?.contradictions || []).length) score -= 10
  if (['conflicting_evidence', 'insufficient_evidence'].includes(String(item.radarAssessment?.evidenceStatus || ''))) score -= 12
  return score
}

function matrixScore(matrix?: WorkRiskMatrix) {
  if (!matrix) return -4
  let score = 0
  if (matrix.maleImpact === 'none') score += 10
  if (matrix.maleImpact === 'minor') score += 3
  if (matrix.maleImpact === 'noticeable') score -= 10
  if (matrix.maleImpact === 'severe') score -= 30
  if (matrix.relationshipClarity === 'confirmed') score += 15
  if (matrix.relationshipClarity === 'developing') score += 8
  if (matrix.relationshipClarity === 'subtext') score += 2
  if (matrix.relationshipClarity === 'friendship') score -= 10
  if (matrix.relationshipClarity === 'unclear') score -= 5
  if (matrix.endingSafety === 'safe') score += 15
  if (matrix.endingSafety === 'open') score += 5
  if (matrix.endingSafety === 'risky') score -= 20
  if (matrix.endingSafety === 'bad') score -= 40
  if (matrix.creatorSpeechRisk === 'none') score += 8
  if (matrix.creatorSpeechRisk === 'disputed') score -= 15
  if (matrix.creatorSpeechRisk === 'severe') score -= 35
  return score
}

function needsHumanReview(item: DetailItem) {
  return item.reviewStatus !== 'reviewed'
    || item.radarAssessment?.requiresHumanReview === true
    || ['ai_synthesized_pending_review', 'external_source_pending_review', 'insufficient_information'].includes(String(item.ratingNotice || ''))
}

function bucketFor(item: DetailItem, score: number): RecommendationBucket {
  if (['X', 'trash', 'F'].includes(String(item.rank || '')) || ['disputed', 'deprecated'].includes(String(item.reviewStatus || ''))) return 'not-recommended'
  if (needsHumanReview(item)) return score >= 25 ? 'cautious' : 'not-recommended'
  if (score >= 78) return 'priority'
  if (score >= 30) return 'cautious'
  return 'not-recommended'
}

function reasonCodes(item: DetailItem) {
  const codes: string[] = []
  const matrix = item.riskMatrix
  if (item.rank === 'S' || item.rank === 'AA' || item.rank === 'A') codes.push('rank-good')
  else if (['D', 'E', 'F'].includes(String(item.rank || ''))) codes.push('rank-risk')
  else if (item.rank === 'X' || item.rank === 'trash') codes.push('blacklist')
  else codes.push('rank-mid')
  if (item.reviewStatus === 'reviewed') codes.push('reviewed')
  if (item.reviewStatus === 'disputed') codes.push('disputed')
  if (item.reviewStatus === 'deprecated') codes.push('deprecated')
  if (item.ratingNotice === 'ai_synthesized_pending_review') codes.push('ai-pending')
  if (item.ratingNotice === 'insufficient_information') codes.push('information-insufficient')
  if (item.evidenceStrength === 'strong' || item.evidenceStrength === 'medium') codes.push('evidence-ok')
  else if (item.hasEvidence) codes.push('evidence-present')
  else codes.push('evidence-missing')
  const confidence = item.radarAssessment?.confidencePercent
  const coverage = item.radarAssessment?.evidenceCoveragePercent
  if (typeof confidence === 'number' && confidence >= 85) codes.push('confidence-high')
  if (typeof confidence === 'number' && confidence < 50) codes.push('confidence-low')
  if (typeof coverage === 'number' && coverage >= 80) codes.push('coverage-high')
  if (typeof coverage === 'number' && coverage < 45) codes.push('coverage-low')
  if (item.radarAssessment?.requiresHumanReview) codes.push('human-review-required')
  if (!matrix) codes.push('matrix-missing')
  if (matrix?.maleImpact === 'none') codes.push('male-none')
  if (matrix?.maleImpact === 'severe') codes.push('male-severe')
  if (matrix?.relationshipClarity === 'confirmed') codes.push('relationship-confirmed')
  if (matrix?.relationshipClarity === 'friendship') codes.push('relationship-friendship')
  if (matrix?.endingSafety === 'safe') codes.push('ending-safe')
  if (matrix?.endingSafety === 'bad') codes.push('ending-bad')
  if (matrix?.creatorSpeechRisk === 'severe') codes.push('creator-severe')
  return [...new Set(codes)]
}

export function scoreWork(item: DetailItem): RecommendedWork {
  const cached = scoreCache.get(item)
  if (cached) return cached
  const score = rankScore(item.rank) + reviewScore(item.reviewStatus) + noticeScore(item.ratingNotice) + evidenceScore(item.evidenceStrength) + metricScore(item) + matrixScore(item.riskMatrix) + (item.hasEvidence ? 5 : 0)
  const result = { item, score, bucket: bucketFor(item, score), reasonCodes: reasonCodes(item) }
  scoreCache.set(item, result)
  return result
}

export function recommendedWorks(items: DetailItem[]) {
  const cached = listCache.get(items)
  if (cached) return cached
  const scored = items.filter((item) => item.collection === 'works').map(scoreWork).sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'zh-CN'))
  listCache.set(items, scored)
  return scored
}

export function recommendationsByBucket(items: DetailItem[]) {
  const scored = recommendedWorks(items)
  return {
    priority: scored.filter((item) => item.bucket === 'priority'),
    cautious: scored.filter((item) => item.bucket === 'cautious'),
    notRecommended: scored.filter((item) => item.bucket === 'not-recommended'),
  }
}
