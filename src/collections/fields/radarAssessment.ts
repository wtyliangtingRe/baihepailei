import type { CollectionConfig, Field } from 'payload'

export const radarEvidenceStatusOptions = [
  { label: '官方材料确认', value: 'official_confirmed' },
  { label: '原作材料确认', value: 'primary_material_confirmed' },
  { label: '多个二手来源支持', value: 'multiple_secondary_supported' },
  { label: '单一二手来源支持', value: 'single_secondary_supported' },
  { label: '社群资料基本一致', value: 'community_consensus' },
  { label: '仅由元数据推断', value: 'inferred_from_metadata' },
  { label: '来源存在冲突', value: 'conflicting_evidence' },
  { label: '证据不足', value: 'insufficient_evidence' },
  { label: '尚未评估', value: 'unknown' },
]

export const radarAssessmentField: Field = {
  name: 'radarAssessment',
  type: 'group',
  label: '排雷可信度',
  admin: {
    description: '保存当前排雷判断的置信度、资料覆盖度和证据状态。这里的百分比不表示作品安全概率。',
  },
  fields: [
    {
      name: 'confidencePercent',
      type: 'number',
      label: '判断置信度（%）',
      min: 0,
      max: 100,
      admin: {
        description: '表示当前建议与现有证据的一致程度，不等同于作品安全概率。',
      },
    },
    {
      name: 'evidenceCoveragePercent',
      type: 'number',
      label: '资料覆盖度（%）',
      min: 0,
      max: 100,
      admin: {
        description: '表示角色关系、剧情发展、结局、官方说明和来源材料等关键证据的完整度。',
      },
    },
    {
      name: 'evidenceStatus',
      type: 'select',
      label: '证据状态',
      options: radarEvidenceStatusOptions,
    },
    {
      name: 'sourceSummary',
      type: 'textarea',
      label: '来源摘要',
      admin: {
        description: '面向读者的简短来源说明；具体链接仍放在来源链接或候选来源中。',
      },
    },
    {
      name: 'policyVersion',
      type: 'text',
      label: '评级规则版本',
      admin: {
        description: '例如 radar-rating-policy-v0.4-draft。',
      },
    },
    {
      name: 'assessedAt',
      type: 'date',
      label: '本次评估时间',
    },
  ],
}

export function withRadarAssessmentFields(collection: CollectionConfig): CollectionConfig {
  const alreadyPresent = collection.fields.some((field) => 'name' in field && field.name === 'radarAssessment')
  if (alreadyPresent) return collection

  return {
    ...collection,
    fields: [...collection.fields, radarAssessmentField],
  }
}
