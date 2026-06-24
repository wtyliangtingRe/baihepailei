import type { CollectionConfig } from 'payload'

import { publishedOrSignedIn, trustedAndUp } from '@/access/roles'

export const Rules: CollectionConfig = {
  slug: 'rules',
  admin: {
    defaultColumns: ['title', 'category', 'isLiteVisible', 'isFullVisible', 'status', 'updatedAt'],
    group: '内容',
    useAsTitle: 'title',
  },
  access: {
    create: trustedAndUp,
    delete: trustedAndUp,
    read: publishedOrSignedIn,
    update: trustedAndUp,
  },
  versions: {
    drafts: true,
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'category',
      type: 'select',
      defaultValue: 'principle',
      required: true,
      options: ['principle', 'ranking', 'editorial', 'migration'],
    },
    {
      name: 'isLiteVisible',
      type: 'checkbox',
      label: 'Lite 文字版可见',
      defaultValue: true,
    },
    {
      name: 'isFullVisible',
      type: 'checkbox',
      label: 'Full 完整版可见',
      defaultValue: true,
    },
    {
      name: 'body',
      type: 'richText',
    },
    {
      name: 'searchText',
      type: 'textarea',
      label: '搜索文本',
      admin: {
        description: '用于生成搜索索引。可包含标题、分类、旧页面名、规则正文关键词等。',
        rows: 6,
      },
    },
    {
      name: 'relatedWarnings',
      type: 'relationship',
      relationTo: 'warnings',
      hasMany: true,
    },
    {
      name: 'relatedTags',
      type: 'relationship',
      relationTo: 'tags',
      hasMany: true,
    },
    {
      name: 'legacyXWikiPage',
      type: 'text',
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'draft',
      required: true,
      options: ['draft', 'review', 'published', 'archived'],
    },
  ],
}
