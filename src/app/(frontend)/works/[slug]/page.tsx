import configPromise from '@payload-config'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'

import AssessmentOriginBadge from '../../_components/AssessmentOriginBadge'
import DetailIndexDetail from '../../_components/DetailIndexDetail'
import FeedbackPrompt from '../../_components/FeedbackPrompt'
import MissingSearchIndex from '../../_components/MissingSearchIndex'
import SearchIndexDetail from '../../_components/SearchIndexDetail'
import VersionInfo from '../../_components/VersionInfo'
import { isCanonicalContentRoute, recordIdFromContentRoute } from '../../_lib/content-identity'
import { applyPublicRatingBridge, readPublicRatingBridge } from '../../_lib/radar-public-rating-bridge'
import { findDetailItem, findEvidenceByWorkTitle, type DetailItem } from '../../_lib/detail-index'
import { findSearchItem, readSearchIndex } from '../../_lib/search-index'

type Args = {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

type LiveWork = {
  id: string | number
  title?: string
  originalTitle?: string
  aliases?: Array<{ value?: string } | string>
  rank?: string
  reviewStatus?: string
  ratingNotice?: string
  evidenceStrength?: string
  mediaGroup?: string
  mediaType?: string
  format?: string
  firstPublishedAt?: string
  firstPublishedPrecision?: string
  firstPublishedLabel?: string
  _status?: string
  catalogStatus?: string
  updatedAt?: string
  createdAt?: string
  radarAssessment?: { assessedAt?: string; suggestedGrade?: string }
  humanAssessment?: { grade?: string; status?: string; note?: string; sourceSummary?: string; evidenceStatus?: string; assessedAt?: string }
}

const staffRoles = new Set(['owner', 'admin', 'editor'])

function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] || '' : value || '' }

function roleOf(user: unknown) {
  return user && typeof user === 'object' ? String((user as { role?: string }).role || '') : ''
}

async function staffLiveWork(recordID: string) {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user || !staffRoles.has(roleOf(auth.user))) return null

  try {
    return await payload.findByID({
      collection: 'works',
      id: recordID,
      depth: 0,
      overrideAccess: true,
    }) as unknown as LiveWork
  } catch {
    return null
  }
}

function liveDetailItem(indexed: DetailItem, live: LiveWork): DetailItem {
  const aliases = Array.isArray(live.aliases)
    ? live.aliases.map((item) => typeof item === 'string' ? item : String(item?.value || '')).filter(Boolean)
    : indexed.aliases

  return {
    ...indexed,
    title: live.title || indexed.title,
    originalTitle: live.originalTitle || indexed.originalTitle,
    aliases,
    rank: live.rank || indexed.rank,
    reviewStatus: live.reviewStatus || indexed.reviewStatus,
    ratingNotice: live.ratingNotice || indexed.ratingNotice,
    evidenceStrength: live.evidenceStrength || indexed.evidenceStrength,
    mediaGroup: live.mediaGroup || indexed.mediaGroup,
    mediaType: live.mediaType || indexed.mediaType,
    format: live.format || indexed.format,
    firstPublishedAt: live.firstPublishedAt || indexed.firstPublishedAt,
    firstPublishedPrecision: live.firstPublishedPrecision || indexed.firstPublishedPrecision,
    firstPublishedLabel: live.firstPublishedLabel || indexed.firstPublishedLabel,
    status: live._status || indexed.status,
    catalogStatus: live.catalogStatus || indexed.catalogStatus,
    updatedAt: live.updatedAt || indexed.updatedAt,
    createdAt: live.createdAt || indexed.createdAt,
    radarAssessment: live.radarAssessment || indexed.radarAssessment,
    humanAssessment: live.humanAssessment ? {
      grade: live.humanAssessment.grade,
      status: live.humanAssessment.status,
      note: live.humanAssessment.note,
      sourceSummary: live.humanAssessment.sourceSummary,
      evidenceStatus: live.humanAssessment.evidenceStatus,
      assessedAt: live.humanAssessment.assessedAt,
    } : indexed.humanAssessment,
  }
}

