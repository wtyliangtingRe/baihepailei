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
      defaultValue: true,
    },
    {
      name: 'isFullVisible',
      type: 'checkbox',
      defaultValue: true,
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
      admin: {
        description: '用于导出前台搜索索引的长文本，不在数据库中建立 btree 索引。',
      },
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
