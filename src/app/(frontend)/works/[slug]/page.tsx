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
import { findDetailItem, findEvidenceByWorkTitle } from '../../_lib/detail-index'
import { findSearchItem, readSearchIndex } from '../../_lib/search-index'

type Args = {
  params: Promise<{ slug: string }>
}

const staffRoles = new Set(['owner', 'admin', 'editor', 'reviewer'])

async function unindexedStaffWork(routeKey: string) {
  const recordID = recordIdFromContentRoute('works', routeKey)
  if (!recordID) return null

  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  const role = auth.user && typeof auth.user === 'object' ? String((auth.user as { role?: string }).role || '') : ''
  if (!auth.user || !staffRoles.has(role)) return null

  try {
    const doc = await payload.findByID({ collection: 'works', id: recordID, depth: 0, overrideAccess: true }) as unknown as {
      id: string | number
      title?: string
      rank?: string
      reviewStatus?: string
      ratingNotice?: string
      radarAssessment?: { assessedAt?: string; suggestedGrade?: string }
      status?: string
    }
    return (
      <main className="page collection-page">
        <section className="detail-card unindexed-content-notice">
          <p className="eyebrow">内部条目预览</p>
          <h1>{doc.title || `作品 ${doc.id}`}</h1>
          <div className="work-card-badges"><span className="work-type-chip">{doc.rank && doc.rank !== 'unknown' ? `${doc.rank} 级` : '尚未分级'}</span><AssessmentOriginBadge item={{ collection: 'works', ratingNotice: doc.ratingNotice, reviewStatus: doc.reviewStatus, radarAssessment: doc.radarAssessment }} /><span className="work-type-chip">{doc.status || 'draft'}</span></div>
          <p>这条记录已经存在于数据库，但你当前的公开索引还没有包含它，所以此前会显示 404。重新生成完整版索引后，普通访客也能从这个站内 ID 地址查看完整页面。</p>
          <div className="collection-actions"><Link className="result-link" href={`/me/review/content?collection=works&q=${encodeURIComponent(String(doc.id))}`}>在站内工作台编辑</Link><Link className="back-link" href={`/admin/collections/works/${doc.id}`}>Payload 完整编辑</Link><Link className="back-link" href="/works">返回作品列表</Link></div>
        </section>
      </main>
    )
  } catch {
    return null
  }
}

export default async function WorkDetailPage({ params }: Args) {
  const { slug } = await params
  const decodedSlug = decodeURIComponent(slug)

  const detailItem = findDetailItem('works', decodedSlug)
  if (detailItem) {
    if (detailItem.recordId && !isCanonicalContentRoute('works', decodedSlug, detailItem.recordId)) {
      redirect(detailItem.url)
    }
    return (
      <>
        <DetailIndexDetail item={detailItem} relatedEvidence={findEvidenceByWorkTitle(detailItem.title)} />
        <VersionInfo item={detailItem} />
        <FeedbackPrompt item={detailItem} />
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
