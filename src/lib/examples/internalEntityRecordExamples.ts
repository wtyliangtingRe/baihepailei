/**
 * Documentation-only examples of the current Payload record shapes.
 *
 * These objects are not seed data and must not be imported by migrations,
 * import scripts, or production write paths. They exist so future work can
 * inspect one representative Work, Creator, and Organization in source.
 *
 * Important Payload conventions shown here:
 * - Relationship values are numeric IDs at depth 0. With a larger `depth`,
 *   Payload may replace an ID with the expanded related document.
 * - `summary`, `analysis`, and `notes` are Lexical JSON, not plain strings.
 * - `_status`, `createdAt`, and `updatedAt` are Payload-managed fields.
 * - The current official human outcome for Works is represented by `rank`,
 *   `reviewStatus`, and the `humanReview*` fields.
 * - `radarAssessment` is the AI/rule suggestion layer and must not silently
 *   overwrite the official human outcome.
 * - `stewardshipNotices` is optional and is registered only after the
 *   stewardship schema migration and runtime flag are enabled.
 */

export type ExampleLexicalDocument = {
  root: {
    type: 'root'
    version: 1
    format: ''
    indent: 0
    direction: 'ltr'
    children: Array<{
      type: 'paragraph'
      version: 1
      format: ''
      indent: 0
      direction: 'ltr'
      children: Array<{
        type: 'text'
        version: 1
        text: string
        format: 0
        detail: 0
        mode: 'normal'
        style: ''
      }>
    }>
  }
}

function lexicalDocument(...paragraphs: string[]): ExampleLexicalDocument {
  return {
    root: {
      type: 'root',
      version: 1,
      format: '',
      indent: 0,
      direction: 'ltr',
      children: paragraphs.map((text) => ({
        type: 'paragraph',
        version: 1,
        format: '',
        indent: 0,
        direction: 'ltr',
        children: [{
          type: 'text',
          version: 1,
          text,
          format: 0,
          detail: 0,
          mode: 'normal',
          style: '',
        }],
      })),
    },
  }
}

/**
 * Representative Works document.
 *
 * IDs in relationships are intentionally fictional. For example, `creators`
 * contains Creator IDs, `cover` contains a Media ID, and
 * `stewardshipNotices` contains StewardshipNotice IDs.
 */
export const internalWorkRecordExample = {
  id: 900001,
  title: '示例作品：双星花园',
  slug: 'example-work-900001',
  siteId: 'example:work:900001',

  // Official human-facing outcome.
  rank: 'B',
  reviewStatus: 'reviewed',
  humanReviewNote: '示例：已核对原作主要关系、结局与官方介绍。',
  humanReviewedAt: '2026-07-19T00:00:00.000Z',
  humanReviewedBy: 1,

  // Import/review provenance.
  importBatch: 'example-batch-v01',
  ratingNotice: 'manual_reviewed',
  chosenBaseSource: 'manual',
  reviewReasons: ['manual_review'],
  sourceConflictNotes: '',
  evidenceStrength: 'strong',

  originalTitle: '双星の庭',
  aliases: [
    { value: '双星花园' },
    { value: 'Garden of the Twin Stars' },
  ],
  localizedTitles: [
    {
      title: '双星の庭',
      language: 'ja',
      region: 'JP',
      kind: 'original',
      isPrimary: true,
      source: 'official',
      note: '',
    },
    {
      title: '双星花园',
      language: 'zh-Hans',
      region: 'CN',
      kind: 'official',
      isPrimary: true,
      source: 'manual',
      note: '示例译名',
    },
    {
      title: 'Garden of the Twin Stars',
      language: 'en',
      region: '',
      kind: 'romanized',
      isPrimary: true,
      source: 'manual',
      note: '',
    },
  ],

  mediaGroup: 'anime',
  mediaType: 'anime',
  format: 'tv_anime',
  firstPublishedAt: '2025-04-01T00:00:00.000Z',
  firstPublishedPrecision: 'month',
  firstPublishedLabel: '2025-04',

  externalIds: {
    bangumiSubjectId: 'example-900001',
    anilistMediaId: '',
    vndbId: '',
    wikidataQid: '',
    malId: '',
    officialUrl: 'https://example.invalid/works/900001',
  },
  candidateSources: [
    {
      source: 'manual',
      label: '示例官方页面',
      externalId: 'example-900001',
      url: 'https://example.invalid/works/900001',
      fetchedAt: '2026-07-19T00:00:00.000Z',
      note: '仅用于展示候选来源结构。',
    },
  ],
  workGroup: {
    key: 'example-series-01',
    title: '示例系列',
    relation: 'main',
    orderLabel: '1',
    source: 'manual',
    confidence: 'confirmed',
    note: '',
  },
  yuriCandidateScore: 0.92,

  isLiteVisible: true,
  isFullVisible: true,
  hasEvidence: true,
  riskMatrix: {
    maleImpact: 'none',
    relationshipClarity: 'confirmed',
    endingSafety: 'safe',
    creatorSpeechRisk: 'none',
    note: '兼容保留的旧矩阵示例；正式判断应逐步迁移到规则与证据体系。',
  },

  // Depth-0 relationship IDs.
  creators: [910001],
  creatorCredits: [
    {
      creator: 910001,
      role: 'director',
      originalRole: '監督',
      source: 'manual',
      note: '',
    },
  ],
  organizations: [
    {
      organization: 920001,
      role: 'animation_studio',
      originalRole: 'アニメーション制作',
      source: 'manual',
      note: '',
    },
  ],
  tags: [930001],
  warnings: [940001],
  cover: 950001,
  stewardshipNotices: [960001],

  summary: lexicalDocument(
    '两位少女在共同维护花园的过程中逐渐确认彼此感情。',
    '本段仅演示面向读者的作品简介结构。',
  ),
  analysis: lexicalDocument(
    '本段仅演示内部分析富文本结构，不代表真实作品结论。',
  ),
  sourceLinks: [
    { label: '示例官方页面', url: 'https://example.invalid/works/900001' },
  ],
  searchText: '双星の庭 Garden of the Twin Stars 示例监督 示例制作社',
  evidenceNote: '示例：已保存官方介绍与结局核验说明。',

  // AI/rule suggestion layer, separate from the official B rank above.
  radarAssessment: {
    confidencePercent: 86,
    evidenceCoveragePercent: 78,
    evidenceStatus: 'primary_material_confirmed',
    sourceSummary: '示例：官方介绍、原作主要章节与结局材料。',
    sourceCount: 3,
    policyVersion: 'radar-rating-policy-v0.2-draft',
    assessmentBatch: 'example-assessment-v01',
    suggestedGrade: 'C',
    decisiveRuleCode: 'C-EXAMPLE-RULE',
    decisiveRuleReason: '示例：规则建议层给出 C，但人工核验后正式等级为 B。',
    matchedRules: [
      {
        code: 'C-EXAMPLE-RULE',
        grade: 'C',
        confidencePercent: 86,
        reason: '仅用于展示主规则与全部命中规则的数据形状。',
      },
      {
        code: 'B-EXAMPLE-SUPPORT',
        grade: 'B',
        confidencePercent: 72,
        reason: '示例辅助规则。',
      },
    ],
    contradictions: [
      { value: '示例：早期二手简介与原作结局描述不一致。' },
    ],
    requiresHumanReview: false,
    assessedAt: '2026-07-18T00:00:00.000Z',
  },

  status: 'published',
  _status: 'published',
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
} as const

