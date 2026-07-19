import type { CollectionConfig } from 'payload'

import { publishedOrSignedIn, editorsAndUp } from '@/access/roles'

export const Rules: CollectionConfig = {
  slug: 'rules',
  admin: { defaultColumns: ['title', 'siteId', 'category', 'isLiteVisible', 'isFullVisible', 'status', 'updatedAt'], group: '内容', useAsTitle: 'title' },
  access: { create: editorsAndUp, delete: editorsAndUp, read: publishedOrSignedIn, update: editorsAndUp },
  versions: { drafts: true },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true },
    { name: 'siteId', type: 'text', label: '站内 ID', unique: true, admin: { description: '本站内部稳定唯一标识，用于导入、跨来源合并和人工追踪。' } },
    { name: 'category', type: 'select', defaultValue: 'principle', required: true, options: ['principle', 'ranking', 'editorial', 'migration'] },
    { name: 'isLiteVisible', type: 'checkbox', defaultValue: true },
    { name: 'isFullVisible', type: 'checkbox', label: '旧 Full 可见标记（兼容保留）', defaultValue: true, admin: { description: '完整版现默认收录全部记录；仅为旧导出器兼容保留。' } },
    { name: 'body', type: 'richText' },
    { name: 'relatedWarnings', type: 'relationship', relationTo: 'warnings', hasMany: true },
    { name: 'relatedTags', type: 'relationship', relationTo: 'tags', hasMany: true },
    { name: 'searchText', type: 'textarea', admin: { description: '用于导出前台搜索索引的长文本。' } },
    { name: 'legacyXWikiPage', type: 'text', admin: { hidden: true } },
    { name: 'status', type: 'select', defaultValue: 'draft', required: true, options: ['draft', 'review', 'published', 'archived'] },
  ],
}
