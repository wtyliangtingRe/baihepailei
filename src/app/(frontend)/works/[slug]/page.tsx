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
import { findDetailItem, findEvidenceByWorkTitle, type DetailItem } from '../../_lib/detail-index'
import { findSearchItem, readSearchIndex } from '../../_lib/search-index'

type Args = {
  params: Promise<{ slug: string }>
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
  status?: string
  updatedAt?: string
  createdAt?: string
  radarAssessment?: { assessedAt?: string; suggestedGrade?: string }
}

const staffRoles = new Set(['owner', 'admin', 'editor', 'reviewer'])

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
      draft: true,
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
    status: live.status || indexed.status,
    updatedAt: live.updatedAt || indexed.updatedAt,
    createdAt: live.createdAt || indexed.createdAt,
    radarAssessment: live.radarAssessment || indexed.radarAssessment,
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
        <p className="eyebrow">内部条目预览</p>
        <h1>{doc.title || `作品 ${doc.id}`}</h1>
        <div className="work-card-badges"><span className="work-type-chip">{doc.rank && doc.rank !== 'unknown' ? `${doc.rank} 级` : '尚未分级'}</span><AssessmentOriginBadge item={{ collection: 'works', ratingNotice: doc.ratingNotice, reviewStatus: doc.reviewStatus, radarAssessment: doc.radarAssessment }} /><span className="work-type-chip">{doc.status || 'draft'}</span></div>
        <p>这条记录已经存在于数据库，但你当前的公开索引还没有包含它，所以此前会显示 404。重新生成完整版索引后，普通访客也能从这个站内 ID 地址查看完整页面。</p>
        <div className="collection-actions"><Link className="result-link" href={`/me/review/content/works/${doc.id}`}>在站内编辑台修改</Link><Link className="back-link" href={`/admin/collections/works/${doc.id}`}>Payload 高级维护</Link><Link className="back-link" href="/works">返回作品列表</Link></div>
      </section>
    </main>
  )
}

export default async function WorkDetailPage({ params }: Args) {
  const { slug } = await params
  const decodedSlug = decodeURIComponent(slug)

  const detailItem = findDetailItem('works', decodedSlug)
  if (detailItem) {
    if (detailItem.recordId && !isCanonicalContentRoute('works', decodedSlug, detailItem.recordId)) {
      redirect(detailItem.url)
    }
    const live = detailItem.recordId ? await staffLiveWork(String(detailItem.recordId)) : null
    const visibleItem = live ? liveDetailItem(detailItem, live) : detailItem
    return (
      <>
        {live ? (
          <section className="page" aria-label="工作人员实时预览提示">
            <div className="detail-card review-safety-note">
              <strong>工作人员实时预览</strong>
              <p>下面的标题、正式分级、复核状态和更新时间已叠加数据库最新值。普通访客仍读取稳定的公开索引，完成一批审核后再统一导出即可。</p>
            </div>
          </section>
        ) : null}
        <DetailIndexDetail item={visibleItem} relatedEvidence={findEvidenceByWorkTitle(visibleItem.title)} />
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
  if (item.recordId && !isCanonicalContentRoute('works', decodedSlug, item.recordId)) redirect(item.url)

  return (
    <>
      <SearchIndexDetail item={item} />
      <FeedbackPrompt item={item} />
    </>
  )
}
