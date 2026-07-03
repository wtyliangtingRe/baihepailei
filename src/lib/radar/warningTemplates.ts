import type { RadarRatingClass } from './ratingPolicy'

export type WarningTemplateStyle =
  | 'note'
  | 'warning'
  | 'danger'
  | 'black-banner'
  | 'image-text'

export type WarningTemplate = {
  id: string
  title: string
  style: WarningTemplateStyle
  severity: 'low' | 'medium' | 'high' | 'critical'
  category: 'content' | 'relationship' | 'creator' | 'operation' | 'other'
  text: string
  relatedRatingClasses?: RadarRatingClass[]
}

export const warningTemplates: WarningTemplate[] = [
  {
    id: 'info-insufficient',
    title: '资料不足，待补充',
    style: 'note',
    severity: 'low',
    category: 'operation',
    text: '此页面资料仍不完整，部分信息来自外部资料源，尚待人工复核。如果您了解这部作品，欢迎补充剧情、角色关系、雷点与来源依据。',
    relatedRatingClasses: ['D-UNCLEAR'],
  },
  {
    id: 'external-source-pending-review',
    title: '外部资料源，待复核',
    style: 'note',
    severity: 'low',
    category: 'operation',
    text: '此条目的部分标题、身份或来源信息来自外部资料源。外部来源只作为身份与检索辅助，不代表本站已经完成排雷复核。',
  },
  {
    id: 'ai-synthesized-pending-review',
    title: 'AI 综合，待复核',
    style: 'warning',
    severity: 'medium',
    category: 'operation',
    text: '本页面的部分排雷信息来自 AI 综合整理，尚待人工复核。请不要将其视为最终结论。',
  },
  {
    id: 'identity-conflict',
    title: '身份匹配存在冲突',
    style: 'warning',
    severity: 'medium',
    category: 'operation',
    text: '此条目在外部 ID、标题或来源之间存在冲突，暂不自动覆盖已有资料。请以人工复核结果为准。',
  },
  {
    id: 'heavy-radar-warning',
    title: '重度排雷提示',
    style: 'warning',
    severity: 'high',
    category: 'relationship',
    text: '本页面可能包含会影响百合观看体验的重度关系雷点。继续阅读前请留意具体条目说明。',
    relatedRatingClasses: ['E-MALE-INTIMACY', 'E-PAST-MALE-ROMANCE', 'E-MALE-SUBSTITUTE', 'E-ROUTE-CONTAMINATION', 'E-OFFICIAL-DENIAL'],
  },
  {
    id: 'high-risk-radar-warning',
    title: '高危排雷提示',
    style: 'danger',
    severity: 'critical',
    category: 'relationship',
    text: '本页面可能包含男性结局、男性 NTR、官方百合欺诈等高危内容。请谨慎阅读。',
    relatedRatingClasses: ['F-HET-END', 'F-MALE-NTR', 'F-YURI-BAIT', 'F-SETTING-BAIT', 'F-PROJECT-CONTAMINATION'],
  },
  {
    id: 'adult-visibility-warning',
    title: '成人内容提示',
    style: 'warning',
    severity: 'high',
    category: 'content',
    text: '本页面可能涉及成人向、性描写或其他不适合所有读者的内容。成人可见性提示与百合关系排雷等级分开处理。',
  },
]
