import type { Access, CollectionConfig, CollectionSlug } from 'payload'

import { trustedAndUp } from '@/access/roles'

const reviewStatusOptions = [
  { label: '待复核', value: 'pending' },
  { label: '已复核', value: 'reviewed' },
  { label: '有争议', value: 'disputed' },
  { label: '已废弃', value: 'deprecated' },
]

const evidenceStrengthOptions = [
  { label: '未评估', value: 'unassessed' },
  { label: '弱', value: 'weak' },
  { label: '中', value: 'medium' },
  { label: '强', value: 'strong' },
]

const evidenceStatusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '待审核', value: 'review' },
  { label: '已确认', value: 'confirmed' },
  { label: '归档', value: 'archived' },
]

const publicEvidenceOrSignedIn: Access = ({ req }) => {
  if (req.user) return true

  return {
    status: {
      equals: 'confirmed',
    },
    isPublic: {
      equals: true,
    },
  }
}

export const Evidence: CollectionConfig = {
  slug: 'evidence',
  labels: {
    singular: '证据材料',
    plural: '证据材料',
  },
  admin: {
    defaultColumns: ['title', 'evidenceType', 'reviewStatus', 'evidenceStrength', 'isPublic', 'status', 'updatedAt'],
    group: '内容',
    useAsTitle: 'title',
  },
  access: {
    create: trustedAndUp,
    delete: trustedAndUp,
    read: publicEvidenceOrSignedIn,
    update: trustedAndUp,
  },
  versions: {
    drafts: true,
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      label: '标题',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      label: 'Slug',
      required: true,
      unique: true,
      admin: {
        description: '用于导入匹配和后续详情页 URL。',
      },
    },
    {
      name: 'evidenceType',
      type: 'select',
      label: '证据类型',
      defaultValue: 'other',
      required: true,
      options: [
        { label: '原作截图', value: 'work_screenshot' },
        { label: '官方页面', value: 'official_page' },
        { label: '访谈', value: 'interview' },
        { label: '社交媒体', value: 'social_media' },
        { label: '旧站记录', value: 'legacy_wiki' },
        { label: '平台页面', value: 'platform_page' },
        { label: '其他', value: 'other' },
      ],
    },
    {
      name: 'reviewStatus',
      type: 'select',
      label: '复核状态',
      required: true,
      defaultValue: 'pending',
      options: reviewStatusOptions,
      admin: {
        description: '新站自己的复核状态，不表示旧站来源。',
      },
    },
    {
      name: 'evidenceStrength',
      type: 'select',
      label: '证据强度',
      required: true,
      defaultValue: 'unassessed',
      options: evidenceStrengthOptions,
      admin: {
        description: '按当前新站证据材料评估强弱；未评估不等于没有证据。',
      },
    },
    {
      name: 'relatedWorks',
      type: 'relationship',
      label: '关联作品',
      relationTo: 'works',
      hasMany: true,
    },
    {
      name: 'relatedCreators',
      type: 'relationship',
      label: '关联创作者',
      relationTo: 'creators',
      hasMany: true,
    },
    {
      name: 'relatedOrganizations',
      type: 'relationship',
      label: '关联机构',
      relationTo: 'organizations' as CollectionSlug,
      hasMany: true,
    },
    {
      name: 'image',
      type: 'upload',
      label: '证据截图',
      relationTo: 'media',
      admin: {
        description: '用于保存原作截图、页面截图或其他证据图片。',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      label: '说明',
    },
    {
      name: 'sourceLinks',
      type: 'array',
      label: '来源链接',
      fields: [
        { name: 'label', type: 'text', label: '名称' },
        { name: 'url', type: 'text', label: 'URL' },
      ],
    },
    {
      name: 'capturedAt',
      type: 'date',
      label: '截图时间',
      admin: {
        description: '记录截图或取证的大致时间。',
      },
    },
    {
      name: 'isPublic',
      type: 'checkbox',
      label: '前台公开展示',
      defaultValue: false,
      admin: {
        description: '关闭时只作为后台整理材料，不在前台展示。',
      },
    },
    {
      name: 'searchText',
      type: 'textarea',
      label: '搜索补充文本',
      admin: {
        description: '用于后续导出搜索索引的补充文本，不在数据库中建立 btree 索引。',
      },
    },
    {
      name: 'legacyXWikiPage',
      type: 'text',
      label: '旧 XWiki 页面',
      admin: {
        description: '旧站页面全名，仅用于迁移追踪。',
      },
    },
    {
      name: 'status',
      type: 'select',
      label: '状态',
      defaultValue: 'draft',
      required: true,
      options: evidenceStatusOptions,
    },
  ],
}
