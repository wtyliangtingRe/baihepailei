import type { CollectionConfig } from 'payload'

import { publishedOrSignedIn, trustedAndUp } from '@/access/roles'

export const Terms: CollectionConfig = {
  slug: 'terms',
  labels: {
    singular: '名词解释',
    plural: '名词解释',
  },
  admin: {
    defaultColumns: ['name', 'isLiteVisible', 'isFullVisible', 'status', 'updatedAt'],
    group: '内容',
    useAsTitle: 'name',
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
      name: 'name',
      type: 'text',
      label: '名称',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      label: 'Slug',
      required: true,
      unique: true,
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
      name: 'definition',
      type: 'richText',
      label: '定义',
    },
    {
      name: 'examples',
      type: 'relationship',
      label: '相关作品',
      relationTo: 'works',
      hasMany: true,
    },
    {
      name: 'relatedWarnings',
      type: 'relationship',
      label: '相关注意点',
      relationTo: 'warnings',
      hasMany: true,
    },
    {
      name: 'relatedTerms',
      type: 'relationship',
      label: '相关名词',
      relationTo: 'terms',
      hasMany: true,
    },
    {
      name: 'searchText',
      type: 'textarea',
      label: 'Search text',
      index: true,
    },
    {
      name: 'legacyXWikiPage',
      type: 'text',
      label: '旧 XWiki 页面',
    },
    {
      name: 'status',
      type: 'select',
      label: '状态',
      defaultValue: 'draft',
      required: true,
      options: ['draft', 'review', 'published', 'archived'],
    },
  ],
}
