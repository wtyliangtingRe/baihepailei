import type { CollectionConfig } from 'payload'

import { publishedOrSignedIn, trustedAndUp } from '@/access/roles'

export const Works: CollectionConfig = {
  slug: 'works',
  labels: {
    singular: '作品',
    plural: '作品',
  },
  admin: {
    defaultColumns: ['title', 'rank', 'status', 'updatedAt'],
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
        description: '用于 URL 和导入匹配，例如 magical-girl-lyrical-nanoha。',
      },
    },
    {
      name: 'rank',
      type: 'select',
      label: '分级',
      required: true,
      defaultValue: 'unknown',
      options: [
        { label: 'S', value: 'S' },
        { label: 'AA', value: 'AA' },
        { label: 'A', value: 'A' },
        { label: 'B', value: 'B' },
        { label: 'C', value: 'C' },
        { label: 'D', value: 'D' },
        { label: 'E', value: 'E' },
        { label: 'F', value: 'F' },
        { label: '垃圾', value: 'trash' },
        { label: '未知', value: 'unknown' },
      ],
    },
    {
      name: 'originalTitle',
      type: 'text',
      label: '原名',
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
      name: 'creators',
      type: 'relationship',
      label: '创作者',
      relationTo: 'creators',
      hasMany: true,
    },
    {
      name: 'tags',
      type: 'relationship',
      label: '标签',
      relationTo: 'tags',
      hasMany: true,
    },
    {
      name: 'warnings',
      type: 'relationship',
      label: '注意点',
      relationTo: 'warnings',
      hasMany: true,
    },
    {
      name: 'cover',
      type: 'upload',
      label: '封面',
      relationTo: 'media',
    },
    {
      name: 'summary',
      type: 'richText',
      label: '摘要',
    },
    {
      name: 'analysis',
      type: 'richText',
      label: '分析',
    },
    {
      name: 'sourceLinks',
      type: 'array',
      label: '来源链接',
      fields: [
        {
          name: 'label',
          type: 'text',
          label: '名称',
        },
        {
          name: 'url',
          type: 'text',
          label: 'URL',
        },
      ],
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
      options: [
        { label: '草稿', value: 'draft' },
        { label: '待审核', value: 'review' },
        { label: '已发布', value: 'published' },
        { label: '归档', value: 'archived' },
      ],
    },
  ],
}
