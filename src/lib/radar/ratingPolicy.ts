export const RADAR_RATING_POLICY_ID = 'radar-rating-policy-v0.5' as const
export const RADAR_CLASS_REGISTRY_ID = 'radar-class-registry-v0.5' as const
export const RADAR_POLICY_BUNDLE_ID = 'radar-policy-bundle-v0.5' as const

export type RadarGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'X'

export type RadarRatingClass =
  | 'S-RELATIONSHIP'
  | 'S-MARRIAGE'
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
  | 'C-FANWORK-NON-INHERITED'
  | 'C-MALE-MAIN-CAST'
  | 'C-STRAIGHT-GIRL-HINT'
  | 'C-SPECIAL'
  | 'D-GENERAL'
  | 'D-SIDE-YURI'
  | 'D-MULTI-ENDING'
  | 'D-MINOR-TRASH'
  | 'D-SIDE-SEVERE-RADAR'
  | 'D-FUTURE-HET-HINT'
  | 'D-SPECIAL'
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
  | 'E-CREATOR-MALICIOUS-HISTORY'
  | 'E-SPECIAL'
  | 'F-HET-END'
  | 'F-MALE-INTIMACY'
  | 'F-MALE-NTR'
  | 'F-YURI-BAIT'
  | 'F-SETTING-BAIT'
  | 'F-PROJECT-CONTAMINATION'
  | 'F-CREATOR-HIGH-RISK-SPEECH'
  | 'F-SPECIAL'
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
  D: '非核心百合 / 路线不稳定',
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
  'A-ONGOING': { grade: 'A', label: '未完结但走向稳定', keywords: ['ongoing_safe'] },
  'A-OPEN-END': { grade: 'A', label: '开放式结局但可安心接受', keywords: ['open_end_safe'] },
  'A-YURI-HAREM': { grade: 'A', label: '百合后宫', keywords: ['yuri_harem'] },
  'A-NEAR-CONFIRMED': { grade: 'A', label: '几乎确立恋爱关系', keywords: ['near_confirmed'] },
  'B-LIGHT': { grade: 'B', label: '轻度条件推荐 / 已确认百合基线', keywords: ['light_yuri', 'confirmed_yuri_baseline'] },
  'B-MALE-NOISE': { grade: 'B', label: '男性噪声但未形成更低等级触发', keywords: ['male_noise'] },
  'B-CRITIQUE-RADAR': { grade: 'B', label: '作品主旨意在批判某一雷点，而不得不对其描写', keywords: ['critique_radar'] },
  'B-POWER-IMBALANCE': { grade: 'B', label: '全女性关系中的不对等关系', keywords: ['power_imbalance'] },
  'B-FEMALE-NTR': { grade: 'B', label: '女性之间 NTR / 党争 / 胃疼', keywords: ['female_ntr', 'love_triangle'] },
  'B-UNFINISHED-CREATOR-RISK': { grade: 'B', label: '作者主要一般向且作品未完结', keywords: ['unfinished_creator_risk'] },
  'C-FRIENDSHIP': { grade: 'C', label: '友情以上难确认', keywords: ['friendship_unclear'] },
  'C-SIDE-CP': { grade: 'C', label: '非百合作品中的百合配角 / 群像', keywords: ['side_cp'] },
  'C-CONTEXT-RISK': { grade: 'C', label: '不具继承关系的多元企划上下文风险', keywords: ['context_risk', 'non_inherited_project_context'] },
  'C-FANWORK-NON-INHERITED': { grade: 'C', label: '不具继承关系的二次创作', keywords: ['fanwork_non_inherited'] },
  'C-MALE-MAIN-CAST': { grade: 'C', label: '主要角色中有男性但女性 CP 成立', keywords: ['male_main_cast'] },
  'C-STRAIGHT-GIRL-HINT': { grade: 'C', label: '直女发言或非百合主要角色风险', keywords: ['straight_girl_hint'] },
  'C-SPECIAL': { grade: 'C', label: '特殊自由裁量保留', keywords: ['special_case'], requiresHumanReview: true },
  'D-GENERAL': { grade: 'D', label: '一般向 / 非百合主线', keywords: ['general'] },
  'D-SIDE-YURI': { grade: 'D', label: '百合只是轻微配角元素', keywords: ['minor_side_yuri'] },
  'D-MULTI-ENDING': { grade: 'D', label: '多结局 / 路线不稳定', keywords: ['multi_ending'] },
  'D-MINOR-TRASH': { grade: 'D', label: '轻度雷点 / 恶俗桥段或其他不足 E/F 的明确不适内容', keywords: ['minor_trash'] },
  'D-SIDE-SEVERE-RADAR': { grade: 'D', label: '重雷只发生在配角', keywords: ['side_severe_radar'] },
  'D-FUTURE-HET-HINT': { grade: 'D', label: '未来异性恋可能性或婚育暗示（最终百合结果仍有合理可能）', keywords: ['future_het_hint'] },
  'D-SPECIAL': { grade: 'D', label: '特殊 D 级自由裁量保留', keywords: ['special_d'], requiresHumanReview: true },
  'E-MALE-INTIMACY': { grade: 'E', label: '男性亲密接触雷', keywords: ['male_intimacy'] },
  'E-PAST-MALE-ROMANCE': { grade: 'E', label: '前男友 / 过去男性恋爱雷', keywords: ['past_male_romance'] },
  'E-MALE-SUBSTITUTE': { grade: 'E', label: '男性替身雷', keywords: ['male_substitute'] },
  'E-STRAIGHT-UNREQUITED': { grade: 'E', label: '姬恋直无果雷', keywords: ['straight_unrequited'] },
  'E-MALE-POSSIBILITY': { grade: 'E', label: '有具体证据的男性恋爱可能性雷', keywords: ['male_possibility'] },
  'E-ROUTE-CONTAMINATION': { grade: 'E', label: '路线污染雷', keywords: ['route_contamination'] },
  'E-BL-HEAVY': { grade: 'E', label: '大量 BL / 非百合配对挤占雷', keywords: ['bl_heavy'] },
  'E-OFFICIAL-DENIAL': { grade: 'E', label: '官方 / 创作者明确否定百合定位', keywords: ['official_denial'] },
  'E-TOKEN-YURI': { grade: 'E', label: '非百合作品中的时尚单品雷', keywords: ['token_yuri'] },
  'E-SETTING-SEVERE': { grade: 'E', label: '设定档案中的重度雷', keywords: ['setting_severe'] },
  'E-CREATOR-MALICIOUS-HISTORY': { grade: 'E', label: '重复同类且与当前项目直接相关的创作者恶意历史', keywords: ['creator_malicious_history', 'creator_interference'] },
  'E-SPECIAL': { grade: 'E', label: '特殊重度排雷', keywords: ['special_e'], requiresHumanReview: true },
  'F-HET-END': { grade: 'F', label: '男性结婚 / 生子结局', keywords: ['het_end'] },
  'F-MALE-INTIMACY': { grade: 'F', label: '核心、强制或结局级男性亲密接触', keywords: ['fraud_male_intimacy'] },
  'F-MALE-NTR': { grade: 'F', label: '男性 NTR', keywords: ['male_ntr'] },
  'F-YURI-BAIT': { grade: 'F', label: '有证据支持的实质百合欺诈', keywords: ['yuri_bait'] },
  'F-SETTING-BAIT': { grade: 'F', label: '有证据支持的设定欺诈', keywords: ['setting_bait'] },
  'F-PROJECT-CONTAMINATION': { grade: 'F', label: '企划级实质污染', keywords: ['project_contamination'] },
  'F-CREATOR-HIGH-RISK-SPEECH': { grade: 'F', label: '与当前项目直接相关的高危创作者发言', keywords: ['creator_high_risk_speech'] },
  'F-SPECIAL': { grade: 'F', label: '特殊 F 级自由裁量保留', keywords: ['special_f'], requiresHumanReview: true },
  'X-PREPAID-FRAUD': { grade: 'X', label: '预付费 / 众筹 / 付费作品严重欺诈', keywords: ['prepaid_fraud'], requiresHumanReview: true, doNotAutoPublish: true },
  'X-REPEATED-BAIT': { grade: 'X', label: '官方或创作者反复严重误导', keywords: ['repeated_bait'], requiresHumanReview: true, doNotAutoPublish: true },
  'X-MALICIOUS-CREATOR': { grade: 'X', label: '人工确认的严重恶意创作者行为', keywords: ['malicious_creator', 'creator_malicious_works_and_speech'], requiresHumanReview: true, doNotAutoPublish: true },
  'X-SPECIAL': { grade: 'X', label: '其他人工裁决的严重黑名单情况', keywords: ['special_x'], requiresHumanReview: true, doNotAutoPublish: true },
}

export const radarPreferenceProfileKeys = [
  'ts',
  'futa',
  'abo',
  'otokonoko_or_crossdressing',
  'queer_general',
] as const

export const radarRetiredClassIds = [
  'S-CREATOR-SAFE',
  'C-FUTURE-HET-HINT',
  'D-TS',
  'D-FUTA',
  'D-ABO',
  'D-CROSSDRESSING',
  'D-QUEER-GENERAL',
  'D-UNCLEAR',
] as const

export const radarPolicySafety = {
  doNotOverwriteHumanVerified: true,
  severeRatingsRemainPublic: true,
  doNotAutoAssignX: true,
  machineXForbidden: true,
  preserveConflictingEvidence: true,
  storePolicyVersion: true,
  autoSuggestionsAreNotFinalPublicRatings: true,
  reviewNoticeUsesPageTemplates: true,
  settingProfilesDoNotAutomaticallyChangeCoreGrade: true,
  dUnclearIsHistoricalOnly: true,
} as const
