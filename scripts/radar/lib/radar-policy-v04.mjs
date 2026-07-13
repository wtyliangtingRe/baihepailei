export const RADAR_POLICY_ID = 'radar-rating-policy-v0.4-draft'

export const GRADE_ORDER = ['X', 'F', 'E', 'D', 'C', 'B', 'A', 'S']

export const GRADE_LABELS = {
  S: '无争议核心百合',
  A: '安心推荐',
  B: '轻度条件推荐',
  C: '有条件推荐',
  D: '非核心百合 / 分区作品 / 强不确定',
  E: '重度排雷',
  F: '高危排雷',
  X: '严重欺诈 / 黑名单',
}

export const AI_REVIEW_NOTICE = {
  id: 'ai-synthesized-pending-review',
  title: '加速排雷（AI）',
  style: 'warning',
  severity: 'medium',
  ratingNotice: 'ai_synthesized_pending_review',
}

export const EVIDENCE_STATUSES = [
  'official_confirmed',
  'primary_material_confirmed',
  'multiple_secondary_supported',
  'single_secondary_supported',
  'community_consensus',
  'inferred_from_metadata',
  'conflicting_evidence',
  'insufficient_evidence',
  'unknown',
]

export const RADAR_RULES = [
  { code: 'S-RELATIONSHIP', grade: 'S', label: '明确确立恋爱关系', keywords: ['confirmed_relationship'] },
  { code: 'S-MARRIAGE', grade: 'S', label: '结婚或等价长期承诺', keywords: ['marriage', 'long_term_commitment'] },
  { code: 'S-CREATOR-SAFE', grade: 'S', label: '创作者 / 官方态度安全', keywords: ['creator_safe', 'official_safe'] },

  { code: 'A-ONGOING', grade: 'A', label: '未完结但走向稳定', keywords: ['ongoing_safe'] },
  { code: 'A-OPEN-END', grade: 'A', label: '开放式结局但可安心接受', keywords: ['open_end_safe'] },
  { code: 'A-YURI-HAREM', grade: 'A', label: '百合后宫', keywords: ['yuri_harem'] },
  { code: 'A-NEAR-CONFIRMED', grade: 'A', label: '几乎确立恋爱关系', keywords: ['near_confirmed'] },

  { code: 'B-LIGHT', grade: 'B', label: '轻百合 / 恋爱未确立', keywords: ['light_yuri'] },
  { code: 'B-MALE-NOISE', grade: 'B', label: '男性或疑似男性干扰观感', keywords: ['male_noise'] },
  { code: 'B-CRITIQUE-RADAR', grade: 'B', label: '作品主旨意在批判某一雷点，而不得不对其描写', keywords: ['critique_radar'] },
  { code: 'B-POWER-IMBALANCE', grade: 'B', label: '全女性关系中的不对等关系', keywords: ['power_imbalance'] },
  { code: 'B-FEMALE-NTR', grade: 'B', label: '女性之间 NTR / 党争 / 胃疼', keywords: ['female_ntr', 'love_triangle'] },
  { code: 'B-UNFINISHED-CREATOR-RISK', grade: 'B', label: '作者主要一般向且作品未完结', keywords: ['unfinished_creator_risk'] },

  { code: 'C-FRIENDSHIP', grade: 'C', label: '友情以上难确认', keywords: ['friendship_unclear'] },
  { code: 'C-SIDE-CP', grade: 'C', label: '非百合作品中的百合配角 / 群像', keywords: ['side_cp'] },
  { code: 'C-CONTEXT-RISK', grade: 'C', label: '不具继承关系的多元企划中其他部分为非百合作品，但本作暂无其他雷点', keywords: ['context_risk', 'non_inherited_project_context'] },
  { code: 'C-FANWORK-NON-INHERITED', grade: 'C', label: '任何原作的不具继承关系的二次创作，但本作暂无其他雷点', keywords: ['fanwork_non_inherited'] },
  { code: 'C-MALE-MAIN-CAST', grade: 'C', label: '主要角色中有男性但女性 CP 成立', keywords: ['male_main_cast'] },
  { code: 'C-FUTURE-HET-HINT', grade: 'D', label: '未来异性恋婚育暗示', keywords: ['future_het_hint'] },
  { code: 'C-STRAIGHT-GIRL-HINT', grade: 'C', label: '直女发言或非百合主要角色风险', keywords: ['straight_girl_hint'] },
  { code: 'C-SPECIAL', grade: 'C', label: '特殊自由裁量保留', keywords: ['special_case'], requiresHumanReview: true },

  { code: 'D-GENERAL', grade: 'D', label: '一般向 / 非百合主线', keywords: ['general'] },
  { code: 'D-SIDE-YURI', grade: 'D', label: '百合只是轻微配角元素', keywords: ['minor_side_yuri'] },
  { code: 'D-MULTI-ENDING', grade: 'D', label: '多结局 / 路线不稳定', keywords: ['multi_ending'] },
  { code: 'D-MINOR-TRASH', grade: 'D', label: '轻度恶俗桥段或烂活', keywords: ['minor_trash'] },
  { code: 'D-SIDE-SEVERE-RADAR', grade: 'D', label: '重雷只发生在配角', keywords: ['side_severe_radar'] },
  { code: 'D-TS', grade: 'D', label: 'TS / 变百 / 变身分区作品', keywords: ['ts', 'transformation'] },
  { code: 'D-FUTA', grade: 'D', label: '扶她分区作品', keywords: ['futa'] },
  { code: 'D-ABO', grade: 'E', label: 'ABO 分区作品', keywords: ['abo'] },
  { code: 'D-CROSSDRESSING', grade: 'D', label: '女装少年 / 性别表现暧昧分区作品', keywords: ['crossdressing', 'otokonoko'] },
  { code: 'D-QUEER-GENERAL', grade: 'D', label: '泛 LGBTQ+ 但非核心百合', keywords: ['queer_general'] },
  { code: 'D-UNCLEAR', grade: 'D', label: '过于抽象或证据不足', keywords: ['unclear', 'insufficient_evidence'], requiresHumanReview: true },

  { code: 'E-MALE-INTIMACY', grade: 'E', label: '男性亲密接触雷', keywords: ['male_intimacy'], requiresHumanReview: true },
  { code: 'E-PAST-MALE-ROMANCE', grade: 'E', label: '前男友 / 过去男性恋爱雷', keywords: ['past_male_romance'], requiresHumanReview: true },
  { code: 'E-MALE-SUBSTITUTE', grade: 'E', label: '男性替身雷', keywords: ['male_substitute'], requiresHumanReview: true },
  { code: 'E-STRAIGHT-UNREQUITED', grade: 'E', label: '姬恋直无果雷', keywords: ['straight_unrequited'], requiresHumanReview: true },
  { code: 'E-MALE-POSSIBILITY', grade: 'E', label: '明显男性恋爱可能性雷', keywords: ['male_possibility'], requiresHumanReview: true },
  { code: 'E-ROUTE-CONTAMINATION', grade: 'E', label: '路线污染雷', keywords: ['route_contamination'], requiresHumanReview: true },
  { code: 'E-BL-HEAVY', grade: 'E', label: '大量 BL / 非百合配对挤占雷', keywords: ['bl_heavy'], requiresHumanReview: true },
  { code: 'E-OFFICIAL-DENIAL', grade: 'E', label: '官方 / 创作者拒绝百合雷', keywords: ['official_denial'], requiresHumanReview: true },
  { code: 'E-TOKEN-YURI', grade: 'E', label: '非百合作品中的时尚单品雷', keywords: ['token_yuri'], requiresHumanReview: true },
  { code: 'E-SETTING-SEVERE', grade: 'E', label: '设定分区中的重度雷', keywords: ['setting_severe'], requiresHumanReview: true },
  { code: 'E-CREATOR-MALICIOUS-HISTORY', grade: 'E', label: '创作者已创作大量恶意作品或对作品进行恶意干涉', keywords: ['creator_malicious_history', 'creator_interference'], requiresHumanReview: true },
  { code: 'E-SPECIAL', grade: 'E', label: '特殊重度排雷', keywords: ['special_e'], requiresHumanReview: true },

  { code: 'F-HET-END', grade: 'F', label: '男性结婚 / 生子结局', keywords: ['het_end'], requiresHumanReview: true },
  { code: 'F-MALE-INTIMACY', grade: 'F', label: '百合向中的男性亲密接触欺诈', keywords: ['fraud_male_intimacy'], requiresHumanReview: true },
  { code: 'F-MALE-NTR', grade: 'F', label: '男性 NTR', keywords: ['male_ntr'], requiresHumanReview: true },
  { code: 'F-YURI-BAIT', grade: 'F', label: '官方百合欺诈', keywords: ['yuri_bait'], requiresHumanReview: true },
  { code: 'F-SETTING-BAIT', grade: 'F', label: '设定欺诈', keywords: ['setting_bait'], requiresHumanReview: true },
  { code: 'F-PROJECT-CONTAMINATION', grade: 'F', label: '企划继承污染', keywords: ['project_contamination'], requiresHumanReview: true },
  { code: 'F-CREATOR-HIGH-RISK-SPEECH', grade: 'F', label: '创作者发表高危言论', keywords: ['creator_high_risk_speech'], requiresHumanReview: true },

  { code: 'X-PREPAID-FRAUD', grade: 'X', label: '预付费 / 众筹 / 付费作品百合欺诈', keywords: ['prepaid_fraud'], requiresHumanReview: true, doNotAutoPublish: true },
  { code: 'X-REPEATED-BAIT', grade: 'X', label: '官方或创作者反复误导', keywords: ['repeated_bait'], requiresHumanReview: true, doNotAutoPublish: true },
  { code: 'X-MALICIOUS-CREATOR', grade: 'X', label: '创作者明确创作大量恶意作品，并且发表恶意言论', keywords: ['malicious_creator', 'creator_malicious_works_and_speech'], requiresHumanReview: true, doNotAutoPublish: true },
  { code: 'X-SPECIAL', grade: 'X', label: '其他严重黑名单情况', keywords: ['special_x'], requiresHumanReview: true, doNotAutoPublish: true },
]

export const RADAR_RULE_BY_CODE = Object.fromEntries(RADAR_RULES.map((rule) => [rule.code, rule]))
export const GRADE_PRIORITY = Object.fromEntries(GRADE_ORDER.map((grade, index) => [grade, index]))

export const RADAR_POLICY_SAFETY = {
  doNotOverwriteHumanVerified: true,
  severeRatingsRemainPublic: true,
  doNotAutoAssignX: true,
  preserveConflictingEvidence: true,
  storePolicyVersion: true,
  autoSuggestionsAreNotFinalPublicRatings: true,
  reviewNoticeUsesPageTemplates: true,
}

export function assertRadarPolicy() {
  const codes = new Set()
  for (const rule of RADAR_RULES) {
    if (!GRADE_ORDER.includes(rule.grade)) throw new Error(`Invalid radar grade for ${rule.code}: ${rule.grade}`)
    if (codes.has(rule.code)) throw new Error(`Duplicate radar rule code: ${rule.code}`)
    codes.add(rule.code)
  }
  if (RADAR_RULES.length !== 55) throw new Error(`Expected 55 radar rules, received ${RADAR_RULES.length}`)
  return true
}

assertRadarPolicy()
