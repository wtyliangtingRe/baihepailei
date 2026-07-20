'use server'

import configPromise from '@payload-config'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { isEditor } from '@/access/roles'

import { canonicalContentUrl } from '../../../_lib/content-identity'
import { isMergedDuplicateWork, mergedWorkReference, safeReviewReturnTo } from './review-utils'

export type ContentCollection = 'works'

type WorkDoc = {
  id: string | number
  title?: string
  rank?: string
  reviewStatus?: string
  ratingNotice?: string
  humanReviewNote?: string
  humanAssessment?: {
    grade?: string
    status?: string
    note?: string
    sourceSummary?: string
    evidenceStatus?: string
    sourceLinks?: Array<{ label?: string; url?: string }>
    assessedAt?: string
    assessedBy?: unknown
  } | null
  radarAssessment?: { assessedAt?: string; suggestedGrade?: string } | null
  reviewReasons?: string[] | string
  searchText?: string
  evidenceNote?: string
  sourceConflictNotes?: string
}

const workRankOptions = ['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'trash', 'unknown']

function reviewReasons(value: WorkDoc['reviewReasons']) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[;|,]/u).map((item) => item.trim()).filter(Boolean)
  return []
}

function detailHref(id: string, returnTo: string, values: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams({ returnTo })
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return `/me/review/content/works/${encodeURIComponent(id)}?${params.toString()}`
}

async function reviewerContext() {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user || !isEditor(auth.user)) throw new Error('没有 AI 评级人工复核权限。')
  const actorID = (auth.user as { id?: string | number }).id
  if (actorID === undefined || actorID === null) throw new Error('当前账户缺少可用于审计的用户 ID。')
  return { payload, actorID }
}

export async function beginContentReviewAction(formData: FormData) {
  const { payload } = await reviewerContext()
  const id = String(formData.get('id') || '').trim()
  const returnTo = safeReviewReturnTo(formData.get('returnTo'))
  if (!id) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}reviewError=invalid_action`)

  const current = await payload.findByID({ collection: 'works', id, depth: 0, overrideAccess: true }) as unknown as WorkDoc
  if (!current.radarAssessment?.assessedAt || current.humanAssessment?.status === 'reviewed') {
    redirect(detailHref(id, returnTo, { reviewError: 'not_ai_review_candidate' }))
  }
  redirect(detailHref(id, returnTo, { started: 'true' }))
}

export async function saveContentReviewAction(formData: FormData) {
  const { payload, actorID } = await reviewerContext()
  const id = String(formData.get('id') || '').trim()
  const title = String(formData.get('title') || '').trim().slice(0, 300)
  const intent = String(formData.get('intent') || 'save')
  const note = String(formData.get('note') || '').trim().slice(0, 4000)
  const returnTo = safeReviewReturnTo(formData.get('returnTo'))
  if (!id || !title || !['save', 'approve', 'reject'].includes(intent)) {
    redirect(id ? detailHref(id, returnTo, { reviewError: 'invalid_action' }) : returnTo)
  }
  if (intent === 'reject' && !note) redirect(detailHref(id, returnTo, { reviewError: 'note_required' }))

  const current = await payload.findByID({ collection: 'works', id, depth: 0, overrideAccess: true }) as unknown as WorkDoc
  if (isMergedDuplicateWork(current)) {
    const merged = mergedWorkReference(current)
    redirect(detailHref(id, returnTo, { reviewError: 'merged_duplicate', targetId: merged?.id, targetTitle: merged?.title }))
  }
  if (!current.radarAssessment?.assessedAt) redirect(detailHref(id, returnTo, { reviewError: 'not_ai_review_candidate' }))

  const rank = String(formData.get('rank') || current.radarAssessment.suggestedGrade || 'unknown')
  if (!workRankOptions.includes(rank)) redirect(detailHref(id, returnTo, { reviewError: 'invalid_fields' }))

  const reviewStatus = intent === 'approve' ? 'reviewed' : intent === 'reject' ? 'disputed' : String(current.reviewStatus || 'pending')
  const humanStatus = reviewStatus === 'reviewed' ? 'reviewed' : reviewStatus === 'disputed' ? 'disputed' : current.humanAssessment?.status || 'pending'
  const data: Record<string, unknown> = {
    title,
    rank,
    reviewStatus,
    humanReviewNote: note,
    humanAssessment: {
      ...(current.humanAssessment || {}),
      grade: rank === 'unknown' ? null : rank,
      status: humanStatus,
      note,
      evidenceStatus: current.humanAssessment?.evidenceStatus || 'unassessed',
      assessedAt: reviewStatus !== 'pending' ? new Date().toISOString() : current.humanAssessment?.assessedAt,
      assessedBy: reviewStatus !== 'pending' ? actorID : current.humanAssessment?.assessedBy,
    },
  }

  if (reviewStatus !== 'pending') {
    data.reviewReasons = [...new Set([...reviewReasons(current.reviewReasons), 'manual_review'])]
    data.humanReviewedAt = new Date().toISOString()
    data.humanReviewedBy = actorID
  }
  if (reviewStatus === 'reviewed') data.ratingNotice = 'manual_reviewed'
  if (reviewStatus === 'disputed') data.ratingNotice = 'ai_synthesized_pending_review'

  try {
    await payload.update({
      collection: 'works',
      id,
      depth: 0,
      draft: false,
      overrideAccess: true,
      context: { reviewWorkbench: true, auditActorID: actorID },
      data: data as never,
    })
  } catch (error) {
    console.error('AI-rated work human review update failed', { id, error })
    redirect(detailHref(id, returnTo, { reviewError: 'save_failed' }))
  }

  revalidatePath('/me/review/content')
  revalidatePath('/works')
  revalidatePath(canonicalContentUrl('works', id))
  redirect(detailHref(id, returnTo, { reviewed: intent }))
}
