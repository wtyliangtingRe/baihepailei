import { notFound } from 'next/navigation'

import MissingSearchIndex from '../../_components/MissingSearchIndex'
import SearchIndexDetail from '../../_components/SearchIndexDetail'
import { findSearchItem, readSearchIndex } from '../../_lib/search-index'

type Args = {
  params: Promise<{ slug: string }>
}

export default async function CreatorDetailPage({ params }: Args) {
  const { slug } = await params
  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const item = findSearchItem('creators', decodeURIComponent(slug))
  if (!item) notFound()

  return <SearchIndexDetail item={item} />
}
