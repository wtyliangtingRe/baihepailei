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

export const RadarPublicRecords: CollectionConfig = {
  slug: 'radar-public-records',
  dbName: 'radar_public_records',
  labels: {
    singular: 'Radar 公开研究记录',
    plural: 'Radar 公开研究记录',
  },
  admin: {
    defaultColumns: [
      'title',
      'workIdSnapshot',
      'publicState',
      'sourceReleaseId',
      'recordStatus',
      'sourceReviewedAt',
      'updatedAt',
    ],
    group: '内容',
    useAsTitle: 'title',
    description: '无评级的公开研究投影。保存已核实事实、来源与资料不足状态；不会覆盖 Works、人工评级或旧 Radar 评级。',
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
      label: '公开记录 Key',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: '固定使用 work:<Works 数据库 ID>；后续发布包幂等更新同一条记录。',
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
      name: 'publicState',
      type: 'select',
      label: '公开资料状态',
      required: true,
      index: true,
      options: [
        { label: '已验证', value: 'verified' },
        { label: '部分资料已验证', value: 'partial' },
        { label: '资料待补充', value: 'needs_more_research' },
      ],
    },
    {
      name: 'researchStatus',
      type: 'select',
      label: '研究状态',
      required: true,
      index: true,
      options: [
        { label: '可公开', value: 'ready_for_publication' },
        { label: '部分验证', value: 'partially_verified' },
        { label: '资料不足', value: 'needs_more_research' },
      ],
    },
    {
      name: 'pageNotice',
      type: 'textarea',
      label: '前台资料提示',
      required: true,
      maxLength: 1000,
    },
    {
      name: 'facts',
      type: 'array',
      label: '公开事实',
      fields: [
        { name: 'factId', type: 'text', label: '事实 ID', required: true },
        { name: 'factType', type: 'text', label: '事实类型', required: true },
        { name: 'value', type: 'json', label: '事实值', required: true },
        {
          name: 'sourceRefs',
          type: 'array',
          label: '来源引用',
          required: true,
          fields: [{ name: 'value', type: 'text', label: '来源 Ref', required: true }],
        },
      ],
    },
    {
      name: 'evidence',
      type: 'array',
      label: '公开证据',
      fields: [
        { name: 'sourceRef', type: 'text', label: '来源 Ref', required: true },
        {
          name: 'tier',
          type: 'select',
          label: '来源层级',
          required: true,
          options: ['A', 'B', 'C', 'D', 'E'].map((value) => ({ label: value, value })),
        },
        {
          name: 'role',
          type: 'select',
          label: '证据角色',
          required: true,
          options: [
            { label: '主要证据', value: 'primary' },
            { label: '补充证据', value: 'supplemental' },
            { label: '仅作线索', value: 'lead_only' },
          ],
        },
        { name: 'url', type: 'text', label: 'HTTPS URL', required: true },
        { name: 'title', type: 'text', label: '来源标题', required: true },
        { name: 'exactIdentityBound', type: 'checkbox', label: '已绑定精确身份', required: true },
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
      name: 'recordSha256',
      type: 'text',
      label: '公开记录 SHA-256',
      required: true,
      index: true,
    },
    {
      name: 'releaseRecordsSha256',
      type: 'text',
      label: '发布包 records SHA-256',
      required: true,
    },
    {
      name: 'sourceReviewedAt',
      type: 'date',
      label: '来源最近复核时间',
      required: true,
      index: true,
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
