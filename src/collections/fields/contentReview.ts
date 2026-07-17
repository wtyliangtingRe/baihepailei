import type { Field } from 'payload'

export const contentReviewFields = (): Field[] => [
  {
    name: 'reviewStatus',
    type: 'select',
    label: '复核状态',
    required: true,
    defaultValue: 'pending',
    options: [
      { label: '待复核', value: 'pending' },
      { label: '已复核', value: 'reviewed' },
      { label: '有争议', value: 'disputed' },
      { label: '已废弃', value: 'deprecated' },
    ],
    admin: { description: '只有完成逐条人工核验后才能改为“已复核”。' },
  },
  {
    name: 'reviewOrigin',
    type: 'select',
    label: '最近评估来源',
    required: true,
    defaultValue: 'unassessed',
    options: [
      { label: '尚未评估', value: 'unassessed' },
      { label: 'AI 已评估，待人工复核', value: 'ai_assessed' },
      { label: '人工已复核', value: 'human_reviewed' },
      { label: '导入资料，来源待核', value: 'imported_unverified' },
    ],
    admin: { description: '标记资料由谁整理；AI 已评估不等于人工通过。' },
  },
  { name: 'humanReviewNote', type: 'textarea', label: '人工复核记录', maxLength: 4000 },
  { name: 'humanReviewedAt', type: 'date', label: '最近人工复核时间', admin: { readOnly: true } },
  {
    name: 'humanReviewedBy',
    type: 'relationship',
    label: '最近人工复核人',
    relationTo: 'users',
    admin: { readOnly: true },
  },
]