async function unindexedStaffWork(routeKey: string) {
  const recordID = recordIdFromContentRoute('works', routeKey)
  if (!recordID) return null

  const doc = await staffLiveWork(recordID)
  if (!doc) return null

  return (
    <main className="page collection-page">
      <section className="detail-card unindexed-content-notice">
        <p className="eyebrow">工作人员数据库预览</p>
        <h1>{doc.title || `作品 ${doc.id}`}</h1>
        <div className="work-card-badges"><span className="work-type-chip">{doc.rank && doc.rank !== 'unknown' ? `${doc.rank} 级` : '尚未分级'}</span><AssessmentOriginBadge item={{ collection: 'works', ratingNotice: doc.ratingNotice, reviewStatus: doc.reviewStatus, radarAssessment: doc.radarAssessment }} /><span className="work-type-chip">{doc._status || 'draft'}</span><span className="work-type-chip">{doc.catalogStatus || 'active'}</span></div>
        <p>这条记录存在于数据库，但还没有进入公开索引。草稿、刚恢复的作品和未完成的新建条目都可能处于这种状态。</p>
        <div className="collection-actions"><Link className="result-link" href={`/me/studio/works/${doc.id}`}>在站内内容管理中编辑</Link><Link className="back-link" href="/me/studio">返回内容管理</Link></div>
      </section>
    </main>
  )
}

export default async function WorkDetailPage({ params, searchParams }: Args) {
  const { slug } = await params
  const rawSearchParams = await searchParams
  const preview = first(rawSearchParams.preview) === '1'
  const decodedSlug = decodeURIComponent(slug)

  const detailItem = findDetailItem('works', decodedSlug)
  if (detailItem) {
    if (detailItem.recordId && !isCanonicalContentRoute('works', decodedSlug, detailItem.recordId)) redirect(detailItem.url)
    const live = preview && detailItem.recordId ? await staffLiveWork(String(detailItem.recordId)) : null
    if ((detailItem.catalogStatus === 'archived' || detailItem.status === 'archived') && !live) notFound()
    const visibleItem = live ? liveDetailItem(detailItem, live) : detailItem
    const bridgedItem = applyPublicRatingBridge(
      visibleItem,
      await readPublicRatingBridge(visibleItem.recordId),
    )

    return (
      <>
        {live ? (
          <section className="page" aria-label="工作人员实时预览提示">
            <div className="detail-card review-safety-note">
              <strong>{visibleItem.catalogStatus === 'archived' || visibleItem.status === 'archived' ? '工作人员回收站预览' : '工作人员实时预览'}</strong>
              <p>{visibleItem.catalogStatus === 'archived' || visibleItem.status === 'archived' ? '这个作品已经软隐藏，普通访客无法从列表、搜索或详情页查看；工作人员仍可预览并从内容管理恢复。' : '标题、正式分级、复核状态和更新时间已叠加数据库最新值；站内编辑保存时也会尝试同步现有公开索引。'}</p>
              <Link className="review-link" href={`/me/studio/works/${visibleItem.recordId || live.id}`}>编辑这个作品</Link>
            </div>
          </section>
        ) : null}
        <DetailIndexDetail item={bridgedItem} relatedEvidence={findEvidenceByWorkTitle(visibleItem.title)} />
        <VersionInfo item={visibleItem} />
        <FeedbackPrompt item={visibleItem} />
      </>
    )
  }

  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const item = findSearchItem('works', decodedSlug)
  if (!item) {
    const staffFallback = await unindexedStaffWork(decodedSlug)
    if (staffFallback) return staffFallback
    notFound()
  }
  if (item.catalogStatus === 'archived' || item.status === 'archived') notFound()
  if (item.recordId && !isCanonicalContentRoute('works', decodedSlug, item.recordId)) redirect(item.url)

  const bridgedItem = applyPublicRatingBridge(
    item,
    await readPublicRatingBridge(item.recordId),
  )

  return (
    <>
      <SearchIndexDetail item={bridgedItem} />
      <FeedbackPrompt item={item} />
    </>
  )
}
