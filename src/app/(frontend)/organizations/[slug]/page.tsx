import { notFound } from 'next/navigation'

import DetailIndexDetail from '../../_components/DetailIndexDetail'
import MissingSearchIndex from '../../_components/MissingSearchIndex'
import SearchIndexDetail from '../../_components/SearchIndexDetail'
import VersionInfo from '../../_components/VersionInfo'
import { findDetailItem, findWorksByOrganizationName } from '../../_lib/detail-index'
import { findSearchItem, readSearchIndex } from '../../_lib/search-index'

type Args = {
  params: Promise<{ slug: string }>
}

export default async function OrganizationDetailPage({ params }: Args) {
  const { slug } = await params
  const decodedSlug = decodeURIComponent(slug)

  const detailItem = findDetailItem('organizations', decodedSlug)
  if (detailItem) {
    return (
      <>
        <DetailIndexDetail item={detailItem} relatedWorks={findWorksByOrganizationName(detailItem.title)} />
        <VersionInfo item={detailItem} />
      </>
    )
  }

  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const item = findSearchItem('organizations', decodedSlug)
  if (!item) notFound()

  return <SearchIndexDetail item={item} />
}
