import { notFound, redirect } from 'next/navigation'

import DetailIndexDetail from '../../_components/DetailIndexDetail'
import FeedbackPrompt from '../../_components/FeedbackPrompt'
import MissingSearchIndex from '../../_components/MissingSearchIndex'
import SearchIndexDetail from '../../_components/SearchIndexDetail'
import VersionInfo from '../../_components/VersionInfo'
import { isCanonicalContentRoute } from '../../_lib/content-identity'
import { findDetailItem, findEvidenceByCreatorName, findWorksByCreatorName } from '../../_lib/detail-index'
import { findSearchItem, readSearchIndex } from '../../_lib/search-index'

type Args = {
  params: Promise<{ slug: string }>
}

export default async function CreatorDetailPage({ params }: Args) {
  const { slug } = await params
  const decodedSlug = decodeURIComponent(slug)

  const detailItem = findDetailItem('creators', decodedSlug)
  if (detailItem) {
    if (detailItem.recordId && !isCanonicalContentRoute('creators', decodedSlug, detailItem.recordId)) {
      redirect(detailItem.url)
    }
    return (
      <>
        <DetailIndexDetail
          item={detailItem}
          relatedEvidence={findEvidenceByCreatorName(detailItem.title)}
          relatedWorks={findWorksByCreatorName(detailItem.title)}
        />
        <VersionInfo item={detailItem} />
        <FeedbackPrompt item={detailItem} />
      </>
    )
  }

  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const item = findSearchItem('creators', decodedSlug)
  if (!item) notFound()
  if (item.recordId && !isCanonicalContentRoute('creators', decodedSlug, item.recordId)) redirect(item.url)

  return (
    <>
      <SearchIndexDetail item={item} />
      <FeedbackPrompt item={item} />
    </>
  )
}
