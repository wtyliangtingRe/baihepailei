import type { Access, CollectionConfig, CollectionSlug } from 'payload'

import { trustedAndUp } from '@/access/roles'

const reviewStatusOptions = [
  { label: '待复核', value: 'pending' }, { label: '已复核', value: 'reviewed' },
  { label: '有争议', value: 'disputed' }, { label: '已废弃', value: 'deprecated' },
]
const evidenceStrengthOptions = [
  { label: '未评估', value: 'unassessed' }, { label: '弱', value: 'weak' }, { label: '中', value: 'medium' }, { label: '强', value: 'strong' },
]
const evidenceStatusOptions = [
  { label: '草稿', value: 'draft' }, { label: '待审核', value: 'review' }, { label: '已确认', value: 'confirmed' }, { label: '归档', value: 'archived' },
]

const publicEvidenceOrSignedIn: Access = ({ req }) => req.user ? true : { status: { equals: 'confirmed' }, isPublic: { equals: true } }

export const Evidence: CollectionConfig = {
  slug: 'evidence',
  labels: { singular: '证据材料', plural: '证据材料' },
  admin: { defaultColumns: ['title', 'siteId', 'evidenceType', 'reviewStatus', 'evidenceStrength', 'isPublic', 'status', 'updatedAt'], group: '内容', useAsTitle: 'title' },
  access: { create: trustedAndUp, delete: trustedAndUp, read: publicEvidenceOrSignedIn, update: trustedAndUp },
  versions: { drafts: true },
  fields: [
    { name: 'title', type: 'text', label: '标题', required: true },
    { name: 'slug', type: 'text', label: 'Slug', required: true, unique: true, admin: { description: '用于导入匹配和详情页 URL。' } },
    { name: 'siteId', type: 'text', label: '站内 ID', unique: true, admin: { description: '本站内部稳定唯一标识，用于导入、跨来源合并和人工追踪。' } },
    {
      name: 'evidenceType', type: 'select', label: '证据类型', defaultValue: 'other', required: true,
      options: [
        { label: '原作截图', value: 'work_screenshot' }, { label: '官方页面', value: 'official_page' },
        { label: '访谈', value: 'interview' }, { label: '社交媒体', value: 'social_media' },
        { label: '历史归档记录', value: 'legacy_wiki' }, { label: '平台页面', value: 'platform_page' }, { label: '其他', value: 'other' },
      ],
    },
    { name: 'reviewStatus', type: 'select', label: '复核状态', required: true, defaultValue: 'pending', options: reviewStatusOptions, admin: { description: '本站的人工复核状态。' } },
    { name: 'evidenceStrength', type: 'select', label: '证据强度', required: true, defaultValue: 'unassessed', options: evidenceStrengthOptions, admin: { description: '按本站当前证据材料评估强弱；未评估不等于没有证据。' } },
    { name: 'relatedWorks', type: 'relationship', label: '关联作品', relationTo: 'works', hasMany: true },
    { name: 'relatedCreators', type: 'relationship', label: '关联创作者', relationTo: 'creators', hasMany: true },
    { name: 'relatedOrganizations', type: 'relationship', label: '关联机构', relationTo: 'organizations' as CollectionSlug, hasMany: true },
    { name: 'image', type: 'upload', label: '证据截图', relationTo: 'media', admin: { description: '用于内部材料留存和增强媒体版；低流量正式版不会公开渲染。' } },
    { name: 'description', type: 'textarea', label: '说明' },
    { name: 'sourceLinks', type: 'array', label: '来源链接', fields: [{ name: 'label', type: 'text', label: '名称' }, { name: 'url', type: 'text', label: 'URL' }] },
    { name: 'capturedAt', type: 'date', label: '截图时间', admin: { description: '记录截图或取证的大致时间。' } },
    { name: 'isPublic', type: 'checkbox', label: '允许增强版前台展示', defaultValue: false, admin: { description: '关闭时只作为后台整理材料。低流量正式版无论此项如何都不渲染图片。' } },
    { name: 'searchText', type: 'textarea', label: '搜索补充文本', admin: { description: '用于导出搜索索引的补充文本。' } },
    { name: 'status', type: 'select', label: '状态', defaultValue: 'draft', required: true, options: evidenceStatusOptions },
  ],
}
