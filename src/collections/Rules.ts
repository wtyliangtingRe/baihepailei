import type { CollectionConfig } from 'payload'

import { publishedOrSignedIn, trustedAndUp } from '@/access/roles'

export const Rules: CollectionConfig = {
  slug: 'rules',
  admin: {
    defaultColumns: ['title', 'category', 'status', 'updatedAt'],
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
      name: 'body',
      type: 'richText',
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
      name: 'searchText',
      type: 'textarea',
      label: '搜索补充文本',
      index: true,
      admin: {
        description: '用于搜索索引的补充文本。可放规则别名、旧站关键词等。',
      },
    },
    {
      name: 'isLiteVisible',
      type: 'checkbox',
      label: '进入 Lite 文字版',
      defaultValue: true,
    },
    {
      name: 'isFullVisible',
      type: 'checkbox',
      label: '进入 Full 完整版',
      defaultValue: true,
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
