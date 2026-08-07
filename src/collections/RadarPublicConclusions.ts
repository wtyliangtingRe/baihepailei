import type { Access, CollectionConfig } from 'payload'

import { adminsOnly, editorsAndUp } from '@/access/roles'

import { radarAssessmentField } from './fields/radarAssessment'

const gradeOptions = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'unknown'].map((value) => ({
  label: value === 'unknown' ? '未知' : value,
  value,
}))

const currentPublicOrStaff: Access = ({ req }) => {
  if (req.user) return true
  return {
    recordStatus: {
      equals: 'current',
    },
  }
}

export const RadarPublicConclusions: CollectionConfig = {
  slug: 'radar-public-conclusions',
  dbName: 'radar_public',
  labels: {
    singular: 'Radar 公开结论',
    plural: 'Radar 公开结论',
  },
  admin: {
    defaultColumns: [
      'title',
      'workIdSnapshot',
      'compatibilityGrade',
      'conclusionMode',
      'recordStatus',
      'publishedAt',
      'updatedAt',
    ],
    group: '内容',
    useAsTitle: 'title',
    description: '面向前台的当前 AI Radar 结论投影。每个作品只保留一条当前记录；更新此集合不会写入 Works 或提升 Works 草稿。',
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
      label: '公开结论 Key',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: '稳定幂等键，固定使用 work:<Works 数据库 ID>。新 AI 结论更新同一条记录。',
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
      index: true,
    },
    {
      name: 'title',
      type: 'text',
      label: '作品标题快照',
      required: true,
    },
    {
      name: 'recordStatus',
      type: 'select',
      label: '公开状态',
      required: true,
      defaultValue: 'current',
      index: true,
      options: [
        { label: '当前', value: 'current' },
        { label: '撤回', value: 'withdrawn' },
      ],
    },
    {
      name: 'conclusionMode',
      type: 'select',
      label: '结论形态',
      required: true,
      options: [
        { label: '固定等级', value: 'fixed_grade' },
        { label: '有界范围', value: 'bounded_range' },
        { label: '仅规则 / 标签', value: 'labels_only' },
        { label: '阻塞', value: 'blocked' },
      ],
    },
    {
      name: 'compatibilityGrade',
      type: 'select',
      label: '目录兼容等级',
      index: true,
      options: gradeOptions,
      admin: {
        description: '固定等级直接使用该等级；有界范围使用最可能等级；labels_only / blocked 必须留空。人工轨道仍在前台优先。',
      },
    },
    {
      name: 'bestGrade',
      type: 'select',
      label: '最好情况等级',
      options: gradeOptions,
    },
    {
      name: 'likelyGrade',
      type: 'select',
      label: '最可能等级',
      options: gradeOptions,
    },
    {
      name: 'worstGrade',
      type: 'select',
      label: '最坏情况等级',
      options: gradeOptions,
    },
    {
      name: 'ratingNotice',
      type: 'select',
      label: '前台分级提示',
      required: true,
      defaultValue: 'ai_synthesized_pending_review',
      options: [
        { label: 'AI 综合，待复核', value: 'ai_synthesized_pending_review' },
        { label: '信息不足', value: 'insufficient_information' },
        { label: '无', value: 'none' },
      ],
    },
    {
      name: 'reviewReasons',
      type: 'select',
      label: '公开复核原因',
      hasMany: true,
      options: [
        { label: 'Radar v0.6 评估包导入', value: 'radar_v06_package_import' },
        { label: 'Radar 发布保护', value: 'radar_publication_guard' },
        { label: 'Radar 证据覆盖不足', value: 'radar_guard_low_evidence_coverage' },
        { label: 'Radar 来源较弱或冲突', value: 'radar_guard_weak_or_conflicting_source' },
        { label: 'Radar 暂定等级不明确', value: 'radar_guard_unclear_provisional_grade' },
      ],
    },
    {
      name: 'evidenceStrength',
      type: 'select',
      label: '证据强度',
      required: true,
      defaultValue: 'unassessed',
      options: [
        { label: '未评估', value: 'unassessed' },
        { label: '弱', value: 'weak' },
        { label: '中', value: 'medium' },
        { label: '强', value: 'strong' },
      ],
    },
    radarAssessmentField,
    {
      name: 'sourceKind',
      type: 'select',
      label: '结论来源类型',
      required: true,
      options: [
        { label: '评估包', value: 'package' },
        { label: '既有最新 AI 草稿', value: 'latest_ai_draft' },
        { label: '人工触发 AI 更新', value: 'manual_ai_update' },
      ],
    },
    {
      name: 'sourcePackageId',
      type: 'text',
      label: '来源包 ID',
      index: true,
    },
    {
      name: 'sourcePackageSha256',
      type: 'text',
      label: '来源包 SHA-256',
    },
    {
      name: 'conclusionSha256',
      type: 'text',
      label: '结论 SHA-256',
      required: true,
      index: true,
    },
    {
      name: 'publicationVersion',
      type: 'text',
      label: '发布器版本',
      required: true,
    },
    {
      name: 'publishedAt',
      type: 'date',
      label: 'AI 结论发布时间',
      required: true,
      index: true,
    },
  ],
}
