import { notFound } from 'next/navigation'

import DetailIndexDetail from '../../_components/DetailIndexDetail'
import MissingSearchIndex from '../../_components/MissingSearchIndex'
import SearchIndexDetail from '../../_components/SearchIndexDetail'
import VersionInfo from '../../_components/VersionInfo'
import { findDetailItem, readDetailIndex, type DetailItem } from '../../_lib/detail-index'
import { findSearchItem, readSearchIndex } from '../../_lib/search-index'

type Args = {
  params: Promise<{ slug: string }>
}

type EvidenceDetailItem = DetailItem & {
  relatedWorks?: string[]
}

function evidenceByWorkTitle(title: string) {
  const index = readDetailIndex()
  if (!index) return []

  return index.items
    .filter((item) => item.collection === 'evidence')
    .filter((item) => ((item as EvidenceDetailItem).relatedWorks || []).includes(title))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
}

export default async function WorkDetailPage({ params }: Args) {
  const { slug } = await params
  const decodedSlug = decodeURIComponent(slug)

  const detailItem = findDetailItem('works', decodedSlug)
  if (detailItem) {
    return (
      <>
        <DetailIndexDetail item={detailItem} relatedEvidence={evidenceByWorkTitle(detailItem.title)} />
        <VersionInfo item={detailItem} />
      </>
    )
  }

  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const item = findSearchItem('works', decodedSlug)
  if (!item) notFound()

  return <SearchIndexDetail item={item} />
}
