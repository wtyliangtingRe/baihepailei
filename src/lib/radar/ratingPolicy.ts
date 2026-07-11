export const RADAR_RATING_POLICY_ID = 'radar-rating-policy-v0.3-draft' as const

export type RadarGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'X'

export type RadarRatingClass =
  | 'S-RELATIONSHIP'
  | 'S-MARRIAGE'
  | 'S-CREATOR-SAFE'
  | 'A-ONGOING'
  | 'A-OPEN-END'
  | 'A-YURI-HAREM'
  | 'A-NEAR-CONFIRMED'
  | 'B-LIGHT'
  | 'B-MALE-NOISE'
  | 'B-CRITIQUE-RADAR'
  | 'B-POWER-IMBALANCE'
  | 'B-FEMALE-NTR'
  | 'B-UNFINISHED-CREATOR-RISK'
  | 'C-FRIENDSHIP'
  | 'C-SIDE-CP'
  | 'C-CONTEXT-RISK'
  | 'C-MALE-MAIN-CAST'
  | 'C-FUTURE-HET-HINT'
  | 'C-STRAIGHT-GIRL-HINT'
  | 'C-SPECIAL'
  | 'D-GENERAL'
  | 'D-SIDE-YURI'
  | 'D-MULTI-ENDING'
  | 'D-MINOR-TRASH'
  | 'D-SIDE-SEVERE-RADAR'
  | 'D-TS'
  | 'D-FUTA'
  | 'D-ABO'
  | 'D-CROSSDRESSING'
  | 'D-QUEER-GENERAL'
  | 'D-UNCLEAR'
  | 'E-MALE-INTIMACY'
  | 'E-PAST-MALE-ROMANCE'
  | 'E-MALE-SUBSTITUTE'
  | 'E-STRAIGHT-UNREQUITED'
  | 'E-MALE-POSSIBILITY'
  | 'E-ROUTE-CONTAMINATION'
  | 'E-BL-HEAVY'
  | 'E-OFFICIAL-DENIAL'
  | 'E-TOKEN-YURI'
  | 'E-SETTING-SEVERE'
  | 'E-SPECIAL'
  | 'F-HET-END'
  | 'F-MALE-INTIMACY'
  | 'F-MALE-NTR'
  | 'F-YURI-BAIT'
  | 'F-SETTING-BAIT'
  | 'F-PROJECT-CONTAMINATION'
  | 'X-PREPAID-FRAUD'
  | 'X-REPEATED-BAIT'
  | 'X-MALICIOUS-CREATOR'
  | 'X-SPECIAL'

export type RadarNotice =
  | 'none'
  | 'human_reviewed'
  | 'ai_synthesized_pending_review'
  | 'external_source_pending_review'
  | 'insufficient_information'
  | 'identity_conflict'
  | 'quarantine_excluded'

export const radarGradeLabels: Record<RadarGrade, string> = {
  S: '无争议核心百合',
  A: '安心推荐',
  B: '轻度条件推荐',
  C: '有条件推荐',
  D: '非核心百合 / 分区作品 / 强不确定',
  E: '重度排雷',
  F: '高危排雷',
  X: '严重欺诈 / 黑名单',
}

