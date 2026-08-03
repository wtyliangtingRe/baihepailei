import type { Access, CollectionConfig } from 'payload'

import { adminsOnly, editorsAndUp } from '@/access/roles'

const currentPublicOrStaff: Access = ({ req }) => {
  if (req.user) return true
  return {
    recordStatus: {
      equals: 'current',
    },
  }
}

const gradeOptions = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X'].map((value) => ({
  label: value,
  value,
}))

const valueArrayField = (name: string, label: string) => ({
  name,
  type: 'array' as const,
  label,
  fields: [{ name: 'value', type: 'text' as const, label: '值', required: true }],
})

export const RadarPublicRatings: CollectionConfig = {
  slug: 'radar-public-ratings',
  dbName: 'radar_public_ratings',
  labels: {
    singular: 'Radar 公开机器评级',
    plural: 'Radar 公开机器评级',
  },
  admin: {
    defaultColumns: [
      'title',
      'workIdSnapshot',
      'coreGrade',
      'confidence',
      'confidencePercent',
      'evidenceCoveragePercent',
      'sourceReleaseId',
      'recordStatus',
      'updatedAt',
    ],
    group: '内容',
    useAsTitle: 'title',
    description: '独立保存公开机器评级、规则类别、标签提示与来源哈希；不覆盖 Works 的 AI 或人工评级字段。',
  },
  access: {
    create: editorsAndUp,
    delete: adminsOnly,
    read: currentPublicOrStaff,
    update: editorsAndUp,
  },
  disableBulkDelete: true,
  lockDocuments: false,
  fields: [
    {
      name: 'publicationKey',
      type: 'text',
      label: '公开评级 Key',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: '固定使用 work:<Works 数据库 ID>；后续发布包幂等更新同一条评级记录。',
      },
    },
    {
      name: 'work',
      type: 'relationship',
      label: '关联作品',
      relationTo: 'works',
      required: true,
      index: true,
    },
    {
      name: 'identityKey',
      type: 'text',
      label: '研究身份 Key',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: '精确 workId|siteId 身份；禁止标题近似匹配与版本替换。',
      },
    },
    {
      name: 'workIdSnapshot',
      type: 'text',
      label: 'Work ID 快照',
      required: true,
      index: true,
    },
    {
      name: 'workSiteId',
      type: 'text',
      label: '作品 Site ID 快照',
      required: true,
      index: true,
    },
    {
      name: 'title',
      type: 'text',
      label: '作品标题快照',
      required: true,
    },
    {
      name: 'coreGrade',
      type: 'select',
      label: '核心等级',
      required: true,
      index: true,
      options: gradeOptions,
    },
    {
      name: 'bestGrade',
      type: 'select',
      label: '最好情况等级',
      required: true,
      options: gradeOptions,
    },
    {
      name: 'likelyGrade',
      type: 'select',
      label: '最可能等级',
      required: true,
      options: gradeOptions,
    },
    {
      name: 'worstGrade',
      type: 'select',
      label: '最坏情况等级',
      required: true,
      options: gradeOptions,
    },
    {
      name: 'confidence',
      type: 'select',
      label: '机器判断置信度',
      required: true,
      index: true,
      options: [
        { label: '高', value: 'high' },
        { label: '中', value: 'medium' },
        { label: '低', value: 'low' },
      ],
    },
    {
      name: 'confidencePercent',
      type: 'number',
      label: '判断置信度',
      min: 0,
      max: 100,
      admin: {
        description: '当前机器评级结论与保留证据的一致程度；不是作品安全概率。',
      },
    },
    {
      name: 'evidenceCoveragePercent',
      type: 'number',
      label: '资料覆盖度',
      min: 0,
      max: 100,
      admin: {
        description: '关系、剧情、结局、来源及风险维度的加权证据完整度；不是来源数量。',
      },
    },
    {
      name: 'metricsPolicyVersion',
      type: 'text',
      label: '公开指标 Policy 版本',
      index: true,
    },
    {
      name: 'sourceMetricsPolicyVersion',
      type: 'text',
      label: '来源指标计算 Policy',
      index: true,
    },
    {
      name: 'relationshipEvidenceState',
      type: 'select',
      label: '关系证据状态',
      options: [
        { label: '已覆盖', value: 'covered' },
        { label: '部分覆盖', value: 'partial' },
        { label: '未覆盖', value: 'uncovered' },
      ],
    },
    {
      name: 'metricsSourceReleaseId',
      type: 'text',
      label: '指标来源 Release ID',
      index: true,
    },
    {
      name: 'metricsCalculationBasisSha256',
      type: 'text',
      label: '指标计算依据 SHA-256',
      index: true,
    },
    {
      name: 'requiresMetricReview',
      type: 'checkbox',
      label: '需要指标复核',
      defaultValue: false,
      admin: {
        description: '非阻断校准提示；不会改变人工审核状态或评级等级。',
      },
    },
    valueArrayField('matchedClasses', '命中的公开规则类别'),
    valueArrayField('factRefs', '事实引用'),
    valueArrayField('evidenceRefs', '证据引用'),
    {
      name: 'reasoningSummary',
      type: 'textarea',
      label: '公开判断摘要',
      required: true,
      maxLength: 5000,
    },
    valueArrayField('unresolvedDimensions', '尚未解决的排雷维度'),
    {
      name: 'classificationRule',
      type: 'text',
      label: '分类规则',
      required: true,
      index: true,
    },
    valueArrayField('confirmationBasis', '确认依据'),
    {
      name: 'benefitOfDoubtBaselineApplied',
      type: 'checkbox',
      label: '应用了谨慎有利推定基线',
      required: true,
      defaultValue: false,
    },
    {
      name: 'publicTagHints',
      type: 'array',
      label: '公开标签提示',
      fields: [
        { name: 'key', type: 'text', label: '稳定 Key', required: true },
        { name: 'group', type: 'text', label: '标签组', required: true },
        { name: 'value', type: 'text', label: '标签值', required: true },
        { name: 'warningTemplateId', type: 'text', label: '提示模板 ID' },
      ],
    },
    valueArrayField('publicWarningTemplateIds', '公开提示模板 ID'),
    {
      name: 'humanReview',
      type: 'group',
      label: '人工复核',
      fields: [
        {
          name: 'status',
          type: 'select',
          label: '复核状态',
          required: true,
          defaultValue: 'unreviewed',
          options: [
            { label: '未复核', value: 'unreviewed' },
            { label: '已复核', value: 'reviewed' },
            { label: '有争议', value: 'disputed' },
          ],
        },
        {
          name: 'reviewerIdentity',
          type: 'text',
          label: '复核者身份',
          access: { read: ({ req }) => Boolean(req.user) },
        },
        { name: 'reviewedAt', type: 'date', label: '复核时间' },
        { name: 'decision', type: 'text', label: '复核决定' },
        {
          name: 'proposedCoreGrade',
          type: 'select',
          label: '建议核心等级',
          options: gradeOptions,
        },
        valueArrayField('proposedProfileChanges', '建议偏好层变更'),
        {
          name: 'reasoning',
          type: 'textarea',
          label: '内部复核理由',
          maxLength: 5000,
          access: { read: ({ req }) => Boolean(req.user) },
        },
        {
          name: 'additionalEvidenceRefs',
          type: 'array',
          label: '内部补充证据引用',
          access: { read: ({ req }) => Boolean(req.user) },
          fields: [{ name: 'value', type: 'text', label: '值', required: true }],
        },
        {
          name: 'moderationState',
          type: 'text',
          label: '内部审核状态',
          access: { read: ({ req }) => Boolean(req.user) },
        },
        {
          name: 'blocksAnalysis',
          type: 'checkbox',
          label: '阻塞分析',
          required: true,
          defaultValue: false,
        },
        {
          name: 'blocksPublication',
          type: 'checkbox',
          label: '阻塞发布',
          required: true,
          defaultValue: false,
        },
      ],
    },
    {
      name: 'sourceReleaseId',
      type: 'text',
      label: '来源发布包 ID',
      required: true,
      index: true,
    },
    {
      name: 'sourceCommitSha',
      type: 'text',
      label: '研究快照 Commit SHA',
      required: true,
    },
    {
      name: 'sourcePolicyVersion',
      type: 'text',
      label: '来源 Policy 版本',
      required: true,
    },
    {
      name: 'researchSnapshotId',
      type: 'text',
      label: '研究快照 ID',
      required: true,
    },
    {
      name: 'sourceRatingCampaignId',
      type: 'text',
      label: '来源评级 Campaign ID',
      required: true,
      index: true,
    },
    {
      name: 'sourceRatingDecisionHash',
      type: 'text',
      label: '来源评级决策 SHA-256',
      required: true,
      index: true,
    },
    {
      name: 'releaseRatingHash',
      type: 'text',
      label: 'Release 评级 SHA-256',
      required: true,
      index: true,
    },
    {
      name: 'releaseRatingsSha256',
      type: 'text',
      label: 'Release ratings.jsonl SHA-256',
      required: true,
    },
    {
      name: 'importedAt',
      type: 'date',
      label: '导入时间',
      required: true,
    },
    {
      name: 'recordStatus',
      type: 'select',
      label: '记录状态',
      required: true,
      defaultValue: 'current',
      index: true,
      options: [
        { label: '当前', value: 'current' },
        { label: '已撤回', value: 'withdrawn' },
      ],
    },
  ],
}
