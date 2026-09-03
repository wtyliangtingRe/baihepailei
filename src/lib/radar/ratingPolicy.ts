export const RADAR_RATING_POLICY_ID = 'radar-rating-policy-v0.6' as const
export const RADAR_CLASS_REGISTRY_ID = 'global-rating-class-registry-v01.1+owner-extension-01' as const
export const RADAR_POLICY_BUNDLE_ID = 'radar-policy-bundle-v0.6-current-release' as const

export type RadarGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'X'

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
  D: '非核心百合 / 明显边界',
  E: '重度排雷',
  F: '高危排雷',
  X: '严重欺诈 / 黑名单',
}

export const radarGradeSummaries: Record<RadarGrade, string> = {
  S: '中心女性之间的恋爱关系或长期承诺已经由直接证据明确建立；具体警示仍单独列出。',
  A: '女性恋爱方向高度明确，但可能仍处于连载、开放结局或接近确立阶段。',
  B: '已有肯定的百合定位或关系基础，同时存在轻度条件、关系体验或交付风险。',
  C: '百合相关性存在，但更偏向友情以上、配角关系、群像或可规避的路线边界。',
  D: '作品不是稳定的核心百合体验，或存在一般向、旁支、未来异性走向与特定设定边界。',
  E: '已确认会显著影响百合观看体验的男性关系、路线污染、定位否认或高风险设定。',
  F: '已确认结局级、核心级或欺诈级风险；阅读或购买前应先查看具体警示。',
  X: '只由人工裁决的最高风险层；当前公开快照不自动生成 X。',
}

export type RadarClassDefinition = {
  grade: RadarGrade
  label: string
  summary: string
  inclusionCriteria: readonly string[]
  exclusionCriteria: readonly string[]
  interpretationNotes: readonly string[]
  tags: readonly string[]
  requiresHumanReview: boolean
  doNotAutoPublish: boolean
}

