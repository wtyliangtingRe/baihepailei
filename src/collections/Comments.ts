import { APIError, type Access, type CollectionConfig } from 'payload'

import { isEditor, signedIn } from '@/access/roles'
import { recordAuditEvent } from '@/lib/audit'

type CommentUser = {
  id?: string | number
  email?: string
  displayName?: string
}

type CommentRelation = string | number | { id?: string | number } | null | undefined

function relationID(value: CommentRelation) {
  if (value && typeof value === 'object') return value.id
  return value
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
      async ({ data, operation, originalDoc, req }) => {
        if (operation !== 'create') {
          if (!isEditor(req.user)) {
            return {
              ...data,
              author: originalDoc?.author,
              authorName: originalDoc?.authorName,
              moderationStatus: originalDoc?.moderationStatus,
              reportCount: originalDoc?.reportCount,
              reportedBy: originalDoc?.reportedBy,
              hiddenReason: originalDoc?.hiddenReason,
            }
          }
          return data
        }

        const user = req.user as CommentUser | undefined
        if (!user?.id) throw new APIError('请先登录后再发表评论。', 401)
        const recentSince = new Date(Date.now() - 10 * 60 * 1000).toISOString()
        const recent = await req.payload.find({
          collection: 'comments',
          depth: 0,
          limit: 6,
          pagination: false,
          overrideAccess: true,
          where: {
            and: [
              { author: { equals: user.id } },
              { createdAt: { greater_than: recentSince } },
            ],
          },
        })
        if (recent.totalDocs >= 5) {
          throw new APIError('评论发送过于频繁，请十分钟后再试。', 429, { code: 'comment_rate_limited' }, true)
        }
        const normalizedBody = String(data?.body || '').trim().toLowerCase()
        if (normalizedBody && recent.docs.some((comment) => String(comment.body || '').trim().toLowerCase() === normalizedBody)) {
          throw new APIError('请不要重复发送相同评论。', 409, { code: 'duplicate_comment' }, true)
        }
        const requestedParentID = relationID(data?.parentComment as CommentRelation)
        let replyFields: Record<string, unknown> = {
          parentComment: undefined,
          replyToName: undefined,
        }

        if (requestedParentID !== undefined && requestedParentID !== null && String(requestedParentID).trim()) {
          const parent = await req.payload.findByID({
            collection: 'comments',
            id: requestedParentID,
            depth: 0,
            overrideAccess: true,
          })
          if (!['approved', 'pending'].includes(String(parent.moderationStatus || ''))) {
            throw new Error('不能回复已隐藏或已拒绝的评论。')
          }
          const rootParentID = relationID(parent.parentComment as CommentRelation) || parent.id
          replyFields = {
            parentComment: rootParentID,
            replyToName: parent.authorName || '注册用户',
            targetCollection: parent.targetCollection,
            targetSlug: parent.targetSlug,
            targetTitle: parent.targetTitle,
          }
        }

        return {
          ...data,
          ...replyFields,
          author: user?.id,
          authorName: user?.displayName || user?.email || '注册用户',
          moderationStatus: 'approved',
        }
      },
    ],
    afterChange: [
      async ({ doc, previousDoc, req, operation }) => {
        await recordAuditEvent({
          req,
          action: operation === 'create' ? 'comment.created' : 'comment.updated',
          targetCollection: 'comments',
          targetID: doc?.id,
          targetTitle: doc?.targetTitle,
          summary: '评论即时发布或被工作人员更新。',
          metadata: {
            operation,
            moderationStatus: doc?.moderationStatus,
            reportCount: doc?.reportCount || 0,
            previousBodyLength: String(previousDoc?.body || '').length,
            bodyLength: String(doc?.body || '').length,
          },
        })
      },
    ],
    afterDelete: [
      async ({ doc, req }) => {
        await recordAuditEvent({
          req,
          action: 'comment.deleted',
          targetCollection: 'comments',
          targetID: doc?.id,
          targetTitle: doc?.targetTitle,
          summary: '评论被作者或工作人员删除。',
          metadata: { cascade: Boolean((req.context as { cascadeCommentDelete?: boolean } | undefined)?.cascadeCommentDelete) },
        })
        if ((req.context as { cascadeCommentDelete?: boolean } | undefined)?.cascadeCommentDelete) return
        await req.payload.delete({
          collection: 'comments',
          depth: 0,
          overrideAccess: true,
          where: { parentComment: { equals: doc.id } },
          context: { cascadeCommentDelete: true },
        })
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
      name: 'parentComment',
      type: 'relationship',
      label: '所属主评论',
      relationTo: 'comments',
      admin: {
        description: '回复统一归到一层主评论下，避免手机端无限嵌套。',
        readOnly: true,
      },
    },
    { name: 'replyToName', type: 'text', label: '回复给', admin: { readOnly: true } },
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
    {
      name: 'reportCount',
      type: 'number',
      label: '举报次数',
      defaultValue: 0,
      min: 0,
      admin: { readOnly: true, description: '达到自动保护阈值后评论会暂时隐藏，工作人员可恢复或删除。' },
    },
    {
      name: 'reportedBy',
      type: 'relationship',
      label: '举报账户',
      relationTo: 'users',
      hasMany: true,
      admin: { readOnly: true, hidden: true },
    },
    {
      name: 'hiddenReason',
      type: 'text',
      label: '自动隐藏原因',
      admin: { readOnly: true },
    },
  ],
}
