import type { CollectionConfig } from 'payload'

import { publishedOrSignedIn, trustedAndUp } from '@/access/roles'

import { localizedNamesField } from './fields/localizedMetadata'
import { contentReviewFields } from './fields/contentReview'

export const Organizations: CollectionConfig = {
  slug: 'organizations',
  labels: { singular: '机构', plural: '机构' },
  admin: { defaultColumns: ['name', 'siteId', 'type', 'reviewStatus', 'reviewOrigin', 'status', 'updatedAt'], group: '内容', useAsTitle: 'name' },
  access: { create: trustedAndUp, delete: trustedAndUp, read: publishedOrSignedIn, update: trustedAndUp },
  versions: { drafts: true },
  fields: [
    { name: 'name', type: 'text', label: '名称', required: true },
    { name: 'slug', type: 'text', label: 'Slug', required: true, unique: true, admin: { description: '仅用于旧链接兼容和导入匹配。公开规范网址使用本站 Organizations 数据库 ID。' } },
    { name: 'siteId', type: 'text', label: '导入追踪 ID（兼容）', unique: true, admin: { description: '历史导入与跨来源合并用的追踪值；不作为公开网址，也不等于 Organizations 数据库主键。' } },
    {
      name: 'type', type: 'select', label: '机构类型', defaultValue: 'other', required: true,
      options: [
        { label: '出版社', value: 'publisher' }, { label: '制作公司', value: 'production_company' },
        { label: '动画公司', value: 'animation_studio' }, { label: '游戏公司', value: 'game_company' },
        { label: '发行商', value: 'distributor' }, { label: '社团', value: 'circle' }, { label: '品牌', value: 'brand' },
        { label: '平台', value: 'platform' }, { label: '制作委员会', value: 'committee' }, { label: '其他', value: 'other' },
      ],
    },
    ...contentReviewFields(),
    { name: 'aliases', type: 'array', label: '别名', fields: [{ name: 'value', type: 'text', label: '别名' }] },
    localizedNamesField(),
    { name: 'notes', type: 'richText', label: '备注' },
    { name: 'sourceLinks', type: 'array', label: '来源链接', fields: [{ name: 'label', type: 'text', label: '名称' }, { name: 'url', type: 'text', label: 'URL' }] },
    { name: 'searchText', type: 'textarea', label: '搜索补充文本', admin: { description: '用于导出前台搜索索引的补充文本，可放别名、历史名称、官网名、品牌名和作品关键词等。' } },
    { name: 'isLiteVisible', type: 'checkbox', label: '进入 Lite 文字版', defaultValue: true },
    { name: 'isFullVisible', type: 'checkbox', label: '进入 Full 完整版', defaultValue: true },
    { name: 'legacyXWikiPage', type: 'text', admin: { hidden: true } },
    { name: 'status', type: 'select', label: '状态', defaultValue: 'draft', required: true, options: ['draft', 'review', 'published', 'archived'] },
  ],
}
