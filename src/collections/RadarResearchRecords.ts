import type { CollectionConfig } from 'payload'

import { editorsAndUp } from '@/access/roles'

const gradeOptions = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'unknown'].map((value) => ({
  label: value === 'unknown' ? '未知' : value,
  value,
}))

const researchStatusOptions = [
  { label: '已解决', value: 'resolved' },
  { label: '部分解决', value: 'partial' },
  { label: '信息不足', value: 'insufficient' },
  { label: '身份问题', value: 'identity_problem' },
]

const riskSignalOptions = [
  { label: '男性介入', value: 'male_involvement' },
  { label: 'NTR', value: 'ntr' },
  { label: '扶她', value: 'futa' },
  { label: '男娘 / 伪娘', value: 'otokonoko' },
  { label: 'TS / 性别转换', value: 'ts' },
  { label: '既往男性关系', value: 'prior_male_relationship' },
  { label: 'ABO', value: 'abo' },
  { label: '其他', value: 'other' },
]

export const RadarResearchRecords: CollectionConfig = {
  slug: 'radar-research-records',
  labels: {
    singular: 'Radar 研究记录',
    plural: 'Radar 研究记录',
  },
  admin: {
    defaultColumns: [
      'title',
      'workSiteId',
      'researchStatus',
      'lane',
      'recommendedNextQueue',
      'recommendedNextAction',
      'confidencePercent',
      'updatedAt',
    ],
    group: '研究',
    useAsTitle: 'title',
    description: '保存 AI Radar 的内部研究分诊结果。默认不公开，也不等同于正式评级。',
  },
  access: {
    create: editorsAndUp,
    delete: editorsAndUp,
    read: editorsAndUp,
    update: editorsAndUp,
  },
  fields: [
    {
      name: 'researchKey',
      type: 'text',
      label: '研究记录 Key',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'programId|workId|siteId。用于幂等导入和后续研究版本并存。',
      },
    },
    {
      name: 'title',
      type: 'text',
      label: '作品标题快照',
      required: true,
    },
    {
      name: 'programId',
      type: 'text',
      label: '研究计划',
      required: true,
      index: true,
    },
    {
      name: 'importBatch',
      type: 'text',
      label: '导入批次',
      required: true,
      index: true,
    },
    {
      name: 'batchId',
      type: 'text',
      label: '研究批次',
      required: true,
      index: true,
    },
    {
      name: 'wave',
      type: 'text',
      label: '波次',
    },
    {
      name: 'lane',
      type: 'text',
      label: '研究通道',
      index: true,
    },
    {
      name: 'milestone',
      type: 'number',
      label: '里程碑',
      min: 1,
      max: 3,
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
      name: 'workIdSnapshot',
      type: 'text',
      label: 'Work ID 快照',
      required: true,
    },
    {
      name: 'workSiteId',
      type: 'text',
      label: '作品 Site ID',
      required: true,
      index: true,
    },
    {
      name: 'recordShape',
      type: 'select',
      label: '记录形态',
      required: true,
      options: [
        { label: '阻塞项研究', value: 'blocked' },
        { label: '目录分诊', value: 'catalog' },
      ],
    },
    {
      name: 'researchStatus',
      type: 'select',
      label: '研究状态',
      required: true,
      index: true,
      options: researchStatusOptions,
    },
    {
      name: 'yuriRelevance',
      type: 'select',
      label: '百合相关性',
      options: [
        { label: '高', value: 'high' },
        { label: '可能', value: 'possible' },
        { label: '未知', value: 'unknown' },
      ],
    },
    {
      name: 'riskSignals',
      type: 'select',
      label: '风险信号',
      hasMany: true,
      options: riskSignalOptions,
    },
    {
      name: 'proposedLikelyGrade',
      type: 'select',
      label: '最可能等级',
      options: gradeOptions,
    },
    {
      name: 'proposedBestGrade',
      type: 'select',
      label: '最好情况等级',
      options: gradeOptions,
    },
    {
      name: 'proposedWorstGrade',
      type: 'select',
      label: '最坏情况等级',
      options: gradeOptions,
    },
    {
      name: 'sourceSummary',
      type: 'textarea',
      label: '来源摘要',
    },
    {
      name: 'sources',
      type: 'array',
      label: '研究来源',
      fields: [
        { name: 'title', type: 'text', label: '来源标题' },
        { name: 'url', type: 'text', label: 'URL', required: true },
        {
          name: 'sourceType',
          type: 'select',
          label: '来源类型',
          options: [
            { label: '官方', value: 'official' },
            { label: '原始材料', value: 'primary' },
            { label: '二手来源', value: 'secondary' },
            { label: '社群来源', value: 'community' },
            { label: '其他', value: 'other' },
          ],
        },
      ],
    },
    {
      name: 'unresolvedQuestions',
      type: 'array',
      label: '未解决问题',
      fields: [
        { name: 'value', type: 'textarea', label: '问题', required: true },
      ],
    },
    {
      name: 'confidencePercent',
      type: 'number',
      label: '研究置信度（%）',
      min: 0,
      max: 100,
    },
    {
      name: 'recommendedNextAction',
      type: 'select',
      label: '阻塞项后续动作',
      options: [
        { label: '进入重新评估', value: 'promote_for_reassessment' },
        { label: '继续阻塞', value: 'retain_block' },
        { label: '人工复核', value: 'human_review' },
        { label: '身份复核', value: 'identity_review' },
      ],
    },
    {
      name: 'recommendedNextQueue',
      type: 'select',
      label: '目录后续队列',
      options: [
        { label: '完整评估', value: 'full_assessment' },
        { label: '继续研究', value: 'more_research' },
        { label: '低优先级', value: 'low_priority' },
      ],
    },
    {
      name: 'researchNote',
      type: 'textarea',
      label: '研究说明',
    },
    {
      name: 'sourceResponseSha256',
      type: 'text',
      label: '来源响应 SHA-256',
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
      options: [
        { label: '当前', value: 'current' },
        { label: '已归档', value: 'archived' },
      ],
    },
  ],
}
