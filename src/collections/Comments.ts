import type { Access, CollectionConfig } from 'payload'

import { editorsAndUp, signedIn } from '@/access/roles'

const approvedCommentsOrSignedIn: Access = ({ req }) => {
  if (req.user) return true

  return {
    moderationStatus: {
      equals: 'approved',
    },
  }
}

const targetCollectionOptions = [
  { label: '作品', value: 'works' },
  { label: '创作者', value: 'creators' },
  { label: '机构', value: 'organizations' },
  { label: '证据材料', value: 'evidence' },
  { label: '名词解释', value: 'terms' },
  { label: '规则', value: 'rules' },
]

const moderationStatusOptions = [
  { label: '待审核', value: 'pending' },
  { label: '已公开', value: 'approved' },
  { label: '已拒绝', value: 'rejected' },
  { label: '已隐藏', value: 'hidden' },
]

export const Comments: CollectionConfig = {
  slug: 'comments',
  labels: {
    singular: '评论',
    plural: '评论',
  },
  admin: {
    defaultColumns: ['targetTitle', 'authorName', 'moderationStatus', 'createdAt'],
    group: '互动',
    useAsTitle: 'targetTitle',
  },
  access: {
    create: signedIn,
    delete: editorsAndUp,
    read: approvedCommentsOrSignedIn,
    update: editorsAndUp,
  },
  hooks: {
    beforeChange: [
      ({ data, operation, req }) => {
        if (operation !== 'create') return data

        const user = req.user as { id?: string | number; email?: string; displayName?: string } | undefined
        const authorName = user?.displayName || user?.email || '注册用户'

        return {
          ...data,
          author: user?.id,
          authorName,
          moderationStatus: 'pending',
        }
      },
    ],
  },
  fields: [
    {
      name: 'targetCollection',
      type: 'select',
      label: '评论对象类型',
      required: true,
      options: targetCollectionOptions,
    },
    {
      name: 'targetSlug',
      type: 'text',
      label: '评论对象 Slug',
      required: true,
    },
    {
      name: 'targetTitle',
      type: 'text',
      label: '评论对象标题',
      required: true,
    },
    {
      name: 'author',
      type: 'relationship',
      label: '作者账户',
      relationTo: 'users',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'authorName',
      type: 'text',
      label: '显示名称',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'body',
      type: 'textarea',
      label: '评论内容',
      required: true,
      admin: {
        description: '短评、补充阅读感想，或提醒条目需要复核。',
      },
    },
    {
      name: 'moderationStatus',
      type: 'select',
      label: '审核状态',
      defaultValue: 'pending',
      required: true,
      options: moderationStatusOptions,
    },
  ],
}
