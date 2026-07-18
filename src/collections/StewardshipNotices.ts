import type { Access, CollectionConfig } from 'payload'

import { adminsOnly, editorsAndUp } from '@/access/roles'

const publicNoticeOrSignedIn: Access = ({ req }) => req.user ? true : { isPublic: { equals: true } }

export const StewardshipNotices: CollectionConfig = {
  slug: 'stewardship-notices',
  labels: {
    singular: '站务提示',
    plural: '站务提示',
  },
  admin: {
    defaultColumns: ['title', 'category', 'tone', 'severity', 'isPublic', 'sortOrder', 'updatedAt'],
    group: '站务',
    useAsTitle: 'title',
  },
  access: {
    create: editorsAndUp,
    delete: adminsOnly,
    read: publicNoticeOrSignedIn,
    update: editorsAndUp,
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
      maxLength: 120,
    },
    {
      name: 'slug',
      type: 'text',
      label: '稳定代码 / Slug',
      required: true,
      unique: true,
      admin: {
        description: '用于导入、样式和长期追踪。创建后尽量不要修改，例如 identity-conflict。',
      },
    },
    {
      name: 'category',
      type: 'select',
      label: '类别',
      required: true,
      defaultValue: 'operation',
      options: [
        { label: '站务状态', value: 'operation' },
        { label: '用语解释', value: 'terminology' },
        { label: '身份与版本', value: 'identity' },
        { label: '编辑与裁量', value: 'editorial' },
        { label: '内容警示', value: 'content' },
        { label: '透明度说明', value: 'transparency' },
        { label: '其他', value: 'other' },
      ],
    },
    {
      name: 'tone',
      type: 'select',
      label: '显示样式',
      required: true,
      defaultValue: 'note',
      options: [
        { label: '说明', value: 'note' },
        { label: '注意', value: 'warning' },
        { label: '高风险', value: 'danger' },
        { label: '黑色裁决横幅', value: 'black-banner' },
      ],
    },
    {
      name: 'severity',
      type: 'select',
      label: '重要程度',
      required: true,
      defaultValue: 'low',
      options: [
        { label: '低', value: 'low' },
        { label: '中', value: 'medium' },
        { label: '高', value: 'high' },
        { label: '关键', value: 'critical' },
      ],
    },
    {
      name: 'summary',
      type: 'textarea',
      label: '公开提示文本',
      required: true,
      maxLength: 1200,
      admin: {
        description: '直接显示在条目标题与基础资料之间，应当简洁、可独立理解。',
      },
    },
    {
      name: 'details',
      type: 'richText',
      label: '详细说明',
      admin: {
        description: '可选。用于解释适用范围、站务依据和后续处理方式。',
      },
    },
    {
      name: 'helpUrl',
      type: 'text',
      label: '进一步说明链接',
      admin: {
        description: '可选。可以指向站点说明、透明度报告、规则页或其他公开页面。',
      },
    },
    {
      name: 'applicableCollections',
      type: 'select',
      label: '适用页面',
      hasMany: true,
      options: [
        { label: '作品', value: 'works' },
        { label: '创作者', value: 'creators' },
        { label: '机构', value: 'organizations' },
      ],
      admin: {
        description: '用于编辑提示，不作为强制限制；同一提示可适用于多个页面类型。',
      },
    },
    {
      name: 'sortOrder',
      type: 'number',
      label: '排序',
      defaultValue: 100,
      admin: {
        description: '数字越小越靠前。关键提示建议使用 0–20。',
      },
    },
    {
      name: 'isPublic',
      type: 'checkbox',
      label: '允许公开显示和选择',
      defaultValue: false,
      admin: {
        description: '关闭时保留历史记录，但普通用户不可见，也不会出现在日常编辑选择器中。',
      },
    },
  ],
}
