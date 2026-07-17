import type { Access, CollectionConfig } from 'payload'

import { isEditor, signedIn } from '@/access/roles'

type CommentUser = {
  id?: string | number
  email?: string
  displayName?: string
}

const visibleCommentsOrStaff: Access = ({ req }) => {
  if (isEditor(req.user)) return true

  return {
    or: [
      { moderationStatus: { equals: 'approved' } },
      { moderationStatus: { equals: 'pending' } },
    ],
  }
}

const ownCommentOrStaff: Access = ({ req }) => {
  if (isEditor(req.user)) return true
  if (!req.user) return false
  const userID = (req.user as CommentUser).id
  if (userID === undefined || userID === null) return false
  return {
    author: {
      equals: userID,
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
  { label: '旧待审核（按公开处理）', value: 'pending' },
  { label: '已公开', value: 'approved' },
  { label: '旧已拒绝', value: 'rejected' },
  { label: '已隐藏', value: 'hidden' },
]

export const Comments: CollectionConfig = {
  slug: 'comments',
  labels: {
    singular: '评论',
    plural: '评论',
  },
  admin: {
    defaultColumns: ['targetTitle', 'authorName', 'createdAt'],
    group: '互动',
    useAsTitle: 'targetTitle',
  },
  access: {
    create: signedIn,
    delete: ownCommentOrStaff,
    read: visibleCommentsOrStaff,
    update: ({ req }) => isEditor(req.user),
  },
  hooks: {
    beforeChange: [
      ({ data, operation, originalDoc, req }) => {
        if (operation !== 'create') {
          if (!isEditor(req.user)) {
            return {
              ...data,
              author: originalDoc?.author,
              authorName: originalDoc?.authorName,
              moderationStatus: originalDoc?.moderationStatus,
            }
          }
          return data
        }

        const user = req.user as CommentUser | undefined
        return {
          ...data,
          author: user?.id,
          authorName: user?.displayName || user?.email || '注册用户',
          moderationStatus: 'approved',
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
    { name: 'targetSlug', type: 'text', label: '评论对象 Slug', required: true, maxLength: 200 },
    { name: 'targetTitle', type: 'text', label: '评论对象标题', required: true, maxLength: 200 },
    {
      name: 'author',
      type: 'relationship',
      label: '作者账户',
      relationTo: 'users',
      admin: { readOnly: true },
    },
    { name: 'authorName', type: 'text', label: '显示名称', admin: { readOnly: true } },
    {
      name: 'body',
      type: 'textarea',
      label: '评论内容',
      required: true,
      minLength: 2,
      maxLength: 1200,
      admin: {
        description: '短评、阅读感想，或提醒条目需要复核。纯文本，提交后立即公开。',
      },
    },
    {
      name: 'moderationStatus',
      type: 'select',
      label: '审核状态',
      defaultValue: 'approved',
      required: true,
      options: moderationStatusOptions,
      admin: {
        hidden: true,
      },
    },
  ],
}
