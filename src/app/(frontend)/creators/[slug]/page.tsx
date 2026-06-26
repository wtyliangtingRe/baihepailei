import { notFound } from 'next/navigation'

import DetailIndexDetail from '../../_components/DetailIndexDetail'
import EntityRelationCards from '../../_components/EntityRelationCards'
import FeedbackPrompt from '../../_components/FeedbackPrompt'
import MissingSearchIndex from '../../_components/MissingSearchIndex'
import SearchIndexDetail from '../../_components/SearchIndexDetail'
import VersionInfo from '../../_components/VersionInfo'
import { findDetailItem, findOrganizationsByCreatorName, findWorksByCreatorName } from '../../_lib/detail-index'
import { findSearchItem, readSearchIndex } from '../../_lib/search-index'

type Args = {
  params: Promise<{ slug: string }>
}

export default async function CreatorDetailPage({ params }: Args) {
  const { slug } = await params
  const decodedSlug = decodeURIComponent(slug)

  const detailItem = findDetailItem('creators', decodedSlug)
  if (detailItem) {
    const relatedWorks = findWorksByCreatorName(detailItem.title)
    return (
      <>
        <DetailIndexDetail item={detailItem} relatedWorks={relatedWorks} />
        <EntityRelationCards
          groups={[
            {
              title: '相关作品',
              description: '从作品条目的创作者字段反查到的作品。',
              items: relatedWorks,
            },
            {
              title: '相关机构',
              description: '通过相关作品继续反查到的机构。',
              items: findOrganizationsByCreatorName(detailItem.title),
            },
          ]}
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

  return <SearchIndexDetail item={item} />
}
