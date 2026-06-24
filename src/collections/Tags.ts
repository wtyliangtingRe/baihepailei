import type { CollectionConfig } from 'payload'

import { anyone, trustedAndUp } from '@/access/roles'

export const Tags: CollectionConfig = {
  slug: 'tags',
  labels: {
    singular: '标签',
    plural: '标签',
  },
  admin: {
    defaultColumns: ['name', 'slug', 'category', 'updatedAt'],
    group: '内容',
    useAsTitle: 'name',
  },
  access: {
    create: trustedAndUp,
    delete: trustedAndUp,
    read: anyone,
    update: trustedAndUp,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: '名称',
      required: true,
      unique: true,
    },
    {
      name: 'slug',
      type: 'text',
      label: 'Slug',
      required: true,
      unique: true,
      admin: {
        description: '用于 URL 和导入匹配，例如 magical-girl。',
      },
    },
    {
      name: 'category',
      type: 'select',
      label: '分类',
      defaultValue: 'general',
      required: true,
      options: [
        { label: '通用', value: 'general' },
        { label: '题材', value: 'genre' },
        { label: '媒介', value: 'medium' },
        { label: '关系', value: 'relationship' },
        { label: '风格', value: 'style' },
        { label: '状态', value: 'status' },
      ],
    },
    {
      name: 'description',
      type: 'textarea',
      label: '说明',
    },
  ],
}