export const radarClassDefinitions = {
  "S-RELATIONSHIP": {
    "grade": "S",
    "label": "中心双向女性恋爱关系已确立",
    "summary": "中心女性参与者之间的双向恋爱关系已经由直接、具体且与目标作品身份一致的证据明确建立。",
    "inclusionCriteria": [
      "存在双方恋爱情感或等价关系确立的肯定证据",
      "关系属于作品中心关系或核心关系之一",
      "关系不是仅由类型标签或读者推测得出"
    ],
    "exclusionCriteria": [
      "单方面爱慕",
      "普通友情或友情以上但未能确认恋爱",
      "只有“百合/GL”类型标签而无关系级证据",
      "仅凭结局未出现男性进行反推"
    ],
    "interpretationNotes": [
      "本类别描述关系事实，不自行保证完美结局或绝对无风险。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "S-MARRIAGE": {
    "grade": "S",
    "label": "女性—女性婚姻或等价长期承诺",
    "summary": "中心女性参与者之间存在婚姻，或在作品语境中具有实质等价意义的长期稳定承诺。",
    "inclusionCriteria": [
      "婚姻由正文、官方材料或等价高质量证据明确支持",
      "若非法律婚姻，必须能证明承诺具有长期、稳定且双方共同确认的性质"
    ],
    "exclusionCriteria": [
      "仅确立恋爱关系",
      "单方面求婚但未获回应",
      "模糊同居或关系亲密但无长期承诺证据"
    ],
    "interpretationNotes": [
      "婚姻/长期承诺可与其他风险类别并存；低等级拦截原则仍适用。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "A-ONGOING": {
    "grade": "A",
    "label": "连载中强女性恋爱轨迹",
    "summary": "作品仍未完结，但当前已观察内容中存在直接、持续且高度明确的女性—女性恋爱发展；保留风险主要来自终局尚不可观察，而非关系证据薄弱。",
    "inclusionCriteria": [
      "releaseStatus 为 ongoing",
      "已存在足以支持强女性恋爱轨迹的直接关系证据",
      "当前没有已确认的更低等级拦截事实"
    ],
    "exclusionCriteria": [
      "仅因作品处于 ongoing 状态",
      "仅凭百合类型标签",
      "关系事实仍高度模糊",
      "存在已确认的更低等级拦截事实"
    ],
    "interpretationNotes": [
      "ongoing 本身不是评级证据；本类别要求 ongoing 与强关系事实同时成立。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "A-OPEN-END": {
    "grade": "A",
    "label": "开放结局中的强双向女性恋爱",
    "summary": "作品在终局有意保留关系名分、形式或未来细节的开放性，但双方女性恋爱情感和关系方向已经由肯定证据充分建立。",
    "inclusionCriteria": [
      "双向女性恋爱关系有直接证据",
      "开放性来自作者有意留白或未正式命名，而不是调查不足",
      "开放结局没有已确认的更低等级终局事实"
    ],
    "exclusionCriteria": [
      "因证据不足而不知道结局",
      "单方面爱慕",
      "开放结局中实际存在男性终局或其他更低等级拦截"
    ],
    "interpretationNotes": [
      "“开放”不等于“未知”；必须能证明开放是作品本身的结局性质。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "A-YURI-HAREM": {
    "grade": "A",
    "label": "多女性百合后宫/多向恋爱结构",
    "summary": "大量女性角色之间形成明确的恋爱、求爱、可选择或多向关系结构，主要恋爱选择和关系可能均处于女性—女性范围；不要求单一女性处于结构中心。",
    "inclusionCriteria": [
      "存在多个女性角色之间的明确恋爱/求爱或可选择关系",
      "主要恋爱选择不包含男性恋爱路线或男性终局",
      "关系结构由作品具体内容而非角色数量支持"
    ],
    "exclusionCriteria": [
      "只是女性角色很多",
      "只有友情群像",
      "存在实质男性恋爱选择却试图用“后宫”掩盖",
      "无法确认主要关系选择的性别范围"
    ],
    "interpretationNotes": [
      "本类别不要求一个固定女性中心；允许多中心、网状或群体式恋爱结构。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "A-NEAR-CONFIRMED": {
    "grade": "A",
    "label": "接近确立的双向女性恋爱",
    "summary": "女性双方的恋爱情感与关系发展已非常接近正式确立，具有直接的互相恋爱证据，但尚缺少最后的明确关系确认或等价承诺。",
    "inclusionCriteria": [
      "双方恋爱情感都有肯定证据",
      "关系轨迹明确朝向确立",
      "尚缺少正式关系确认或更强承诺"
    ],
    "exclusionCriteria": [
      "单方面爱慕",
      "只有高强度友情",
      "仅凭观众期待推断",
      "存在决定性相反关系事实"
    ],
    "interpretationNotes": [
      "与 S 的边界在于关系是否已经明确确立，而不是“喜欢程度”。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "B-LIGHT": {
    "grade": "B",
    "label": "已确认百合定位基线",
    "summary": "目标作品已被肯定证据确认为百合、GL、女性—女性恋爱或等价定位，但当前关系状态、终局、排他性等信息不足以支持 S/A，也没有已确认的更低等级拦截事实。",
    "inclusionCriteria": [
      "存在 exact-work 的肯定百合/女性恋爱依据",
      "至少有可追溯来源与事实支持",
      "当前收集证据中没有已确认的 D/E/F/X 拦截事实"
    ],
    "exclusionCriteria": [
      "仅凭标题熟悉度或模型记忆",
      "一般目录标签且无具体百合依据",
      "因为没查到问题就假定安全",
      "存在已确认更低等级触发"
    ],
    "interpretationNotes": [
      "缺失风险证据只是弱佐证；不代表安全结局、排他性或不存在男性介入。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "B-MALE-NOISE": {
    "grade": "B",
    "label": "受限的男性邻接关系噪声",
    "summary": "作品核心女性—女性关系原则上足以达到 S 或 A，但核心关系外围存在范围明确、影响有限的男性相关恋爱或暧昧关系，并通过配角、学妹、亲属等旁支节点与核心女性角色轻微交叠，造成可感知但未形成实质污染的男性相关噪声。",
    "inclusionCriteria": [
      "不考虑该例外时核心女性关系原则上足以达到 S 或 A",
      "男性相关关系被肯定证据限制在外围关系节点",
      "男性不是核心女性任一方的真实恋爱路线、替代对象或终局对象",
      "交叠影响轻微、局部且可界定",
      "有肯定性的边界证据说明为何风险被限制"
    ],
    "exclusionCriteria": [
      "只因为存在男性角色",
      "只因为暂时没查到男性恋爱",
      "男性直接与核心女主形成真实恋爱可能",
      "男性亲密、男性替代、男性 NTR 或不可分离路线",
      "边界无法可靠确认"
    ],
    "interpretationNotes": [
      "这是窄例外，不得作为“有男性但没发现问题”的默认洗白类别。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "B-CRITIQUE-RADAR": {
    "grade": "B",
    "label": "批判性描写雷点的特殊降级",
    "summary": "作品本应凭中心女性关系事实达到 S 或 A，但为了批判、否定、反思或严肃处理某类雷点而实际描写相关内容；这些内容仍被如实记录，但在确认其叙事功能和边界后允许以特殊机制降至 B。",
    "inclusionCriteria": [
      "作品在不考虑该描写时原则上满足 S 或 A 之一",
      "雷点内容确实存在并被证据记录",
      "有充分上下文证明作品在批判、否定、反思或严肃处理该内容",
      "该描写没有实际转化为更严重的中心关系结果"
    ],
    "exclusionCriteria": [
      "只声称“作者本意是批判”但缺乏上下文",
      "作品未达到 S/A 关系基础",
      "实际发生 E/F/X 级结果却试图以批判意图免责",
      "仅因作品严肃或文学性强"
    ],
    "interpretationNotes": [
      "本类别是特殊宽容/降级机制，不删除雷点事实，也不使更严重的实际结果失效。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "B-POWER-IMBALANCE": {
    "grade": "B",
    "label": "中心女性关系中的定向恶劣对待",
    "summary": "中心女性角色对另一名具有重要关系地位的女性角色存在持续、明确且明显伤害体验的敌意、羞辱、利用、排斥、抛弃或类似恶劣关系处理，使原本较高等级的女性关系体验明显受损。",
    "inclusionCriteria": [
      "行为针对重要女性关系对象",
      "不适来自具体剧情中的持续或实质性恶劣对待",
      "行为影响关系体验但尚未触发更严重的强迫、男性介入、NTR 等类别"
    ],
    "exclusionCriteria": [
      "普通争吵",
      "短暂误会",
      "合理的剧情对立而无持续恶劣关系处理",
      "泛化的“权力不平衡”但没有具体伤害性行为"
    ],
    "interpretationNotes": [
      "本类别评价作品交付的关系体验，不对角色人格作永久道德定性。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "B-FEMALE-NTR": {
    "grade": "B",
    "label": "女性第三方置换/NTR",
    "summary": "已经建立或具有明确关系期待的女性—女性关系中，关系置换、出轨或 NTR 风险由女性第三方产生，而非男性介入。",
    "inclusionCriteria": [
      "存在可验证的关系结构与时间线",
      "第三方为女性且对既有女性关系造成真实置换或背叛风险",
      "没有更严重的男性介入类事实替代本类"
    ],
    "exclusionCriteria": [
      "普通女性三角恋但没有既有关系被置换",
      "仅凭 NTR 标签",
      "男性第三方介入",
      "没有时间线/关系结构证据"
    ],
    "interpretationNotes": [
      "NTR/置换必须以具体关系结构证明，不能由关键词自动匹配。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "B-UNFINISHED-CREATOR-RISK": {
    "grade": "B",
    "label": "连载中创作者交付可靠性风险",
    "summary": "仅适用于仍在连载中的作品：负责后续主要内容或交付的创作者/机构存在经验证、与当前项目持续完成具有实质相关性的未完结、弃坑或交付可靠性历史，因此对尚不可观察的终局采取较保守评价。",
    "inclusionCriteria": [
      "releaseStatus 为 ongoing",
      "存在经过验证的 EntityRiskPattern",
      "相关 Entity 通过 WorkCreditRelation 对本作完成/叙事交付具有实际影响能力",
      "风险维度与历史模式匹配"
    ],
    "exclusionCriteria": [
      "作品已 completed",
      "一般风评或匿名传闻",
      "与当前 Entity 职责无关的历史",
      "据此声称本作已经弃坑或已经发生历史事件"
    ],
    "interpretationNotes": [
      "这是 contextual risk，不是 Work factual Claim；完结后不得继续单独影响最终评级。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "C-FRIENDSHIP": {
    "grade": "C",
    "label": "超出普通友情但未确认恋爱的女性关系",
    "summary": "女性角色之间的关系明显超出普通友情语境，但现有肯定证据仍不足以确认双方建立真实恋爱关系。",
    "inclusionCriteria": [
      "存在超出普通友情的肯定关系信号",
      "关系仍缺乏足够的双向恋爱或正式确立证据"
    ],
    "exclusionCriteria": [
      "只是关系亲密",
      "仅凭观众嗑 CP",
      "证据不足本身",
      "已经确认恋爱关系"
    ],
    "interpretationNotes": [
      "本类别不能作为“什么都没查清”的回退。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "C-SIDE-CP": {
    "grade": "C",
    "label": "配角层面的高强度女性—女性 CP",
    "summary": "作品的次要角色或旁支 CP 本身若独立评价，关系强度至少满足 S 或 A 体系中的一种，但该 CP 并非作品中心关系，因此整体按配角权重处理。",
    "inclusionCriteria": [
      "CP 位于次要角色或旁支叙事",
      "CP 自身具备至少 S/A 级别的关系证据",
      "作品整体中心不以该 CP 为主"
    ],
    "exclusionCriteria": [
      "配角之间仅暧昧或友情",
      "只有单方面爱慕",
      "实际上是作品核心 CP",
      "没有足够关系级证据"
    ],
    "interpretationNotes": [
      "这是“关系强度高但叙事权重低”，不是用 C 放松 CP 本身的证据要求。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "C-CONTEXT-RISK": {
    "grade": "C",
    "label": "系列中高度独立的百合单作",
    "summary": "目标作品名义上属于某系列或企划，系列其他作品存在非百合或风险背景，但当前作品在剧情、尤其时间线上与其他作品几乎没有实质继承，独立性高到风险传播只能非常有限。",
    "inclusionCriteria": [
      "存在可验证的 series/project 关系",
      "当前作品自身百合内容成立",
      "叙事连续性与时间线连续性均为 none/weak 或等价低连续状态",
      "没有必须理解其他风险作品才能成立的核心剧情继承"
    ],
    "exclusionCriteria": [
      "只是换了主角但时间线/剧情强继承",
      "直接续作或前传",
      "相关风险作品的剧情结果会实质进入当前作品",
      "仅凭用户感觉“像独立作”而无连续性证据"
    ],
    "interpretationNotes": [
      "与 related_project_yuri_trust_contamination 相对；传播必须 reasoned, not contagious。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "C-FANWORK-NON-INHERITED": {
    "grade": "C",
    "label": "高分歧百合二创的原作风险不继承",
    "summary": "仅适用于二次创作：二创自身建立足够明确的女性—女性关系，并且其世界观、剧情或时间线与原作差异大到不能合理把原作的非百合/雷点直接继承给该二创。",
    "inclusionCriteria": [
      "作品被确认是 fanwork/二次创作",
      "二创自身有独立且充分的百合关系证据",
      "与原作存在高剧情/时间线分歧，原作风险不构成当前二创事实"
    ],
    "exclusionCriteria": [
      "官方正统续作/改编而非二创",
      "只是同人但完全复述原作关系结构",
      "原作雷点在二创中被实际继承",
      "仅因创作者善意而忽略实际继承"
    ],
    "interpretationNotes": [
      "“无恶意”可作为解释背景，但分类必须以作品结构与实际继承关系为依据。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "C-MALE-MAIN-CAST": {
    "grade": "C",
    "label": "群像作品中的男性主要角色",
    "summary": "仅适用于群像作品：群像主要角色中包含男性，同时存在明确女性—女性内容；男性主要角色的存在本身不自动等于男性恋爱，但会降低对核心百合专一性的判断。",
    "inclusionCriteria": [
      "作品为可验证的 ensemble/群像结构",
      "男性属于主要角色群",
      "女性—女性内容有肯定证据"
    ],
    "exclusionCriteria": [
      "普通男女双主角结构",
      "男性只是路人或功能性配角",
      "没有群像结构证据",
      "男性实际成为核心女性的恋爱路线但试图使用本类"
    ],
    "interpretationNotes": [
      "本类是群像结构限定，不是男性主角的一般豁免。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "C-STRAIGHT-GIRL-HINT": {
    "grade": "C",
    "label": "女性角色异性恋取向信号",
    "summary": "对中心或重要女性角色存在具体、肯定的异性恋取向、男性偏好或“直女”相关信号，但尚未形成更强的男性恋爱关系、路线或终局事实。",
    "inclusionCriteria": [
      "信号来自目标作品中的具体文本/情节/官方设定",
      "信号与重要女性角色直接相关"
    ],
    "exclusionCriteria": [
      "仅凭过去有男性朋友",
      "仅凭性别刻板推断",
      "已经形成既定男性恋爱关系",
      "只有匿名观众推测"
    ],
    "interpretationNotes": [
      "若同时存在女性恋爱事实，应分别记录，不能互相抹除。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "D-GENERAL": {
    "grade": "D",
    "label": "一般向作品但保留百合相关收录",
    "summary": "作品整体属于一般向、非核心百合，或当前只能确认其百合相关性有限；之所以保留在数据库，是因为存在有来源的历史收录、用户判断、营销分类或其他百合相关信号，目的是帮助用户而非批判作品。",
    "inclusionCriteria": [
      "有肯定证据说明作品属于一般向/非核心百合或百合权重很低",
      "存在可追溯的百合相关收录/讨论/信号，足以解释为何进入数据库"
    ],
    "exclusionCriteria": [
      "因为完全没查清所以机械给 D",
      "没有任何来源解释为何作品与百合用户有关",
      "将“不是百合”视为作品质量或作者道德问题"
    ],
    "interpretationNotes": [
      "本类别不构成负面道德评价；数据库是百合用户决策情报库，不是只有纯百合作品才能存在的白名单。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "D-SIDE-YURI": {
    "grade": "D",
    "label": "极次要旁支百合内容",
    "summary": "百合内容真实存在，但篇幅、角色位置或叙事权重明显处于极次要旁支，整体作品不以该女性—女性关系为主要内容。",
    "inclusionCriteria": [
      "存在肯定的女性—女性恋爱/百合内容",
      "该内容叙事权重显著低于作品主线"
    ],
    "exclusionCriteria": [
      "核心或重要次要 CP 已达到 C-SIDE-CP 的高关系强度且权重足够",
      "只靠读者想象",
      "完全不存在百合内容"
    ],
    "interpretationNotes": [
      "与 secondary_established_female_female_pairing 的主要差异是整体叙事权重与关系强度要求。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "C-MULTI-ENDING": {
    "grade": "C",
    "label": "可可靠规避的多路线非百合结局",
    "summary": "作品存在非百合路线或结局，但这些路线能够被可靠识别、可靠规避，且不会把男性/非百合结果强制带入目标女性—女性路线；新 Policy 对此类情况提升到 C，但使用必须谨慎。",
    "inclusionCriteria": [
      "存在多个可区分路线/结局",
      "百合路线能够独立完成且非百合路线可可靠规避",
      "路线选择机制和结局边界有具体证据"
    ],
    "exclusionCriteria": [
      "路线彼此强制交叉",
      "男性路线内容不可规避地污染百合路线",
      "无法确认路线选择机制",
      "仅凭攻略传闻"
    ],
    "interpretationNotes": [
      "stable class 不编码 Grade；owner-approved v0.6 binding 将本类别从历史 D 提升到 C。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "D-MINOR-TRASH": {
    "grade": "D",
    "label": "轻微且非实质性的低水平剧情侵入",
    "summary": "为了强行推进剧情而出现的低水平俗套、突兀冒犯、轻微性骚扰式桥段或类似“小巧思”，确实会让用户不适，但影响局部、非决定性，且没有足够依据认为其意图是破坏百合关系。",
    "inclusionCriteria": [
      "存在具体令人不适的局部剧情事实",
      "影响短暂/局部且不决定中心关系或终局",
      "不存在更严重的 E/F 类事实"
    ],
    "exclusionCriteria": [
      "持续或核心的男性亲密",
      "强迫/NTR/终局污染",
      "用“作者能力不足”替严重事实免责",
      "仅因个人不喜欢某桥段"
    ],
    "interpretationNotes": [
      "意图不要求证明；本类仅表示观察到的实际影响较小。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "D-SIDE-SEVERE-RADAR": {
    "grade": "D",
    "label": "旁支轻度雷点",
    "summary": "作品存在轻度、旁支、局部且不会实质改变核心女性关系的雷点；只允许平复不严重风险，严重雷点不能因为发生在配角或旁支就被降轻。",
    "inclusionCriteria": [
      "雷点事实已确认",
      "影响对象/篇幅/叙事位置明确处于旁支",
      "风险本身不达到严重关系破坏或终局级别"
    ],
    "exclusionCriteria": [
      "E/F/X 级严重事实",
      "主角/核心关系中的实质雷点",
      "仅因篇幅少就淡化严重事件"
    ],
    "interpretationNotes": [
      "旧名中的 SEVERE 不再作为语义；本类别明确只处理 minor side-context risk。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "D-FUTURE-HET-HINT": {
    "grade": "D",
    "label": "未来异性恋走向的肯定信号",
    "summary": "存在具体剧情、路线、官方设定或机制支持未来男性恋爱/异性恋走向的可能，但尚未形成既定男性关系或终局事实。",
    "inclusionCriteria": [
      "存在 exact-work 的肯定未来走向信号",
      "信号与重要女性角色或路线直接相关"
    ],
    "exclusionCriteria": [
      "纯粹“未来也说不定”",
      "作者一般历史但没有本作信号",
      "已经形成男性恋爱关系或终局"
    ],
    "interpretationNotes": [
      "必须区分具体未来信号与未知风险。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "E-MALE-INTIMACY": {
    "grade": "E",
    "label": "男性亲密存在但未达核心/终局",
    "summary": "核心相关女性角色与男性存在真实、肯定的亲密或恋爱接触，但尚未达到核心、强制、决定性终局或实质欺诈级别。",
    "inclusionCriteria": [
      "有具体男性亲密/恋爱行为证据",
      "行为与重要女性角色直接相关",
      "严重度未达到 F 级核心/强制/终局"
    ],
    "exclusionCriteria": [
      "普通友情",
      "功能性接触",
      "仅男性存在",
      "已经是核心/强制/终局男性关系"
    ],
    "interpretationNotes": [
      "与 male_intimacy_core_forced_or_terminal 按事实严重度区分，而不是按同一事实随意换 Grade。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "E-PAST-MALE-ROMANCE": {
    "grade": "E",
    "label": "既往男性恋爱关系",
    "summary": "作品中的核心女性参与者在当前女性—女性关系之前存在有可靠证据支持的真实男性恋爱关系、前男友关系或具有明确恋爱情感的既往男性关系。",
    "inclusionCriteria": [
      "具体、肯定且可归因的既往男性恋爱证据",
      "关系属于目标作品对应角色",
      "证据足以支持恋爱或等价亲密关系"
    ],
    "exclusionCriteria": [
      "普通男性友谊",
      "单纯认识男性",
      "角色名字/性别推测",
      "匿名传闻",
      "仅因没查清而猜测"
    ],
    "interpretationNotes": [
      "本类别只描述过去男性恋爱事实；当前 Grade 由 Policy binding 决定。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "E-MALE-SUBSTITUTE": {
    "grade": "E",
    "label": "男性浪漫投射/替代",
    "summary": "核心女性角色对男性对象存在持续、强烈且具有恋爱情感性质的追逐、幻想或沉迷，足以实质影响百合体验；既包括男性替代关系，也包括疯狂追男性明星、沉迷乙女游戏男性对象等明确男性浪漫投射。",
    "inclusionCriteria": [
      "存在持续或高强度的男性浪漫投射/追逐",
      "对象可以是真实男性、男性明星或明确男性恋爱幻想对象",
      "影响达到足以改变百合关系体验的程度"
    ],
    "exclusionCriteria": [
      "普通追星且无恋爱情感",
      "一般娱乐性玩乙女游戏",
      "轻微男性好感",
      "仅凭用户联想认定替代"
    ],
    "interpretationNotes": [
      "重点是明确男性浪漫投入及其对百合体验的实质影响，不要求形成现实男性恋爱关系。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "E-STRAIGHT-UNREQUITED": {
    "grade": "E",
    "label": "对明确异性恋女性的无果女性恋爱",
    "summary": "女性对女性存在真实恋爱情感，但另一方被可靠建立为异性恋取向或明确只选择男性，且女性恋爱没有形成互相关系。",
    "inclusionCriteria": [
      "一方女性恋爱情感成立",
      "另一方异性恋/只选择男性的事实有具体证据",
      "关系最终没有形成双向女性恋爱"
    ],
    "exclusionCriteria": [
      "只是关系暂未确认",
      "对方取向未知",
      "双方实际建立恋爱关系",
      "仅凭刻板印象判断“直女”"
    ],
    "interpretationNotes": [
      "如果后续事实改变，应由新 Claim/Assessment 取代旧结论。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "E-MALE-POSSIBILITY": {
    "grade": "E",
    "label": "实质男性恋爱路线可能",
    "summary": "作品的路线、机制、剧情结构或官方说明使中心女性角色具有真实、可操作或实质性的男性恋爱可能性。",
    "inclusionCriteria": [
      "存在具体路线/机制/剧情结构证据",
      "男性恋爱可能与中心女性角色直接相关",
      "可能性不是纯粹抽象未来猜测"
    ],
    "exclusionCriteria": [
      "只存在男性角色",
      "未来未知",
      "没有可验证路线或机制",
      "男性仅为不可恋爱功能角色"
    ],
    "interpretationNotes": [
      "与 affirmative_future_heterosexual_trajectory_signal 的区别在于本类已形成实质可进入的男性恋爱可能。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "E-ROUTE-CONTAMINATION": {
    "grade": "E",
    "label": "不可分离的非百合路线污染",
    "summary": "非百合/男性路线无法与目标女性—女性体验清晰分离，或必须经历、继承、承受其关键结果，从而实质污染核心百合路线。",
    "inclusionCriteria": [
      "存在非百合路线/结果",
      "路线之间存在不可规避的实质交叉或继承",
      "污染直接影响目标女性关系体验"
    ],
    "exclusionCriteria": [
      "非百合路线可可靠识别并规避",
      "完全独立的外传/二创",
      "只是同系列名义关联"
    ],
    "interpretationNotes": [
      "与 separable_multi_route_non_yuri_endings 构成明确的可分离/不可分离边界。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "E-BL-HEAVY": {
    "grade": "E",
    "label": "高权重 BL 内容挤压",
    "summary": "男性—男性恋爱内容占据足够重要的篇幅、角色权重或叙事功能，明显挤压、改变或干扰用户所期待的女性—女性核心体验。",
    "inclusionCriteria": [
      "BL 内容有肯定事实依据",
      "其叙事权重达到实质挤压或改变百合体验的程度"
    ],
    "exclusionCriteria": [
      "仅有男性角色友情",
      "少量无关 BL 玩笑",
      "BL 仅存在于完全独立且不影响当前作品的外部材料"
    ],
    "interpretationNotes": [
      "评价内容权重与体验影响，不对 BL 题材本身作质量或道德判断。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "E-OFFICIAL-DENIAL": {
    "grade": "E",
    "label": "官方对 exact Work 的百合定位否认",
    "summary": "针对目标作品的官方、创作者或项目权威声明明确否认其百合/女性恋爱定位，且声明身份、上下文和 exact-work 关联均可验证。",
    "inclusionCriteria": [
      "statementScope 为 exact_work",
      "说话主体具有可验证的创作/项目权威",
      "声明明确否认或实质否定本作百合定位"
    ],
    "exclusionCriteria": [
      "泛 LGBT+ 言论",
      "对其他作品的说法",
      "作者一般偏好",
      "被截断或上下文无法确认的片段"
    ],
    "interpretationNotes": [
      "这是 exact-work statement，可成为 Work Research 的来源；不是 Creator reputation 传播。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "E-TOKEN-YURI": {
    "grade": "E",
    "label": "非百合作品中的点缀性百合",
    "summary": "女性—女性元素确实存在，但主要作为点缀、象征、配角素材、营销元素或少量服务使用，作品整体并非以女性恋爱为主要关系内容。",
    "inclusionCriteria": [
      "存在真实女性—女性内容",
      "其功能/权重明显为 token/点缀而非核心关系",
      "作品整体关系结构非百合中心"
    ],
    "exclusionCriteria": [
      "一般向作品但有实质可独立成立的高强度配角 CP",
      "核心女性关系",
      "完全没有百合内容"
    ],
    "interpretationNotes": [
      "与 general_work_with_unresolved_yuri_relevance 的区别是本类已确认存在 token 性质的百合内容。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "E-SETTING-MISREPRESENTATION": {
    "grade": "E",
    "label": "设定相关的百合宣传误导",
    "summary": "作品或项目以百合/女性恋爱为实质卖点，但对 TS、扶她、身份边界等与用户判断高度相关的设定事实进行重大误导、隐瞒或与宣传相矛盾的交付，从而形成设定相关的百合宣传失实。",
    "inclusionCriteria": [
      "存在具体百合宣传/承诺",
      "存在与 setting/身份事实有关的重大宣传—交付矛盾",
      "矛盾足以实质影响用户判断"
    ],
    "exclusionCriteria": [
      "如实披露的 TS/扶她/男娘设定本身",
      "ABO 仅因设定存在（由独立 class 处理）",
      "用户单纯不喜欢设定处理方式",
      "没有宣传承诺证据"
    ],
    "interpretationNotes": [
      "本类核心是 misrepresentation，不是设定本身。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "E-CREATOR-MALICIOUS-HISTORY": {
    "grade": "E",
    "label": "连载中创作者重大历史风险",
    "summary": "仅适用于仍在连载中的作品：负责未来主要内容方向的创作者/机构存在经过验证、与当前作品后续关系走向实质相关的重大历史风险模式，因此在终局尚不可观察时采取更保守评价。",
    "inclusionCriteria": [
      "releaseStatus 为 ongoing",
      "存在已验证的高实质 EntityRiskPattern",
      "Entity 对本作相关风险维度具有实际影响能力",
      "历史模式与本作未来风险维度匹配"
    ],
    "exclusionCriteria": [
      "作品已 completed",
      "一般风评、政治观点或泛 LGBT+ 言论",
      "与本作职责无关的 Entity",
      "据此声称本作已发生历史事件"
    ],
    "interpretationNotes": [
      "intent 不必证明；风险依据来自可观察历史行为/模式。该信号不得伪装成 Work factual Claim。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "F-HET-END": {
    "grade": "F",
    "label": "异性恋终局",
    "summary": "作品的权威完结状态或终局明确让中心女性角色进入男性恋爱、婚姻或等价异性恋终局，并实质取代目标女性关系。",
    "inclusionCriteria": [
      "存在完成态或终局级具体证据",
      "男性终局与中心女性角色直接相关",
      "结果具有决定性"
    ],
    "exclusionCriteria": [
      "未来可能性",
      "开放结局",
      "非中心配角男性结局",
      "未经确认的攻略/传闻"
    ],
    "interpretationNotes": [
      "终局证据门槛应高于一般情节推断。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "F-MALE-INTIMACY": {
    "grade": "F",
    "label": "核心/强制/终局男性亲密",
    "summary": "男性亲密或恋爱成为核心关系、强制路线、决定性剧情或终局事实，并实质改变中心女性—女性关系体验。",
    "inclusionCriteria": [
      "男性亲密事实明确",
      "具有核心、强制、决定性或终局性质"
    ],
    "exclusionCriteria": [
      "局部非决定性男性亲密",
      "普通男性友情",
      "外围男性关系噪声"
    ],
    "interpretationNotes": [
      "与 male_intimacy_present_nonterminal 按事实严重度严格区分。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "F-MALE-NTR": {
    "grade": "F",
    "label": "男性 NTR/男性关系背叛",
    "summary": "已建立或明确期待的女性—女性关系中出现由男性导致的 NTR、出轨、恋爱置换或等价背叛。",
    "inclusionCriteria": [
      "既有女性关系/明确关系期待可证明",
      "男性第三方的恋爱/亲密介入可证明",
      "关系置换或背叛时间线可证明"
    ],
    "exclusionCriteria": [
      "关键词或匿名社区标签",
      "没有既有关系结构",
      "女性第三方置换",
      "普通男性角色互动"
    ],
    "interpretationNotes": [
      "必须证明关系结构和时间线。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "F-YURI-BAIT": {
    "grade": "F",
    "label": "实质百合欺诈/诱饵",
    "summary": "官方或授权主体制造了足以形成实质百合期待的具体承诺、定位或宣传，而实际交付与其存在重大矛盾，达到当前 Policy 的 material bait 门槛。",
    "inclusionCriteria": [
      "有可验证的百合承诺/宣传",
      "承诺足以实质影响合理用户期待",
      "实际交付与承诺存在重大矛盾",
      "exact project relevance 成立"
    ],
    "exclusionCriteria": [
      "用户单纯不喜欢结局",
      "模糊宣传而未形成实质承诺",
      "只有社区误解",
      "没有证明宣传—交付矛盾"
    ],
    "interpretationNotes": [
      "bait 必须证明 represented expectation + contradictory delivery。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "F-SETTING-BAIT": {
    "grade": "F",
    "label": "实质设定欺诈/诱饵",
    "summary": "项目对特定 setting/profile 作出足以影响用户选择的实质承诺，而实际交付与该承诺发生重大矛盾，达到高风险诱饵门槛。",
    "inclusionCriteria": [
      "setting 承诺具体且可归因",
      "承诺影响用户选择",
      "实际交付与承诺有重大矛盾"
    ],
    "exclusionCriteria": [
      "如实披露但用户不喜欢",
      "普通设定变化",
      "没有可验证承诺",
      "ABO 仅因设定存在"
    ],
    "interpretationNotes": [
      "与 setting_based_yuri_misrepresentation 可共存；F 要求更高的 material bait 门槛。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "F-PROJECT-CONTAMINATION": {
    "grade": "F",
    "label": "关联企划的百合信任污染",
    "summary": "目标作品与其他 Work 存在实质、可验证的系列/企划连续性，而至少一个相关 Work 已独立证明发生重大百合欺诈或严重背离；这种连续性足以合理损害用户对当前企划的信任。",
    "inclusionCriteria": [
      "存在 verified WorkRelation 与 ProjectContinuityProfile",
      "continuityClass 为 materially_related 或 strongly_continuous",
      "至少一个相关 Work 独立确认 material bait/fraud",
      "污染传播有明确 reasoned path"
    ],
    "exclusionCriteria": [
      "仅共同作者/公司",
      "只有品牌名相同而剧情时间线高度独立",
      "相关 Work 风险未独立证明",
      "当前 Work 达到 isolated_entry 应使用 C 类而非 F"
    ],
    "interpretationNotes": [
      "与 series_isolated_yuri_entry 相对；不得无脑同系列连坐。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "F-CREATOR-EXACT-WORK-STATEMENT": {
    "grade": "F",
    "label": "创作者针对 exact Work 的高风险声明",
    "summary": "创作者、制作方或其他具有直接项目权威的 Entity 针对 exact Work 作出可验证声明，该声明直接支持高风险路线、结局、定位否定或创作意图。",
    "inclusionCriteria": [
      "statementScope 为 exact_work",
      "说话主体对本作具有可验证的创作/项目权威",
      "声明内容直接支持 F 级风险事实或高风险创作方向"
    ],
    "exclusionCriteria": [
      "泛政治言论",
      "泛 LGBT+ 言论",
      "对其他作品的发言",
      "只有作者历史而没有本作指向",
      "断章取义或来源不明"
    ],
    "interpretationNotes": [
      "这是 Work Evidence 路径，不是 Entity contextual risk。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "X-PREPAID-FRAUD": {
    "grade": "X",
    "label": "预付费百合重大欺诈",
    "summary": "用户在预购、众筹、付费承诺或类似经济决定前收到具有项目权威的明确百合承诺，而最终交付与其存在严重实质矛盾，并达到欺诈/预付费损害门槛。",
    "inclusionCriteria": [
      "存在经济承诺前的明确百合宣传/承诺",
      "承诺主体具有项目权威",
      "最终交付与承诺严重矛盾",
      "付费决策相关性明确",
      "达到 X 的人工裁定门槛"
    ],
    "exclusionCriteria": [
      "用户不满意但没有明确承诺",
      "免费内容普通创作方向变化",
      "无支付/预付关系",
      "缺少宣传—交付证据链"
    ],
    "interpretationNotes": [
      "X 继续保持 Human adjudication；不由模型仅凭不满自动分配。"
    ],
    "tags": [],
    "requiresHumanReview": true,
    "doNotAutoPublish": true
  },
  "X-REPEATED-BAIT": {
    "grade": "X",
    "label": "关联系列/企划重复百合欺诈模式",
    "summary": "多个具有已验证 same_series/same_project 或等价强项目连续关系的 Work，各自独立证明发生 material yuri bait/fraud，由此形成同系列/同项目重复模式。",
    "inclusionCriteria": [
      "至少两个不同相关 Work 各自独立确认 bait/fraud",
      "WorkRelation 与 ProjectContinuityProfile 均支持足够强连续性",
      "不能仅靠共同作者推断",
      "达到 X 的人工裁定门槛"
    ],
    "exclusionCriteria": [
      "只有一个相关欺诈 Work",
      "仅共同作者/公司",
      "相关作品高度独立到 continuityClass=isolated_entry",
      "bait 事实本身未独立证明"
    ],
    "interpretationNotes": [
      "X 的重点是相关 Work 的重复模式，不是 Creator reputation。"
    ],
    "tags": [],
    "requiresHumanReview": true,
    "doNotAutoPublish": true
  },
  "X-ONGOING-CREATOR-EXTREME-RISK": {
    "grade": "X",
    "label": "连载中创作者极端历史风险",
    "summary": "仅适用于仍在连载中的作品且保持 X 人工裁定：负责未来主要内容的 Entity 存在经验证、极端且与当前项目未来走向直接相关的高风险历史模式，足以形成最高级 contextual risk。",
    "inclusionCriteria": [
      "releaseStatus 为 ongoing",
      "存在极端且经验证的 EntityRiskPattern",
      "Entity 对当前 Work 的相关风险维度具有实际影响能力",
      "达到 X 的人工裁定门槛"
    ],
    "exclusionCriteria": [
      "作品已 completed",
      "一般风评/泛政治/泛 LGBT+ 言论",
      "仅一条弱历史记录",
      "据此声称本作已经欺诈"
    ],
    "interpretationNotes": [
      "这是 contextual risk，不是对主观恶意的事实宣判；意图可另行记录但不是风险模式成立的必要条件。"
    ],
    "tags": [],
    "requiresHumanReview": true,
    "doNotAutoPublish": true
  },
  "D-TS-SETTING": {
    "grade": "D",
    "label": "TS / 性别转换设定存在",
    "summary": "作品存在明确的 TS / 性别转换设定；在如实披露且没有额外欺诈事实时，该设定由当前 Policy 作为 D 级风险边界处理。",
    "inclusionCriteria": [
      "目标作品中 TS/性别转换设定有肯定证据",
      "设定与重要角色或关系体验相关"
    ],
    "exclusionCriteria": [
      "仅有跨性别/性别表达主题但不符合当前 Policy 所指 TS 设定",
      "没有 exact-work 设定证据",
      "用该类替代宣传欺诈类别"
    ],
    "interpretationNotes": [
      "stable class 只记录设定存在；如有宣传误导另匹配 setting_based_yuri_misrepresentation。"
    ],
    "tags": [
      "setting_profile"
    ],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "D-FUTA-SETTING": {
    "grade": "D",
    "label": "扶她设定存在",
    "summary": "作品存在明确扶她设定；在如实披露且没有额外欺诈事实时，由当前 Policy 作为 D 级风险边界处理。",
    "inclusionCriteria": [
      "目标作品中扶她设定有肯定证据",
      "设定与重要角色或关系体验相关"
    ],
    "exclusionCriteria": [
      "只有成人内容但没有扶她设定",
      "没有 exact-work 设定证据",
      "用该类替代宣传欺诈类别"
    ],
    "interpretationNotes": [
      "stable class 只记录设定存在；欺诈/误导由独立 class 处理。"
    ],
    "tags": [
      "setting_profile"
    ],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "E-ABO": {
    "grade": "E",
    "label": "ABO 设定存在",
    "summary": "作品明确采用 ABO（Alpha/Beta/Omega）设定。根据 owner-approved 风险政策，ABO 设定本身构成 E 级最低拦截线，不以是否提前披露为条件。",
    "inclusionCriteria": [
      "目标作品的世界观、角色关系、生理/社会身份体系或核心关系机制明确采用 ABO",
      "设定存在有 exact-work 肯定证据"
    ],
    "exclusionCriteria": [
      "仅借用类似术语但不构成 ABO 体系",
      "没有 exact-work 设定证据",
      "把宣传欺诈与设定存在混为同一事实"
    ],
    "interpretationNotes": [
      "本类别只记录 ABO 设定事实；当前 Policy 明确把它绑定为最低 E。若同时存在宣传误导，可额外匹配 setting_based_yuri_misrepresentation/material_setting_bait。"
    ],
    "tags": [
      "setting_profile",
      "minimum_grade_interceptor"
    ],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "D-OTOKONOKO-CROSSDRESSING": {
    "grade": "D",
    "label": "男娘 / 女装设定存在",
    "summary": "作品存在明确男娘、女装或当前 Policy 所定义的相关身份/表现设定；在如实披露且没有额外欺诈事实时，由当前 Policy 作为 D 级风险边界处理。",
    "inclusionCriteria": [
      "目标作品中相关设定有肯定证据",
      "设定与重要角色或关系体验相关"
    ],
    "exclusionCriteria": [
      "普通服装变化",
      "没有身份/设定层意义的短暂伪装",
      "没有 exact-work 设定证据",
      "用该类替代宣传欺诈类别"
    ],
    "interpretationNotes": [
      "stable class 记录设定存在，宣传误导另行分类。"
    ],
    "tags": [
      "setting_profile"
    ],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  },
  "F-MALE-ROMANTIC-AXIS": {
    "grade": "F",
    "label": "持续核心男性恋爱轴",
    "summary": "中心女性角色对特定男性存在可验证的恋爱指向；该男性在作品本体或与其不可分割的同一连续性中长期、反复占据主要恋爱候选或情感参照位置，使男性恋爱轴成为核心角色关系结构的持续组成部分。该类不要求接吻、性行为、正式交往或异性终局。",
    "inclusionCriteria": [
      "中心女性与特定男性身份均已精确绑定。",
      "exact work 内必须存在至少一个肯定性的特殊关系或恋爱编码锚点，强于普通男性主角团成员、普通友谊或纯推测。",
      "该男性关系在 exact work 内反复出现，或由 materially continuous canonical series 的后续/并行官方材料证明为持续关系轴；连续性证据只能证明持续性，不能把后续事件倒灌成 exact-work 事件。",
      "该男性具有持续叙事重要性，并反复占据可信的主要恋爱候选或情感参照位置。",
      "该关系轴对百合安全体验具有结构性影响，而非一次性玩笑、短暂 crush 或外围噪声。"
    ],
    "exclusionCriteria": [
      "仅有男性主要角色而没有恋爱轴，使用 C-MALE-MAIN-CAST 或更合适类别。",
      "仅有女性角色异性恋信号而未形成持续男性轴，使用 C-STRAIGHT-GIRL-HINT 或其他更合适类别。",
      "一次性、低严重度异性恋装置或短暂 crush，不足以触发本类。",
      "仅存在实质男性路线可能、但未证明长期核心轴，使用 E-MALE-POSSIBILITY。",
      "既往男性恋爱而非当前持续轴，使用 E-PAST-MALE-ROMANCE。",
      "局部且非终局男性亲密，使用 E-MALE-INTIMACY。",
      "核心、强制、决定性或终局男性亲密事实，使用 F-MALE-INTIMACY。",
      "已确认异性终局，使用 F-HET-END；同级类可并存。",
      "社区 ship 人气、二创或 provider 标签不能单独建立本类。"
    ],
    "interpretationNotes": [
      "本类评估的是关系拓扑，不以发生身体亲密行为为必要条件。",
      "exact-work 肯定性锚点是硬门槛；同连续性材料只能用于证明该轴的长期性和结构性。",
      "后续材料不能把后续接吻、交往或终局事实倒灌为 earlier exact-work 的事实。",
      "lower-grade interception 保持不变；若同一作品另有 F-HET-END、F-MALE-INTIMACY 或 F-MALE-NTR 等已证事实，应保留所有同级支持类。"
    ],
    "tags": [],
    "requiresHumanReview": false,
    "doNotAutoPublish": false
  }
} as const satisfies Record<string, RadarClassDefinition>

export type RadarRatingClass = keyof typeof radarClassDefinitions

export const radarClassEntries = Object.entries(radarClassDefinitions) as Array<
  [RadarRatingClass, RadarClassDefinition]
>

export function isRadarRatingClass(value: string): value is RadarRatingClass {
  return Object.prototype.hasOwnProperty.call(radarClassDefinitions, value)
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
  'C-SPECIAL',
  'D-SPECIAL',
  'E-SPECIAL',
  'F-SPECIAL',
  'X-SPECIAL',
] as const

export const radarPolicySafety = {
  lowerGradeInterception: true,
  sameGradeMultipleClassesAllowed: true,
  unknownOrNotObservedNeverMeansAbsent: true,
  doNotOverwriteHumanVerified: true,
  severeRatingsRemainPublic: true,
  doNotAutoAssignX: true,
  machineXForbidden: true,
  preserveConflictingEvidence: true,
  storePolicyVersion: true,
  dUnclearIsReleaseStatusOnly: true,
} as const

