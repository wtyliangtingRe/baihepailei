'use server'

import configPromise from '@payload-config'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload, type Where } from 'payload'

import { isEditor } from '@/access/roles'
import { newWorkProposalToWorkTransfer, type NewWorkProposalMetadata } from '@/lib/newWorkProposal'
import { plainTextToRichText } from '@/lib/richTextPlain'

import { canonicalContentUrl } from '../../../_lib/content-identity'

type WorkflowStatus = 'pending' | 'triaging' | 'needs_information' | 'accepted' | 'rejected' | 'archived'
type FeedbackDoc = {
  id: string | number
  feedbackType?: string
  targetTitle?: string
  newWorkMetadata?: NewWorkProposalMetadata
  claim?: string
  evidenceSummary?: string
  evidenceLinks?: Array<{ label?: string; url?: string }>
  workflowStatus?: WorkflowStatus
  reviewNote?: string
  linkedWork?: string | number | { id?: string | number }
}

function numericID(value: unknown) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function relationID(value: FeedbackDoc['linkedWork']) {
  if (value && typeof value === 'object') return numericID(value.id)
  return numericID(value)
}

function safeReturnTo(value: FormDataEntryValue | null) {
  const requested = String(value || '')
  return requested === '/me/review/feedback' || requested.startsWith('/me/review/feedback?')
    ? requested
    : '/me/review/feedback'
}

function detailHref(id: number, returnTo: string, values: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams({ returnTo })
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return `/me/review/feedback/${id}?${params.toString()}`
}

function intakeSlug(title: string, id: number) {
  const normalized = title.normalize('NFKC').toLowerCase()
    .replace(/[^a-z0-9\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 56) || 'work'
  return `feedback-${normalized}-${id}-${randomUUID().slice(0, 8)}`
}

function newWorkCandidateWhere(title: string, originalTitle: string): Where {
  const or: Where[] = [
    { title: { like: title } },
    { originalTitle: { like: title } },
    { searchText: { like: title } },
  ]
  if (originalTitle) {
    or.push(
      { title: { like: originalTitle } },
      { originalTitle: { like: originalTitle } },
      { searchText: { like: originalTitle } },
    )
  }
  return { or }
}

async function reviewerContext() {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user || !isEditor(auth.user)) throw new Error('没有用户反馈审核权限。')
  const actorID = numericID((auth.user as { id?: string | number }).id)
  if (!actorID) throw new Error('当前账户缺少可用于审计的数字 ID。')
  return { payload, actorID }
}

