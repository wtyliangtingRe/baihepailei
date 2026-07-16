import type { CollectionConfig } from 'payload'

import { publishedOrSignedIn, trustedAndUp } from '@/access/roles'

export const Terms: CollectionConfig = {
  slug: 'terms',
  labels: { singular: '名词解释', plural: '名词解释' },
  admin: { defaultColumns: ['name', 'siteId', 'isLiteVisible', 'isFullVisible', 'status', 'updatedAt'], group: '内容', useAsTitle: 'name' },
  access: { create: trustedAndUp, delete: trustedAndUp, read: publishedOrSignedIn, update: trustedAndUp },
  versions: { drafts: true },
  fields: [
    { name: 'name', type: 'text', label: '名称', required: true },
    { name: 'slug', type: 'text', label: 'Slug', required: true, unique: true },
    { name: 'siteId', type: 'text', label: '站内 ID', unique: true, admin: { description: '本站内部稳定唯一标识，用于导入、跨来源合并和人工追踪。' } },
    { name: 'isLiteVisible', type: 'checkbox', label: '进入 Lite 文字版', defaultValue: true },
    { name: 'isFullVisible', type: 'checkbox', label: '进入 Full 完整版', defaultValue: true },
    { name: 'definition', type: 'richText', label: '定义' },
    { name: 'examples', type: 'relationship', label: '相关作品', relationTo: 'works', hasMany: true },
    { name: 'relatedWarnings', type: 'relationship', label: '相关注意点', relationTo: 'warnings', hasMany: true },
    { name: 'relatedTerms', type: 'relationship', label: '相关名词', relationTo: 'terms', hasMany: true },
    { name: 'searchText', type: 'textarea', label: '搜索补充文本', admin: { description: '用于导出前台搜索索引的补充文本。' } },
    { name: 'legacyXWikiPage', type: 'text', admin: { hidden: true } },
    { name: 'status', type: 'select', label: '状态', defaultValue: 'draft', required: true, options: ['draft', 'review', 'published', 'archived'] },
  ],
}
