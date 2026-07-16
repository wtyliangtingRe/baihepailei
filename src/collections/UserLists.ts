import type { Access, CollectionConfig } from 'payload'

import { isOwner, signedIn } from '@/access/roles'

type ListUser = {
  id?: string | number
}

const ownListOrOwner: Access = ({ req }) => {
  if (isOwner(req.user)) return true
  if (!req.user) return false

  return {
    user: {
      equals: (req.user as ListUser).id,
    },
  }
}

const ownListOnly: Access = ({ req }) => {
  if (!req.user) return false
  return {
    user: {
      equals: (req.user as ListUser).id,
    },
  }
}

const listStatusOptions = [
  { label: '想看', value: 'want' },
  { label: '在看', value: 'watching' },
  { label: '已看', value: 'seen' },
  { label: '喜欢', value: 'favorite' },
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
    delete: ownListOrOwner,
    read: ownListOrOwner,
    update: ownListOnly,
  },
  hooks: {
    beforeValidate: [
      ({ data, req }) => {
        const user = req.user as ListUser | undefined
        if (!user?.id || !data?.workSlug) return data

        return {
          ...data,
          user: user.id,
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
      admin: { readOnly: true },
    },
    { name: 'workSlug', type: 'text', label: '作品 Slug', required: true, maxLength: 200 },
    { name: 'workTitle', type: 'text', label: '作品标题', required: true, maxLength: 200 },
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
      maxLength: 500,
      admin: { description: '仅用于自己的列表记录。' },
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
