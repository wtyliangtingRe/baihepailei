import type { CollectionConfig } from 'payload'

import { adminsOnly } from '@/access/roles'

export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: {
    defaultColumns: ['email', 'role', 'updatedAt'],
    group: '系统',
    useAsTitle: 'email',
  },
  access: {
    create: adminsOnly,
    delete: adminsOnly,
    read: adminsOnly,
    update: adminsOnly,
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      defaultValue: 'admin',
      required: true,
      options: [
        { label: '管理员', value: 'admin' },
        { label: '编辑', value: 'editor' },
        { label: '审核', value: 'reviewer' },
        { label: '可信投稿者', value: 'trusted' },
      ],
    },
    {
      name: 'displayName',
      type: 'text',
      label: '显示名',
    },
  ],
}
