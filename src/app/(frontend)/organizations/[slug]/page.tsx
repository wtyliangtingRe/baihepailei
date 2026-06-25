import { notFound } from 'next/navigation'

import DetailIndexDetail from '../../_components/DetailIndexDetail'
import MissingSearchIndex from '../../_components/MissingSearchIndex'
import SearchIndexDetail from '../../_components/SearchIndexDetail'
import { findDetailItem, readDetailIndex, type DetailItem } from '../../_lib/detail-index'
import { findSearchItem, readSearchIndex } from '../../_lib/search-index'

type Args = {
  params: Promise<{ slug: string }>
}

function worksByOrganizationName(name: string) {
  const index = readDetailIndex()
  if (!index) return []

  return index.items
    .filter((item) => item.collection === 'works')
    .filter((item) => ((item as DetailItem & { organizations?: string[] }).organizations || []).includes(name))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
}

export default async function OrganizationDetailPage({ params }: Args) {
  const { slug } = await params
  const decodedSlug = decodeURIComponent(slug)

  const detailItem = findDetailItem('organizations' as never, decodedSlug)
  if (detailItem) {
    return <DetailIndexDetail item={detailItem} relatedWorks={worksByOrganizationName(detailItem.title)} />
  }

  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const item = findSearchItem('organizations', decodedSlug)
  if (!item) notFound()

  return <SearchIndexDetail item={item} />
}
