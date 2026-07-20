'use server'

import configPromise from '@payload-config'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { isEditor } from '@/access/roles'

import { canonicalContentUrl } from '../../../_lib/content-identity'
import {
  isMergedDuplicateWork,
  mergedWorkReference,
  safeReviewReturnTo,
  type ReviewableContentDoc,
} from './review-utils'

export type ContentCollection = 'works' | 'creators' | 'organizations'

type ContentDoc = ReviewableContentDoc & {
  id: string | number
  title?: string
  name?: string
  rank?: string
  type?: string
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
  reviewReasons?: string[] | string
  reviewOrigin?: string
}

const collectionMeta: Record<ContentCollection, { titleField: 'title' | 'name' }> = {
  works: { titleField: 'title' },
  creators: { titleField: 'name' },
  organizations: { titleField: 'name' },
}
const workRankOptions = ['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'trash', 'unknown']
const creatorRankOptions = ['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'unknown']
const organizationTypes = [
  'publisher', 'production_company', 'animation_studio', 'game_company', 'distributor',
  'circle', 'brand', 'platform', 'committee', 'other',
]

function collectionValue(value: FormDataEntryValue | string | null | undefined): ContentCollection {
  return value === 'creators' || value === 'organizations' ? value : 'works'
}

function reviewReasons(value: ContentDoc['reviewReasons']) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[;|,]/u).map((item) => item.trim()).filter(Boolean)
  return []
}

function detailHref(collection: ContentCollection, id: string, returnTo: string, values: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams({ returnTo })
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return `/me/review/content/${collection}/${encodeURIComponent(id)}?${params.toString()}`
}

async function reviewerContext() {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user || !isEditor(auth.user)) throw new Error('没有内容审核权限。')
  const actorID = (auth.user as { id?: string | number }).id
  if (actorID === undefined || actorID === null) throw new Error('当前账户缺少可用于审计的用户 ID。')
  return { payload, actorID }
}

export async function beginContentReviewAction(formData: FormData) {
  await reviewerContext()
  const collection = collectionValue(formData.get('collection'))
  const id = String(formData.get('id') || '').trim()
  const returnTo = safeReviewReturnTo(formData.get('returnTo'))
  if (!id) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}reviewError=invalid_action`)
  redirect(detailHref(collection, id, returnTo, { started: 'true' }))
}

export async function saveContentReviewAction(formData: FormData) {
  const { payload, actorID } = await reviewerContext()
  const collection = collectionValue(formData.get('collection'))
  const id = String(formData.get('id') || '').trim()
  const title = String(formData.get('title') || '').trim().slice(0, 300)
  const intent = String(formData.get('intent') || 'save')
  const note = String(formData.get('note') || '').trim().slice(0, 4000)
  const returnTo = safeReviewReturnTo(formData.get('returnTo'))
  if (!id || !title || !['save', 'approve', 'reject'].includes(intent)) {
    redirect(id ? detailHref(collection, id, returnTo, { reviewError: 'invalid_action' }) : returnTo)
  }
  if (intent === 'reject' && !note) {
    redirect(detailHref(collection, id, returnTo, { reviewError: 'note_required' }))
  }

  const current = await payload.findByID({
    collection: collection as never,
    id,
    depth: 0,
    overrideAccess: true,
  }) as unknown as ContentDoc

  if (collection === 'works' && isMergedDuplicateWork(current)) {
    const merged = mergedWorkReference(current)
    redirect(detailHref(collection, id, returnTo, {
      reviewError: 'merged_duplicate',
      targetId: merged?.id,
      targetTitle: merged?.title,
    }))
  }

  const reviewStatus = intent === 'approve'
    ? 'reviewed'
    : intent === 'reject'
      ? 'disputed'
      : String(current.reviewStatus || 'pending')
  const data: Record<string, unknown> = {
    [collectionMeta[collection].titleField]: title,
    reviewStatus,
    humanReviewNote: note,
  }

  if (collection === 'works') {
    const rank = String(formData.get('rank') || 'unknown')
    if (!workRankOptions.includes(rank)) redirect(detailHref(collection, id, returnTo, { reviewError: 'invalid_fields' }))
    data.rank = rank
    if (reviewStatus !== 'pending') {
      data.reviewReasons = [...new Set([...reviewReasons(current.reviewReasons), 'manual_review'])]
      data.humanReviewedAt = new Date().toISOString()
      data.humanReviewedBy = actorID
    }
    if (reviewStatus === 'reviewed') data.ratingNotice = 'manual_reviewed'
    data.humanAssessment = {
      ...(current.humanAssessment || {}),
      grade: rank === 'unknown' ? null : rank,
      status: reviewStatus === 'reviewed' ? 'reviewed' : reviewStatus === 'disputed' ? 'disputed' : current.humanAssessment?.status || 'pending',
      note,
      evidenceStatus: current.humanAssessment?.evidenceStatus || 'unassessed',
      assessedAt: reviewStatus !== 'pending' ? new Date().toISOString() : current.humanAssessment?.assessedAt,
      assessedBy: reviewStatus !== 'pending' ? actorID : current.humanAssessment?.assessedBy,
    }
  } else if (collection === 'creators') {
    const rank = String(formData.get('rank') || 'unknown')
    if (!creatorRankOptions.includes(rank)) redirect(detailHref(collection, id, returnTo, { reviewError: 'invalid_fields' }))
    data.rank = rank
    if (reviewStatus !== 'pending') {
      data.humanReviewedAt = new Date().toISOString()
      data.humanReviewedBy = actorID
      data.reviewOrigin = 'human_reviewed'
    }
  } else {
    const type = String(formData.get('type') || 'other')
    if (!organizationTypes.includes(type)) redirect(detailHref(collection, id, returnTo, { reviewError: 'invalid_fields' }))
    data.type = type
    if (reviewStatus !== 'pending') {
      data.humanReviewedAt = new Date().toISOString()
      data.humanReviewedBy = actorID
      data.reviewOrigin = 'human_reviewed'
    }
  }

  try {
    await payload.update({
      collection: collection as never,
      id,
      depth: 0,
      draft: false,
      overrideAccess: true,
      context: { reviewWorkbench: true, auditActorID: actorID },
      data: data as never,
    })
  } catch (error) {
    console.error('Content review update failed', { collection, id, error })
    redirect(detailHref(collection, id, returnTo, { reviewError: 'save_failed' }))
  }

  revalidatePath('/me/review/content')
  revalidatePath(`/${collection}`)
  revalidatePath(canonicalContentUrl(collection, id))
  redirect(detailHref(collection, id, returnTo, { reviewed: intent }))
}
