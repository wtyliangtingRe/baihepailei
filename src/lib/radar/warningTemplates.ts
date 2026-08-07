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
  tagGroup?: string
  tagValue?: string
  relatedRatingClasses?: RadarRatingClass[]
}

export const warningTemplates: WarningTemplate[] = [
  {
    id: 'terminology-page',
    title: '用语解释',
    style: 'note',
    severity: 'low',
    category: 'operation',
    text: '本页是一个专有名词的概念解释页面。',
  },
  {
    id: 'ongoing-page',
    title: '连载中',
    style: 'warning',
    severity: 'medium',
    category: 'operation',
    text: '截至本页面最后一次更新时间，每天都会成为昨天，记载的分级可能在三分钟内失效。',
  },
  {
    id: 'neutral-stance',
    title: '保持中立',
    style: 'note',
    severity: 'medium',
    category: 'operation',
    text: '难以评定本页面涉及的立场，请在编辑时保持客观态度。',
  },
  {
    id: 'creator-visited',
    title: '圣地巡礼',
    style: 'image-text',
    severity: 'medium',
    category: 'creator',
    text: '该页面涉及创作者已亲自光临本条目。',
  },
  {
    id: 'final-adjudication',
    title: '最终裁决',
    style: 'black-banner',
    severity: 'critical',
    category: 'operation',
    text: '本条目受创始人衛藤天音及运类人命小团体成员认可。',
  },
  {
    id: 'no-hype',
    title: '禁止炒作',
    style: 'warning',
    severity: 'medium',
    category: 'operation',
    text: '本站没有义务帮助任何文痞进行免费宣传，请在编辑本页面时注意。',
  },
  {
    id: 'info-insufficient',
    title: '小作品',
    style: 'note',
    severity: 'low',
    category: 'operation',
    tagGroup: '排雷协作-站务提示',
    tagValue: '小作品',
    text: '本页面短得只剩蛆！您可以帮助补充剧情、角色关系、雷点与来源依据，或者说几句垃圾话来改进本页面。',
    relatedRatingClasses: ['B-LIGHT'],
  },
  {
    id: 'external-source-pending-review',
    title: '加速排雷（外部资料）',
    style: 'note',
    severity: 'low',
    category: 'operation',
    text: '鉴于此条目的部分标题、身份或来源信息来自外部资料源，只作为身份与检索辅助，我们迫切需要您的帮助来完善本条目中的排雷复核。',
  },
  {
    id: 'ai-synthesized-pending-review',
    title: '加速排雷（AI）',
    style: 'warning',
    severity: 'medium',
    category: 'operation',
    text: '鉴于此条目的部分排雷信息来自 AI 综合整理，我们迫切需要您的帮助来完善本条目中的排雷复核。',
  },
  {
    id: 'identity-conflict',
    title: '加速排雷（匹配冲突）',
    style: 'warning',
    severity: 'medium',
    category: 'operation',
    tagGroup: '加速排雷',
    tagValue: '匹配冲突',
    text: '鉴于此条目在外部 ID、标题或来源之间存在冲突，我们迫切需要您的帮助来完善本条目中的排雷复核。',
  },
  {
    id: 'needs-radar',
    title: '需要排雷',
    style: 'warning',
    severity: 'medium',
    category: 'relationship',
    tagGroup: '关系提示',
    tagValue: '需要排雷',
    text: '本页面描述的作品是神必作品，我们对其所知无几。为了更详实地记载资料，成为更揭露事实真相的排雷网站，本站需要您的帮助。',
  },
  {
    id: 'heavy-radar-warning',
    title: '不适内容',
    style: 'warning',
    severity: 'high',
    category: 'relationship',
    text: '本页面可能包含使您感到严重不适的内容，请酌情查阅。原因：可能包含会影响百合观看体验的重度关系雷点。',
    relatedRatingClasses: ['E-MALE-INTIMACY', 'E-PAST-MALE-ROMANCE', 'E-MALE-SUBSTITUTE', 'E-ROUTE-CONTAMINATION', 'E-OFFICIAL-DENIAL'],
  },
  {
    id: 'high-risk-radar-warning',
    title: '不适内容',
    style: 'danger',
    severity: 'critical',
    category: 'relationship',
    text: '本页面可能包含使您感到严重不适的内容，请酌情查阅。原因：可能包含男性结局、男性 NTR、官方百合欺诈等高危内容。',
    relatedRatingClasses: ['F-HET-END', 'F-MALE-NTR', 'F-YURI-BAIT', 'F-SETTING-BAIT', 'F-PROJECT-CONTAMINATION'],
  },
  {
    id: 'adult-visibility-warning',
    title: '不适内容',
    style: 'warning',
    severity: 'high',
    category: 'content',
    tagGroup: '内容提示',
    tagValue: '不适内容',
    text: '本页面可能包含使您感到严重不适的内容，请酌情查阅。原因：可能涉及成人向、性描写或其他不适合所有读者的内容。',
  },
  {
    id: 'ideology-discomfort-warning',
    title: '不适内容',
    style: 'black-banner',
    severity: 'critical',
    category: 'other',
    text: '本页面可能包含使您感到严重不适的内容，请酌情查阅。原因：违背人本主义与平权主义之意识形态。',
  },
]
