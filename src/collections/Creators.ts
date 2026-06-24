import type { CollectionConfig } from 'payload'

import { publishedOrSignedIn, trustedAndUp } from '@/access/roles'

export const Creators: CollectionConfig = {
  slug: 'creators',
  labels: {
    singular: '创作者',
    plural: '创作者',
  },
  admin: {
    defaultColumns: ['name', 'rank', 'status', 'updatedAt'],
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
      name: 'rank',
      type: 'select',
      label: '分级',
      options: ['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'unknown'],
    },
    {
      name: 'aliases',
      type: 'array',
      label: '别名',
      fields: [
        {
          name: 'value',
          type: 'text',
          label: '别名',
        },
      ],
    },
    {
      name: 'profileImage',
      type: 'upload',
      label: '头像/图片',
      relationTo: 'media',
    },
    {
      name: 'notes',
      type: 'richText',
      label: '备注',
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
