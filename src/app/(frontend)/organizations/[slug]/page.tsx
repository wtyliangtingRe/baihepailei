import { notFound, redirect } from 'next/navigation'

import DetailIndexDetail from '../../_components/DetailIndexDetail'
import FeedbackPrompt from '../../_components/FeedbackPrompt'
import MissingSearchIndex from '../../_components/MissingSearchIndex'
import SearchIndexDetail from '../../_components/SearchIndexDetail'
import VersionInfo from '../../_components/VersionInfo'
import { isCanonicalContentRoute } from '../../_lib/content-identity'
import { findDetailItem, findEvidenceByOrganizationName, findWorksByOrganizationName } from '../../_lib/detail-index'
import { findSearchItem, readSearchIndex } from '../../_lib/search-index'

type Args = {
  params: Promise<{ slug: string }>
}

export default async function OrganizationDetailPage({ params }: Args) {
  const { slug } = await params
  const decodedSlug = decodeURIComponent(slug)
  const detailItem = findDetailItem('organizations', decodedSlug)

  if (detailItem) {
    if (detailItem.recordId && !isCanonicalContentRoute('organizations', decodedSlug, detailItem.recordId)) {
      redirect(detailItem.url)
    }
    return (
      <>
        <DetailIndexDetail item={detailItem} relatedEvidence={findEvidenceByOrganizationName(detailItem.title)} relatedWorks={findWorksByOrganizationName(detailItem.title)} />
        <VersionInfo item={detailItem} />
        <FeedbackPrompt item={detailItem} />
      </>
    )
  }

  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const item = findSearchItem('organizations', decodedSlug)
  if (!item) notFound()
  if (item.recordId && !isCanonicalContentRoute('organizations', decodedSlug, item.recordId)) redirect(item.url)
  return (
    <>
      <SearchIndexDetail item={item} />
      <FeedbackPrompt item={item} />
    </>
  )
}
