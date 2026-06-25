import { notFound } from 'next/navigation'

import DetailIndexDetail from '../../_components/DetailIndexDetail'
import MissingSearchIndex from '../../_components/MissingSearchIndex'
import SearchIndexDetail from '../../_components/SearchIndexDetail'
import { findDetailItem } from '../../_lib/detail-index'
import { findSearchItem, readSearchIndex } from '../../_lib/search-index'

type PageArgs = {
  params: Promise<{ slug: string }>
}

export default async function Page({ params }: PageArgs) {
  const { slug } = await params
  const decodedSlug = decodeURIComponent(slug)

  const detailItem = findDetailItem('rules', decodedSlug)
  if (detailItem) return <DetailIndexDetail item={detailItem} />

  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const item = findSearchItem('rules', decodedSlug)
  if (!item) notFound()

  return <SearchIndexDetail item={item} />
}
