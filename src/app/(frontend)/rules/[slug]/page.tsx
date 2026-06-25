import { notFound } from 'next/navigation'

import MissingSearchIndex from '../../_components/MissingSearchIndex'
import SearchIndexDetail from '../../_components/SearchIndexDetail'
import { findSearchItem, readSearchIndex } from '../../_lib/search-index'

type PageArgs = {
  params: Promise<{ slug: string }>
}

export default async function Page({ params }: PageArgs) {
  const { slug } = await params
  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const item = findSearchItem('rules', decodeURIComponent(slug))
  if (!item) notFound()

  return <SearchIndexDetail item={item} />
}
