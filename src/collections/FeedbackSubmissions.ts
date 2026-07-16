import type { Access, CollectionConfig, FieldAccess } from 'payload'

import { isEditor, isOwner, signedIn } from '@/access/roles'

type FeedbackUser = {
  id?: string | number
  displayName?: string
  email?: string
}

const ownSubmissionOrStaff: Access = ({ req }) => {
  if (isEditor(req.user)) return true
  if (!req.user) return false
  const userID = (req.user as FeedbackUser).id
  if (userID === undefined || userID === null) return false
  return {
    submitter: {
      equals: userID,
    },
  }
}

const ownEditableSubmissionOrStaff: Access = ({ req }) => {
  if (isEditor(req.user)) return true
  if (!req.user) return false
  const userID = (req.user as FeedbackUser).id
  if (userID === undefined || userID === null) return false

  return {
    submitter: {
      equals: userID,
    },
    workflowStatus: {
      in: ['pending', 'needs_information'],
    },
  }
}

const staffFieldAccess: FieldAccess = ({ req }) => isEditor(req.user)

const gradeOptions = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X'].map((value) => ({ label: value, value }))

export const FeedbackSubmissions: CollectionConfig = {
  slug: 'feedback-submissions',
  labels: {
    singular: '用户反馈',
    plural: '用户反馈',
  },
  admin: {
    defaultColumns: ['targetTitle', 'feedbackType', 'proposedGrade', 'workflowStatus', 'submitterName', 'createdAt'],
    group: '互动',
    useAsTitle: 'targetTitle',
  },
  access: {
    create: signedIn,
    delete: ({ req }) => isOwner(req.user),
    read: ownSubmissionOrStaff,
    update: ownEditableSubmissionOrStaff,
  },
  hooks: {
    beforeChange: [
      ({ data, operation, originalDoc, req }) => {
        const user = req.user as FeedbackUser | undefined
        if (operation === 'create') {
          return {
            ...data,
            submitter: user?.id,
            submitterName: user?.displayName || user?.email || '注册用户',
            workflowStatus: 'pending',
          }
        }

        if (!isEditor(req.user)) {
          return {
            ...data,
            submitter: originalDoc?.submitter,
            submitterName: originalDoc?.submitterName,
            workflowStatus: originalDoc?.workflowStatus,
            reviewer: originalDoc?.reviewer,
            reviewedAt: originalDoc?.reviewedAt,
            reviewNote: originalDoc?.reviewNote,
          }
        }

        const nextStatus = String(data?.workflowStatus || originalDoc?.workflowStatus || 'pending')
        if (nextStatus !== 'pending' && nextStatus !== originalDoc?.workflowStatus) {
          return {
            ...data,
            reviewer: user?.id,
            reviewedAt: new Date().toISOString(),
          }
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'feedbackType',
      type: 'select',
      label: '反馈类型',
      required: true,
      options: [
        { label: '人工排雷 / 新证据', value: 'radar_evidence' },
        { label: '分级或规则纠错', value: 'rating_correction' },
        { label: '新增作品建议', value: 'new_work' },
        { label: '资料错误', value: 'content_correction' },
        { label: '链接失效', value: 'broken_link' },
        { label: '页面问题', value: 'display_problem' },
        { label: '其他', value: 'other' },
      ],
    },
    { name: 'targetCollection', type: 'text', label: '对象类型', defaultValue: 'works' },
    { name: 'targetSlug', type: 'text', label: '作品 / 页面 Slug' },
    { name: 'targetTitle', type: 'text', label: '作品 / 页面名称', required: true, maxLength: 200 },
    { name: 'pageUrl', type: 'text', label: '相关页面 URL', maxLength: 500 },
    { name: 'proposedGrade', type: 'select', label: '建议分级', options: gradeOptions },
    {
      name: 'matchedRuleCodes',
      type: 'array',
      label: '建议命中规则',
      maxRows: 20,
      fields: [{ name: 'code', type: 'text', label: '规则代码', maxLength: 80 }],
    },
    {
      name: 'claim',
      type: 'textarea',
      label: '希望网站核实的结论',
      required: true,
      maxLength: 4000,
    },
    {
      name: 'evidenceSummary',
      type: 'textarea',
      label: '证据说明',
      maxLength: 8000,
    },
    {
      name: 'evidenceLinks',
      type: 'array',
      label: '证据链接',
      maxRows: 12,
      fields: [
        { name: 'label', type: 'text', label: '说明', maxLength: 120 },
        { name: 'url', type: 'text', label: 'URL', required: true, maxLength: 1000 },
      ],
    },
    { name: 'containsSpoilers', type: 'checkbox', label: '包含剧透', defaultValue: false },
    {
      name: 'submitter',
      type: 'relationship',
      label: '提交者',
      relationTo: 'users',
      required: true,
      admin: { readOnly: true },
    },
    { name: 'submitterName', type: 'text', label: '提交者显示名', admin: { readOnly: true } },
    {
      name: 'workflowStatus',
      type: 'select',
      label: '处理状态',
      defaultValue: 'pending',
      required: true,
      access: { update: staffFieldAccess },
      options: [
        { label: '待审核', value: 'pending' },
        { label: '核查中', value: 'triaging' },
        { label: '需要补充材料', value: 'needs_information' },
        { label: '已采纳', value: 'accepted' },
        { label: '未采纳', value: 'rejected' },
        { label: '已归档', value: 'archived' },
      ],
    },
    {
      name: 'reviewer',
      type: 'relationship',
      label: '审核人',
      relationTo: 'users',
      access: { update: staffFieldAccess },
      admin: { readOnly: true },
    },
    { name: 'reviewedAt', type: 'date', label: '审核时间', access: { update: staffFieldAccess }, admin: { readOnly: true } },
    { name: 'reviewNote', type: 'textarea', label: '审核说明', access: { update: staffFieldAccess }, maxLength: 4000 },
    {
      name: 'linkedWork',
      type: 'relationship',
      label: '关联正式作品',
      relationTo: 'works',
      access: { update: staffFieldAccess },
    },
  ],
}
