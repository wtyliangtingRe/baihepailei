import type { Access, CollectionConfig } from 'payload'

import { editorsAndUp, signedIn } from '@/access/roles'

type ListUser = {
  id?: string | number
  role?: string
}

function canManageLists(user: unknown) {
  if (!user || typeof user !== 'object') return false
  const role = (user as ListUser).role
  return role === 'admin' || role === 'editor' || role === 'reviewer'
}

const ownListOrEditor: Access = ({ req }) => {
  if (canManageLists(req.user)) return true
  if (!req.user) return false

  return {
    user: {
      equals: (req.user as ListUser).id,
    },
  }
}

const listStatusOptions = [
  { label: '想看', value: 'want' },
  { label: '已看', value: 'seen' },
  { label: '避雷', value: 'avoid' },
  { label: '需要复核', value: 'needs_review' },
]

export const UserLists: CollectionConfig = {
  slug: 'user-lists',
  labels: {
    singular: '用户列表',
    plural: '用户列表',
  },
  admin: {
    defaultColumns: ['workTitle', 'listStatus', 'user', 'updatedAt'],
    group: '互动',
    useAsTitle: 'workTitle',
  },
  access: {
    create: signedIn,
    delete: ownListOrEditor,
    read: ownListOrEditor,
    update: ownListOrEditor,
  },
  hooks: {
    beforeChange: [
      ({ data, operation, req }) => {
        const user = req.user as ListUser | undefined
        if (!user?.id) return data

        return {
          ...data,
          user: operation === 'create' ? user.id : data.user || user.id,
          uniqueKey: `${user.id}:${data.workSlug}`,
        }
      },
    ],
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      label: '用户',
      relationTo: 'users',
      required: true,
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'workSlug',
      type: 'text',
      label: '作品 Slug',
      required: true,
    },
    {
      name: 'workTitle',
      type: 'text',
      label: '作品标题',
      required: true,
    },
    {
      name: 'listStatus',
      type: 'select',
      label: '列表状态',
      required: true,
      defaultValue: 'want',
      options: listStatusOptions,
    },
    {
      name: 'note',
      type: 'textarea',
      label: '私人备注',
      admin: {
        description: '仅用于自己的列表记录。',
      },
    },
    {
      name: 'uniqueKey',
      type: 'text',
      label: '唯一键',
      unique: true,
      admin: {
        readOnly: true,
        description: '用户和作品 slug 组成的唯一键，用于避免重复加入同一作品。',
      },
    },
  ],
}
