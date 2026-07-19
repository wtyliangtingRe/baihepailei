import type { CollectionConfig } from 'payload'

import { adminsOnly, ownerOnly } from '@/access/roles'

export const AuditEvents: CollectionConfig = {
  slug: 'audit-events',
  labels: { singular: '内容审计事件', plural: '内容审计事件' },
  admin: {
    defaultColumns: ['createdAt', 'action', 'targetCollection', 'targetID', 'actor'],
    group: '系统',
    useAsTitle: 'action',
    description: '记录内容、账户和互动写入的操作者、对象与变更摘要。仅管理人员可见，不能从后台手工伪造。',
  },
  access: {
    // Only server-side audit hooks use overrideAccess to append events.\n    create: () => false,
    read: adminsOnly,
    update: ownerOnly,
    delete: ownerOnly,
  },
  fields: [
    { name: 'actor', type: 'relationship', label: '操作人', relationTo: 'users', required: true, admin: { readOnly: true } },
    { name: 'action', type: 'text', label: '动作', required: true, maxLength: 120 },
    { name: 'targetCollection', type: 'text', label: '目标集合', required: true, maxLength: 120 },
    { name: 'targetID', type: 'text', label: '目标 ID', required: true, maxLength: 160 },
    { name: 'targetTitle', type: 'text', label: '目标标题', maxLength: 300 },
    { name: 'summary', type: 'textarea', label: '变更摘要', maxLength: 4000 },
    { name: 'metadata', type: 'json', label: '结构化元数据', admin: { description: '只保存必要的字段差异；不要写入密码、token 或完整证据图片。' } },
  ],
}
