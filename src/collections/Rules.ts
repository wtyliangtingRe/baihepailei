import type { CollectionConfig } from 'payload'

import { publishedOrSignedIn, trustedAndUp } from '@/access/roles'

export const Rules: CollectionConfig = {
  slug: 'rules',
  admin: { defaultColumns: ['title', 'siteId', 'category', 'isLiteVisible', 'isFullVisible', 'status', 'updatedAt'], group: '内容', useAsTitle: 'title' },
  access: { create: trustedAndUp, delete: trustedAndUp, read: publishedOrSignedIn, update: trustedAndUp },
  versions: { drafts: true },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true },
    { name: 'siteId', type: 'text', label: '站内 ID', unique: true, admin: { description: '本站内部稳定唯一标识，用于导入、跨来源合并和人工追踪。' } },
    { name: 'category', type: 'select', defaultValue: 'principle', required: true, options: ['principle', 'ranking', 'editorial', 'migration'] },
    { name: 'isLiteVisible', type: 'checkbox', defaultValue: true },
    { name: 'isFullVisible', type: 'checkbox', defaultValue: true },
    { name: 'body', type: 'richText' },
    { name: 'relatedWarnings', type: 'relationship', relationTo: 'warnings', hasMany: true },
    { name: 'relatedTags', type: 'relationship', relationTo: 'tags', hasMany: true },
    { name: 'searchText', type: 'textarea', admin: { description: '用于导出前台搜索索引的长文本。' } },
    { name: 'status', type: 'select', defaultValue: 'draft', required: true, options: ['draft', 'review', 'published', 'archived'] },
  ],
}
