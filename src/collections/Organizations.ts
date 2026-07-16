import type { CollectionConfig } from 'payload'

import { publishedOrSignedIn, trustedAndUp } from '@/access/roles'

import { localizedNamesField } from './fields/localizedMetadata'

export const Organizations: CollectionConfig = {
  slug: 'organizations',
  labels: { singular: '机构', plural: '机构' },
  admin: { defaultColumns: ['name', 'siteId', 'type', 'isLiteVisible', 'isFullVisible', 'status', 'updatedAt'], group: '内容', useAsTitle: 'name' },
  access: { create: trustedAndUp, delete: trustedAndUp, read: publishedOrSignedIn, update: trustedAndUp },
  versions: { drafts: true },
  fields: [
    { name: 'name', type: 'text', label: '名称', required: true },
    { name: 'slug', type: 'text', label: 'Slug', required: true, unique: true, admin: { description: '用于 URL 和导入匹配，例如 hobunsha、studio-example。' } },
    { name: 'siteId', type: 'text', label: '站内 ID', unique: true, admin: { description: '本站内部稳定唯一标识，用于导入、跨来源合并和人工追踪。' } },
    {
      name: 'type', type: 'select', label: '机构类型', defaultValue: 'other', required: true,
      options: [
        { label: '出版社', value: 'publisher' }, { label: '制作公司', value: 'production_company' },
        { label: '动画公司', value: 'animation_studio' }, { label: '游戏公司', value: 'game_company' },
        { label: '发行商', value: 'distributor' }, { label: '社团', value: 'circle' }, { label: '品牌', value: 'brand' },
        { label: '平台', value: 'platform' }, { label: '制作委员会', value: 'committee' }, { label: '其他', value: 'other' },
      ],
    },
    { name: 'aliases', type: 'array', label: '别名', fields: [{ name: 'value', type: 'text', label: '别名' }] },
    localizedNamesField(),
    { name: 'notes', type: 'richText', label: '备注' },
    { name: 'sourceLinks', type: 'array', label: '来源链接', fields: [{ name: 'label', type: 'text', label: '名称' }, { name: 'url', type: 'text', label: 'URL' }] },
    { name: 'searchText', type: 'textarea', label: '搜索补充文本', admin: { description: '用于导出前台搜索索引的补充文本，可放别名、历史名称、官网名、品牌名和作品关键词等。' } },
    { name: 'isLiteVisible', type: 'checkbox', label: '进入 Lite 文字版', defaultValue: true },
    { name: 'isFullVisible', type: 'checkbox', label: '进入 Full 完整版', defaultValue: true },
    { name: 'status', type: 'select', label: '状态', defaultValue: 'draft', required: true, options: ['draft', 'review', 'published', 'archived'] },
  ],
}
