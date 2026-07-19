import type { CollectionConfig } from 'payload'

import { anyone, editorsAndUp } from '@/access/roles'

export const Warnings: CollectionConfig = {
  slug: 'warnings',
  admin: {
    defaultColumns: ['name', 'siteId', 'severity', 'category', 'updatedAt'],
    group: '内容',
    useAsTitle: 'name',
  },
  access: {
    create: editorsAndUp,
    delete: editorsAndUp,
    read: anyone,
    update: editorsAndUp,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'siteId',
      type: 'text',
      label: '站内 ID',
      unique: true,
      admin: {
        description: '本站内部稳定唯一标识，用于迁移、导入、跨来源合并和人工追踪。',
      },
    },
    {
      name: 'severity',
      type: 'select',
      defaultValue: 'medium',
      required: true,
      options: ['low', 'medium', 'high', 'critical'],
    },
    {
      name: 'category',
      type: 'select',
      defaultValue: 'content',
      required: true,
      options: ['content', 'relationship', 'creator', 'operation', 'other'],
    },
    {
      name: 'description',
      type: 'richText',
    },
    {
      name: 'relatedTerms',
      type: 'relationship',
      relationTo: 'terms',
      hasMany: true,
    },
  ],
}
