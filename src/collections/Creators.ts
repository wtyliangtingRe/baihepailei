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
      name: 'searchText',
      type: 'textarea',
      label: '搜索补充文本',
      admin: {
        description: '用于导出前台搜索索引的补充文本，不在数据库中建立 btree 索引。可放别名、社团名、旧名、作品关键词等。',
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