/** Representative Creators document. */
export const internalCreatorRecordExample = {
  id: 910001,
  name: '示例创作者',
  slug: 'example-creator-910001',
  siteId: 'example:creator:910001',
  rank: 'A',

  reviewStatus: 'reviewed',
  reviewOrigin: 'human_reviewed',
  humanReviewNote: '示例：名称、主要职位与官方资料已核对。',
  humanReviewedAt: '2026-07-19T00:00:00.000Z',
  humanReviewedBy: 1,

  aliases: [
    { value: 'Example Creator' },
  ],
  localizedNames: [
    {
      name: '示例创作者',
      language: 'zh-Hans',
      region: 'CN',
      kind: 'official',
      isPrimary: true,
      source: 'manual',
      note: '',
    },
    {
      name: 'Example Creator',
      language: 'en',
      region: '',
      kind: 'romanized',
      isPrimary: true,
      source: 'manual',
      note: '',
    },
  ],
  profileImage: 950002,
  notes: lexicalDocument('示例创作者备注。'),
  searchText: 'Example Creator 示例监督 示例系列',
  isLiteVisible: true,
  isFullVisible: true,
  stewardshipNotices: [960001],

  legacyXWikiPage: '',
  status: 'published',
  _status: 'published',
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
} as const

/** Representative Organizations document. */
export const internalOrganizationRecordExample = {
  id: 920001,
  name: '示例制作社',
  slug: 'example-organization-920001',
  siteId: 'example:organization:920001',
  type: 'animation_studio',

  reviewStatus: 'reviewed',
  reviewOrigin: 'human_reviewed',
  humanReviewNote: '示例：机构名称、类型与官网已核对。',
  humanReviewedAt: '2026-07-19T00:00:00.000Z',
  humanReviewedBy: 1,

  aliases: [
    { value: 'Example Animation Studio' },
  ],
  localizedNames: [
    {
      name: '示例制作社',
      language: 'zh-Hans',
      region: 'CN',
      kind: 'official',
      isPrimary: true,
      source: 'manual',
      note: '',
    },
    {
      name: 'Example Animation Studio',
      language: 'en',
      region: '',
      kind: 'official',
      isPrimary: true,
      source: 'manual',
      note: '',
    },
  ],
  notes: lexicalDocument('示例机构备注。'),
  sourceLinks: [
    { label: '示例官网', url: 'https://example.invalid/organizations/920001' },
  ],
  searchText: 'Example Animation Studio 示例制作委员会 示例系列',
  isLiteVisible: true,
  isFullVisible: true,
  stewardshipNotices: [960001],

  legacyXWikiPage: '',
  status: 'published',
  _status: 'published',
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
} as const

export const internalEntityRecordExamples = {
  work: internalWorkRecordExample,
  creator: internalCreatorRecordExample,
  organization: internalOrganizationRecordExample,
} as const
