import type {
  PublicGrade,
  PublicMediaGroup,
  PublicRatingState,
  PublicWorkRating,
} from '@/lib/publicRelease'

import {
  isRadarRatingClass,
  radarClassDefinitions,
  radarGradeLabels,
  radarGradeSummaries,
  type RadarGrade,
  type RadarRatingClass,
} from './ratingPolicy'

export const publicStatusLabels: Record<PublicRatingState, string> = {
  rated: '已有评级',
  research_record_only: '已有资料，暂未评级',
  conflict: '结论待核对',
  blocked: '资料暂不可用',
  research_required: '需要专项研究',
  not_assessed: '尚未评级',
}

export const publicStatusDescriptions: Record<PublicRatingState, string> = {
  rated: '本站已有可公开的 S–F 结论；请同时查看具体警示与资料完整度。',
  research_record_only: '目前只有作品资料，还没有足够依据形成公开评级。',
  conflict: '已有材料指向不同结论，本站暂不替用户制造一个确定答案。',
  blocked: '现有资料存在关键缺口，暂时无法给出可靠评级。',
  research_required: '这部作品需要针对关系、结局或设定做进一步核实。',
  not_assessed: '作品已收录，但还没有进入完整评级流程。',
}

export const mediaGroupLabels: Record<PublicMediaGroup, string> = {
  anime: '动画',
  manga: '漫画',
  novel: '小说',
  visual_novel: '视觉小说',
  game: '游戏',
  other: '其他',
  unknown: '类型待补',
}

export function mediaLabel(group: PublicMediaGroup, type?: string): string {
  if (group === 'visual_novel') return '视觉小说'
  if (group !== 'unknown') return mediaGroupLabels[group]
  if (type === 'anime') return '动画'
  if (type === 'manga') return '漫画'
  if (type === 'novel') return '小说'
  return mediaGroupLabels.unknown
}

export function gradeLabel(grade: PublicGrade): string {
  return radarGradeLabels[grade]
}

export function gradeSummary(grade: PublicGrade): string {
  return radarGradeSummaries[grade]
}

export function ratingClassEntries(rating: PublicWorkRating) {
  return rating.classes
    .filter(isRadarRatingClass)
    .map((code) => ({
      code,
      definition: radarClassDefinitions[code],
    }))
}

export function ratingLead(rating: PublicWorkRating): string {
  if (rating.state !== 'rated') return publicStatusDescriptions[rating.state]
  if (rating.uncertaintyKind === 'evidence_insufficient') {
    return '当前只确认到 D 级资料边界，尚未建立可公开的具体雷点；请把它理解为“证据不足”，而不是“已确认有某种雷”。'
  }
  const firstClass = ratingClassEntries(rating)[0]
  if (firstClass) return firstClass.definition.summary
  if (rating.grade) {
    return `${gradeSummary(rating.grade)} 当前资料只保留了等级结论，具体细分类仍待补录。`
  }
  return publicStatusDescriptions[rating.state]
}

export function rangeLabel(rating: PublicWorkRating): string | null {
  if (!rating.bestGrade || !rating.worstGrade || rating.bestGrade === rating.worstGrade) return null
  const likely = rating.likelyGrade ? `，最可能 ${rating.likelyGrade}` : ''
  return `${rating.bestGrade}–${rating.worstGrade}${likely}`
}

export function confidenceLabel(value?: string): string {
  if (value === 'low') return '资料有限'
  if (value === 'medium') return '中等'
  if (value === 'high' || value === 'established' || value === 'authored') return '依据已建立'
  return '未单列'
}

export function ratingModeLabel(value?: string): string {
  if (value === 'bounded_range') return '范围结论'
  if (value === 'fixed_grade') return '固定等级'
  return '当前结论'
}

export function classTone(code: RadarRatingClass): 'positive' | 'notice' | 'warning' | 'danger' | 'critical' {
  const grade = radarClassDefinitions[code].grade as RadarGrade
  if (grade === 'S' || grade === 'A') return 'positive'
  if (grade === 'B' || grade === 'C') return 'notice'
  if (grade === 'D') return 'warning'
  if (grade === 'E') return 'danger'
  return 'critical'
}

export function compactCredits(
  credits: Array<{ name: string; role: string }>,
  limit = 3,
): string {
  return credits.slice(0, limit).map((credit) => `${credit.name}（${credit.role}）`).join('、')
}