export async function beginFeedbackReviewAction(formData: FormData) {
  const { payload, actorID } = await reviewerContext()
  const feedbackID = numericID(formData.get('id'))
  const returnTo = safeReturnTo(formData.get('returnTo'))
  if (!feedbackID) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}reviewError=invalid_action`)

  const feedback = await payload.findByID({
    collection: 'feedback-submissions',
    id: feedbackID,
    depth: 0,
    overrideAccess: true,
  }) as unknown as FeedbackDoc

  if (feedback.workflowStatus === 'pending' || feedback.workflowStatus === 'needs_information') {
    await payload.update({
      collection: 'feedback-submissions',
      id: feedbackID,
      depth: 0,
      overrideAccess: true,
      context: { reviewWorkbench: true, auditActorID: actorID },
      data: {
        workflowStatus: 'triaging',
        reviewer: actorID,
        reviewedAt: new Date().toISOString(),
      },
    })
  }

  redirect(detailHref(feedbackID, returnTo, { started: 'true' }))
}

export async function reviewFeedbackDetailAction(formData: FormData) {
  const { payload, actorID } = await reviewerContext()
  const feedbackID = numericID(formData.get('id'))
  const returnTo = safeReturnTo(formData.get('returnTo'))
  const intent = String(formData.get('intent') || 'save')
  const note = String(formData.get('reviewNote') || '').trim().slice(0, 4000)
  if (!feedbackID || !['save', 'needs_information', 'accepted', 'rejected', 'archived'].includes(intent)) {
    redirect(feedbackID ? detailHref(feedbackID, returnTo, { reviewError: 'invalid_action' }) : returnTo)
  }
  if ((intent === 'needs_information' || intent === 'rejected') && !note) {
    redirect(detailHref(feedbackID, returnTo, { reviewError: 'note_required' }))
  }

  const feedback = await payload.findByID({
    collection: 'feedback-submissions',
    id: feedbackID,
    depth: 0,
    overrideAccess: true,
  }) as unknown as FeedbackDoc
  const existingWorkID = relationID(feedback.linkedWork)

  if (intent === 'accepted' && feedback.feedbackType === 'new_work' && !existingWorkID) {
    const title = String(feedback.targetTitle || '').trim()
    if (!title) redirect(detailHref(feedbackID, returnTo, { reviewError: 'invalid_action' }))
    const transfer = newWorkProposalToWorkTransfer(feedback.newWorkMetadata, {
      feedbackID,
      targetTitle: feedback.targetTitle,
      claim: feedback.claim,
      evidenceSummary: feedback.evidenceSummary,
    })
    const duplicates = await payload.find({
      collection: 'works',
      depth: 0,
      limit: 8,
      page: 1,
      pagination: false,
      overrideAccess: true,
      where: newWorkCandidateWhere(title, transfer.workData.originalTitle),
    })
    if (duplicates.docs.length) {
      await payload.update({
        collection: 'feedback-submissions',
        id: feedbackID,
        depth: 0,
        overrideAccess: true,
        context: { reviewWorkbench: true, auditActorID: actorID },
        data: {
          workflowStatus: 'triaging',
          reviewer: actorID,
          reviewedAt: new Date().toISOString(),
          reviewNote: note || '发现可能重复的现有作品；请先完成重复核查，再决定是否创建独立临时作品。',
        },
      })
      redirect(detailHref(feedbackID, returnTo, { reviewError: 'duplicate_candidates' }))
    }

    const sourceLinks = (feedback.evidenceLinks || [])
      .filter((item) => item?.url)
      .map((item, index) => ({
        label: String(item.label || `用户来源 ${index + 1}`).slice(0, 120),
        url: String(item.url).slice(0, 1000),
      }))
    const created = await payload.create({
      collection: 'works',
      depth: 0,
      draft: false,
      overrideAccess: true,
      context: { firstPartyStudio: true, feedbackIntake: true, feedbackID, auditActorID: actorID },
      data: {
        title,
        slug: intakeSlug(title, feedbackID),
        siteId: `feedback:${feedbackID}:${randomUUID().slice(0, 12)}`,
        ...transfer.workData,
        ...(transfer.summaryText ? { summary: plainTextToRichText(transfer.summaryText) } : {}),
        rank: 'unknown',
        reviewStatus: 'pending',
        ratingNotice: 'none',
        evidenceStrength: 'unassessed',
        _status: 'published',
        catalogStatus: 'temporary',
        isLiteVisible: true,
        isFullVisible: true,
        hasEvidence: sourceLinks.length > 0 || Boolean(feedback.evidenceSummary),
        sourceLinks,
        evidenceNote: String(feedback.evidenceSummary || '').trim(),
        humanReviewNote: `[${new Date().toISOString()}] 由用户新作品申请 #${feedbackID} 采纳生成临时作品；事实资料已转入并公开，AI Radar 保持空白，等待下一次未评估管线。\n${String(feedback.claim || '').trim()}`.slice(0, 4000),
        importBatch: `feedback-intake:${feedbackID}`,
      },
    })
    const createdID = numericID(created.id)
    if (!createdID) throw new Error('临时作品创建后未取得有效作品 ID。')

    await payload.update({
      collection: 'feedback-submissions',
      id: feedbackID,
      depth: 0,
      overrideAccess: true,
      context: { reviewWorkbench: true, auditActorID: actorID },
      data: {
        workflowStatus: 'accepted',
        linkedWork: createdID,
        reviewer: actorID,
        reviewedAt: new Date().toISOString(),
        reviewNote: note || `已采纳并创建公开的临时作品 #${createdID}；AI 轨道等待后续管线，人工轨道尚未复核。`,
      },
    })

    revalidatePath('/me/review/feedback')
    revalidatePath('/me/messages')
    revalidatePath('/me/studio')
    revalidatePath('/works')
    revalidatePath(canonicalContentUrl('works', createdID))
    revalidatePath(`/me/studio/works/${createdID}`)
    redirect(detailHref(feedbackID, returnTo, { createdWork: createdID, reviewed: 'accepted' }))
  }

  const nextStatus = intent === 'save'
    ? (feedback.workflowStatus || 'triaging')
    : intent as WorkflowStatus
  await payload.update({
    collection: 'feedback-submissions',
    id: feedbackID,
    depth: 0,
    overrideAccess: true,
    context: { reviewWorkbench: true, auditActorID: actorID },
    data: {
      workflowStatus: nextStatus,
      reviewNote: note,
      reviewer: actorID,
      reviewedAt: new Date().toISOString(),
    },
  })

  revalidatePath('/me/review/feedback')
  revalidatePath('/me/messages')
  if (existingWorkID) revalidatePath(canonicalContentUrl('works', existingWorkID))
  redirect(detailHref(feedbackID, returnTo, { reviewed: intent }))
}
