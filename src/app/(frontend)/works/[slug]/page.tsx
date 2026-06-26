import { notFound } from 'next/navigation'

import DetailIndexDetail from '../../_components/DetailIndexDetail'
import EntityRelationCards from '../../_components/EntityRelationCards'
import FeedbackPrompt from '../../_components/FeedbackPrompt'
import MissingSearchIndex from '../../_components/MissingSearchIndex'
import SearchIndexDetail from '../../_components/SearchIndexDetail'
import VersionInfo from '../../_components/VersionInfo'
import { findDetailItem, findItemsByTitles, readDetailIndex, type DetailItem } from '../../_lib/detail-index'
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
        <EntityRelationCards
          groups={[
            {
              title: '关联创作者',
              description: '从作品条目的创作者字段匹配到的创作者详情页。',
              items: findItemsByTitles('creators', detailItem.creators),
            },
            {
              title: '关联机构',
              description: '从作品条目的机构字段匹配到的机构详情页。',
              items: findItemsByTitles('organizations', detailItem.organizations),
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

  const item = findSearchItem('works', decodedSlug)
  if (!item) notFound()

  return <SearchIndexDetail item={item} />
}
