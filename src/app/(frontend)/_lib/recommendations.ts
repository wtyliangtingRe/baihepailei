import type { DetailItem, WorkRiskMatrix } from './detail-index'

export type RecommendationBucket = 'priority' | 'cautious' | 'not-recommended'

export type RecommendedWork = {
  item: DetailItem
  score: number
  bucket: RecommendationBucket
  reasonCodes: string[]
}

function rankScore(rank?: string) {
  if (rank === 'S' || rank === 'AA') return 50
  if (rank === 'A') return 42
  if (rank === 'B') return 24
  if (rank === 'C') return 8
  if (rank === 'D' || rank === 'E' || rank === 'F' || rank === 'trash') return -40
  return 0
}

function reviewScore(value?: string) {
  if (value === 'reviewed') return 14
  if (value === 'disputed') return -22
  if (value === 'deprecated') return -50
  return 0
}

function evidenceScore(value?: string) {
  if (value === 'strong') return 16
  if (value === 'medium') return 10
  if (value === 'unassessed') return -5
  return 0
}

function matrixScore(matrix?: WorkRiskMatrix) {
  if (!matrix) return 0
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

function bucketFor(score: number): RecommendationBucket {
  if (score >= 75) return 'priority'
  if (score >= 35) return 'cautious'
  return 'not-recommended'
}

function reasonCodes(item: DetailItem) {
  const codes: string[] = []
  const matrix = item.riskMatrix

  if (item.rank === 'S' || item.rank === 'AA' || item.rank === 'A') codes.push('rank-good')
  else if (item.rank === 'D' || item.rank === 'E' || item.rank === 'F' || item.rank === 'trash') codes.push('rank-risk')
  else codes.push('rank-mid')

  if (item.reviewStatus === 'reviewed') codes.push('reviewed')
  if (item.reviewStatus === 'disputed') codes.push('disputed')
  if (item.reviewStatus === 'deprecated') codes.push('deprecated')

  if (item.evidenceStrength === 'strong' || item.evidenceStrength === 'medium') codes.push('evidence-ok')
  else if (item.hasEvidence) codes.push('evidence-present')
  else codes.push('evidence-missing')

  if (!matrix) codes.push('matrix-missing')
  if (matrix?.maleImpact === 'none') codes.push('male-none')
  if (matrix?.maleImpact === 'severe') codes.push('male-severe')
  if (matrix?.relationshipClarity === 'confirmed') codes.push('relationship-confirmed')
  if (matrix?.relationshipClarity === 'friendship') codes.push('relationship-friendship')
  if (matrix?.endingSafety === 'safe') codes.push('ending-safe')
  if (matrix?.endingSafety === 'bad') codes.push('ending-bad')
  if (matrix?.creatorSpeechRisk === 'severe') codes.push('creator-severe')

  return codes
}

export function scoreWork(item: DetailItem): RecommendedWork {
  const score = rankScore(item.rank) + reviewScore(item.reviewStatus) + evidenceScore(item.evidenceStrength) + matrixScore(item.riskMatrix) + (item.hasEvidence ? 5 : 0)
  return { item, score, bucket: bucketFor(score), reasonCodes: reasonCodes(item) }
}

export function recommendedWorks(items: DetailItem[]) {
  return items
    .filter((item) => item.collection === 'works')
    .map(scoreWork)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'zh-CN'))
}

export function recommendationsByBucket(items: DetailItem[]) {
  const scored = recommendedWorks(items)
  return {
    priority: scored.filter((item) => item.bucket === 'priority'),
    cautious: scored.filter((item) => item.bucket === 'cautious'),
    notRecommended: scored.filter((item) => item.bucket === 'not-recommended'),
  }
}
