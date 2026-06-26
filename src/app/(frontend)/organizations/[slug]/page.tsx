import { notFound } from 'next/navigation'

import DetailIndexDetail from '../../_components/DetailIndexDetail'
import EntityRelationCards from '../../_components/EntityRelationCards'
import FeedbackPrompt from '../../_components/FeedbackPrompt'
import MissingSearchIndex from '../../_components/MissingSearchIndex'
import SearchIndexDetail from '../../_components/SearchIndexDetail'
import VersionInfo from '../../_components/VersionInfo'
import { findCreatorsByOrganizationName, findDetailItem, findWorksByOrganizationName } from '../../_lib/detail-index'
import { findSearchItem, readSearchIndex } from '../../_lib/search-index'

type Args = {
  params: Promise<{ slug: string }>
}

export default async function OrganizationDetailPage({ params }: Args) {
  const { slug } = await params
  const decodedSlug = decodeURIComponent(slug)

  const detailItem = findDetailItem('organizations', decodedSlug)
  if (detailItem) {
    const relatedWorks = findWorksByOrganizationName(detailItem.title)
    return (
      <>
        <DetailIndexDetail item={detailItem} relatedWorks={relatedWorks} />
        <EntityRelationCards
          groups={[
            {
              title: '相关作品',
              description: '从作品条目的机构字段反查到的作品。',
              items: relatedWorks,
            },
            {
              title: '相关创作者',
              description: '通过相关作品继续反查到的创作者。',
              items: findCreatorsByOrganizationName(detailItem.title),
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

  const item = findSearchItem('organizations', decodedSlug)
  if (!item) notFound()

  return <SearchIndexDetail item={item} />
}
