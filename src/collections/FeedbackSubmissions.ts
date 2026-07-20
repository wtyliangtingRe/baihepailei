import type { Access, CollectionConfig, FieldAccess } from 'payload'

import { isEditor, isOwner, signedIn } from '@/access/roles'
import { recordAuditEvent } from '@/lib/audit'
import { newWorkProposalToWorkTransfer, sanitizeNewWorkProposalMetadata } from '@/lib/newWorkProposal'
import { plainTextToRichText } from '@/lib/richTextPlain'

type FeedbackUser = {
  id?: string | number
  displayName?: string
  email?: string
}

type FeedbackWork = {
  id?: string | number
  importBatch?: string
  siteId?: string
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

function relationshipID(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const id = (value as { id?: string | number }).id
    return id === undefined || id === null ? '' : String(id)
  }
  return value === undefined || value === null ? '' : String(value)
}

function withNewWorkProposalBoundary(
  data: Record<string, unknown> | undefined,
  originalDoc: Record<string, unknown> | undefined,
) {
  const next = { ...(data || {}) }
  const feedbackType = String(next.feedbackType || originalDoc?.feedbackType || '')
  if (feedbackType !== 'new_work') {
    next.newWorkMetadata = null
    return next
  }

  next.newWorkMetadata = sanitizeNewWorkProposalMetadata(next.newWorkMetadata ?? originalDoc?.newWorkMetadata)
  // New-work submitters provide factual catalog metadata and sources. Rating,
  // rule matching and AI Radar fields are deliberately left to the controlled
  // assessment pipeline and staff review.
  next.proposedGrade = null
  next.matchedRuleCodes = []
  return next
}

export const FeedbackSubmissions: CollectionConfig = {
  slug: 'feedback-submissions',
  labels: {
    singular: '用户反馈',
    plural: '用户反馈',
  },
  admin: {
    defaultColumns: ['targetTitle', 'linkedWork', 'feedbackType', 'proposedGrade', 'workflowStatus', 'submitterName', 'createdAt'],
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
        const fromReviewWorkbench = Boolean(
          (req.context as { reviewWorkbench?: boolean } | undefined)?.reviewWorkbench,
        )
        const bounded = withNewWorkProposalBoundary(
          data as Record<string, unknown> | undefined,
          originalDoc as Record<string, unknown> | undefined,
        )

        if (operation === 'create') {
          return {
            ...bounded,
            pageUrl: '',
            submitter: user?.id,
            submitterName: user?.displayName || user?.email || '注册用户',
            targetCollection: bounded.linkedWork ? 'works' : bounded.targetCollection,
            targetSlug: '',
            workflowStatus: 'pending',
          }
        }

        if (!isEditor(req.user) && !fromReviewWorkbench) {
          return {
            ...bounded,
            submitter: originalDoc?.submitter,
            submitterName: originalDoc?.submitterName,
            workflowStatus: originalDoc?.workflowStatus,
            reviewer: originalDoc?.reviewer,
            reviewedAt: originalDoc?.reviewedAt,
            reviewNote: originalDoc?.reviewNote,
          }
        }

        const nextStatus = String(bounded.workflowStatus || originalDoc?.workflowStatus || 'pending')
        if (nextStatus !== 'pending' && nextStatus !== originalDoc?.workflowStatus) {
          return {
            ...bounded,
            reviewer: user?.id || bounded.reviewer,
            reviewedAt: bounded.reviewedAt || new Date().toISOString(),
          }
        }
        return bounded
      },
    ],
    afterChange: [
      async ({ doc, previousDoc, req, operation }) => {
        const linkedWorkID = relationshipID(doc?.linkedWork)
        const previousLinkedWorkID = relationshipID(previousDoc?.linkedWork)

        if (doc?.feedbackType === 'new_work' && linkedWorkID && linkedWorkID !== previousLinkedWorkID) {
          const work = await req.payload.findByID({
            collection: 'works',
            id: linkedWorkID,
            depth: 0,
            draft: false,
            overrideAccess: true,
          }) as unknown as FeedbackWork
          const directIntakeDraft = String(work.siteId || '').startsWith(`feedback:${String(doc.id)}:`)
            || work.importBatch === `feedback-intake:${String(doc.id)}`

          if (directIntakeDraft) {
            const transfer = newWorkProposalToWorkTransfer(doc.newWorkMetadata, {
              feedbackID: doc.id,
              targetTitle: doc.targetTitle,
              claim: doc.claim,
              evidenceSummary: doc.evidenceSummary,
            })
            const workData: Record<string, unknown> = {
              ...transfer.workData,
              _status: 'draft',
              catalogStatus: 'active',
              rank: 'unknown',
              reviewStatus: 'pending',
              isLiteVisible: false,
              isFullVisible: false,
            }
            if (transfer.summaryText) workData.summary = plainTextToRichText(transfer.summaryText)

            await req.payload.update({
              collection: 'works',
              id: linkedWorkID,
              depth: 0,
              draft: false,
              overrideAccess: true,
              context: {
                firstPartyStudio: true,
                feedbackMetadataTransfer: true,
                feedbackID: doc.id,
                auditActorID: (req.user as FeedbackUser | undefined)?.id,
              },
              data: workData as never,
            })
          }
        }

        await recordAuditEvent({
          req,
          action: operation === 'create' ? 'feedback.created' : 'feedback.updated',
          targetCollection: 'feedback-submissions',
          targetID: doc?.id,
          targetTitle: doc?.targetTitle,
          summary: '用户反馈提交或审核状态发生变化。',
          metadata: {
            operation,
            beforeWorkflowStatus: previousDoc?.workflowStatus,
            afterWorkflowStatus: doc?.workflowStatus,
            feedbackType: doc?.feedbackType,
          },
        })
      },
    ],
    afterDelete: [
      async ({ doc, req }) => {
        await recordAuditEvent({
          req,
          action: 'feedback.deleted',
          targetCollection: 'feedback-submissions',
          targetID: doc?.id,
          targetTitle: doc?.targetTitle,
          summary: '反馈记录被最高领袖永久删除。',
          metadata: { workflowStatus: doc?.workflowStatus, feedbackType: doc?.feedbackType },
        })
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
    { name: 'targetSlug', type: 'text', label: '旧作品 / 页面 Slug', admin: { hidden: true } },
    { name: 'targetTitle', type: 'text', label: '作品 / 页面名称', required: true, maxLength: 300 },
    {
      name: 'newWorkMetadata',
      type: 'json',
      label: '新作品结构化资料',
      admin: {
        description: '仅用于新增作品建议：原名、别名、作品类别、形态、首次日期、简介和搜索补充信息。评级与 AI 字段不由提交者填写。',
      },
    },
    { name: 'pageUrl', type: 'text', label: '旧相关页面 URL', maxLength: 500, admin: { hidden: true } },
    { name: 'proposedGrade', type: 'select', label: '建议分级', options: gradeOptions },
    {
      name: 'matchedRuleCodes',
      type: 'array',
      label: '建议命中规则',
      maxRows: 20,
      admin: {
        description: '第一项作为主规则 / 决定性规则；后续项目保存其他同时命中的规则。它们都只是提交建议。',
      },
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
      label: '关联站内作品 ID',
      relationTo: 'works',
      admin: {
        description: '使用本站 Works 主键建立稳定关系，不依赖外部 URL、第三方 ID 或可变 Slug。',
      },
    },
  ],
}