export const radarClassDefinitions: Record<RadarRatingClass, {
  grade: RadarGrade
  label: string
  keywords: string[]
  requiresHumanReview?: boolean
  doNotAutoPublish?: boolean
}> = {
  'S-RELATIONSHIP': { grade: 'S', label: '明确确立恋爱关系', keywords: ['confirmed_relationship'] },
  'S-MARRIAGE': { grade: 'S', label: '结婚或等价长期承诺', keywords: ['marriage', 'long_term_commitment'] },
  'S-CREATOR-SAFE': { grade: 'S', label: '创作者 / 官方态度安全', keywords: ['creator_safe', 'official_safe'] },

  'A-ONGOING': { grade: 'A', label: '未完结但走向稳定', keywords: ['ongoing_safe'] },
  'A-OPEN-END': { grade: 'A', label: '开放式结局但可安心接受', keywords: ['open_end_safe'] },
  'A-YURI-HAREM': { grade: 'A', label: '百合后宫', keywords: ['yuri_harem'] },
  'A-NEAR-CONFIRMED': { grade: 'A', label: '几乎确立恋爱关系', keywords: ['near_confirmed'] },

  'B-LIGHT': { grade: 'B', label: '轻百合 / 恋爱未确立', keywords: ['light_yuri'] },
  'B-MALE-NOISE': { grade: 'B', label: '男性或疑似男性干扰观感', keywords: ['male_noise'] },
  'B-CRITIQUE-RADAR': { grade: 'B', label: '作品批判雷点而描写雷点', keywords: ['critique_radar'] },
  'B-POWER-IMBALANCE': { grade: 'B', label: '全女性关系中的不对等关系', keywords: ['power_imbalance'] },
  'B-FEMALE-NTR': { grade: 'B', label: '女性之间 NTR / 党争 / 胃疼', keywords: ['female_ntr', 'love_triangle'] },
  'B-UNFINISHED-CREATOR-RISK': { grade: 'B', label: '作者主要一般向且作品未完结', keywords: ['unfinished_creator_risk'] },

  'C-FRIENDSHIP': { grade: 'C', label: '友情以上难确认', keywords: ['friendship_unclear'] },
  'C-SIDE-CP': { grade: 'C', label: '非百合作品中的百合配角 / 群像', keywords: ['side_cp'] },
  'C-CONTEXT-RISK': { grade: 'C', label: '企划 / 作者 / 地区 / 连载上下文风险', keywords: ['context_risk'] },
  'C-MALE-MAIN-CAST': { grade: 'C', label: '主要角色中有男性但女性 CP 成立', keywords: ['male_main_cast'] },
  'C-FUTURE-HET-HINT': { grade: 'D', label: '未来异性恋婚育暗示', keywords: ['future_het_hint'] },
  'C-STRAIGHT-GIRL-HINT': { grade: 'C', label: '直女发言或非百合主要角色风险', keywords: ['straight_girl_hint'] },
  'C-SPECIAL': { grade: 'C', label: '特殊自由裁量保留', keywords: ['special_case'], requiresHumanReview: true },

  'D-GENERAL': { grade: 'D', label: '一般向 / 非百合主线', keywords: ['general'] },
  'D-SIDE-YURI': { grade: 'D', label: '百合只是轻微配角元素', keywords: ['minor_side_yuri'] },
  'D-MULTI-ENDING': { grade: 'D', label: '多结局 / 路线不稳定', keywords: ['multi_ending'] },
  'D-MINOR-TRASH': { grade: 'D', label: '轻度恶俗桥段或烂活', keywords: ['minor_trash'] },
  'D-SIDE-SEVERE-RADAR': { grade: 'D', label: '重雷只发生在配角', keywords: ['side_severe_radar'] },
  'D-TS': { grade: 'D', label: 'TS / 变百 / 变身分区作品', keywords: ['ts', 'transformation'] },
  'D-FUTA': { grade: 'D', label: '扶她分区作品', keywords: ['futa'] },
  'D-ABO': { grade: 'E', label: 'ABO 分区作品', keywords: ['abo'] },
  'D-CROSSDRESSING': { grade: 'D', label: '女装少年 / 性别表现暧昧分区作品', keywords: ['crossdressing', 'otokonoko'] },
  'D-QUEER-GENERAL': { grade: 'D', label: '泛 LGBTQ+ 但非核心百合', keywords: ['queer_general'] },
  'D-UNCLEAR': { grade: 'D', label: '过于抽象或证据不足', keywords: ['unclear', 'insufficient_evidence'], requiresHumanReview: true },

  'E-MALE-INTIMACY': { grade: 'E', label: '男性亲密接触雷', keywords: ['male_intimacy'], requiresHumanReview: true },
  'E-PAST-MALE-ROMANCE': { grade: 'E', label: '前男友 / 过去男性恋爱雷', keywords: ['past_male_romance'], requiresHumanReview: true },
  'E-MALE-SUBSTITUTE': { grade: 'E', label: '男性替身雷', keywords: ['male_substitute'], requiresHumanReview: true },
  'E-STRAIGHT-UNREQUITED': { grade: 'E', label: '姬恋直无果雷', keywords: ['straight_unrequited'], requiresHumanReview: true },
  'E-MALE-POSSIBILITY': { grade: 'E', label: '明显男性恋爱可能性雷', keywords: ['male_possibility'], requiresHumanReview: true },
  'E-ROUTE-CONTAMINATION': { grade: 'E', label: '路线污染雷', keywords: ['route_contamination'], requiresHumanReview: true },
  'E-BL-HEAVY': { grade: 'E', label: '大量 BL / 非百合配对挤占雷', keywords: ['bl_heavy'], requiresHumanReview: true },
  'E-OFFICIAL-DENIAL': { grade: 'E', label: '官方 / 创作者拒绝百合雷', keywords: ['official_denial'], requiresHumanReview: true },
  'E-TOKEN-YURI': { grade: 'E', label: '非百合作品中的时尚单品雷', keywords: ['token_yuri'], requiresHumanReview: true },
  'E-SETTING-SEVERE': { grade: 'E', label: '设定分区中的重度雷', keywords: ['setting_severe'], requiresHumanReview: true },
  'E-SPECIAL': { grade: 'E', label: '特殊重度排雷', keywords: ['special_e'], requiresHumanReview: true },

  'F-HET-END': { grade: 'F', label: '男性结婚 / 生子结局', keywords: ['het_end'], requiresHumanReview: true },
  'F-MALE-INTIMACY': { grade: 'F', label: '百合向中的男性亲密接触欺诈', keywords: ['fraud_male_intimacy'], requiresHumanReview: true },
  'F-MALE-NTR': { grade: 'F', label: '男性 NTR', keywords: ['male_ntr'], requiresHumanReview: true },
  'F-YURI-BAIT': { grade: 'F', label: '官方百合欺诈', keywords: ['yuri_bait'], requiresHumanReview: true },
  'F-SETTING-BAIT': { grade: 'F', label: '设定欺诈', keywords: ['setting_bait'], requiresHumanReview: true },
  'F-PROJECT-CONTAMINATION': { grade: 'F', label: '企划继承污染', keywords: ['project_contamination'], requiresHumanReview: true },

  'X-PREPAID-FRAUD': { grade: 'X', label: '预付费 / 众筹 / 付费作品百合欺诈', keywords: ['prepaid_fraud'], requiresHumanReview: true },
  'X-REPEATED-BAIT': { grade: 'X', label: '官方或创作者反复误导', keywords: ['repeated_bait'], requiresHumanReview: true },
  'X-MALICIOUS-CREATOR': { grade: 'X', label: '创作者明确恶意', keywords: ['malicious_creator'], requiresHumanReview: true },
  'X-SPECIAL': { grade: 'X', label: '其他严重黑名单情况', keywords: ['special_x'], requiresHumanReview: true },
}

export const radarPolicySafety = {
  doNotOverwriteHumanVerified: true,
  severeRatingsRemainPublic: true,
  doNotAutoAssignX: true,
  preserveConflictingEvidence: true,
  storePolicyVersion: true,
  autoSuggestionsAreNotFinalPublicRatings: true,
  reviewNoticeUsesPageTemplates: true,
} as const
