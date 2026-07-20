import { notFound } from 'next/navigation'

import { ContentReviewDetail } from '../../review-detail'
import type { ContentCollection } from '../../review-actions'

export const dynamic = 'force-dynamic'

type PageParams = Promise<{ collection: string; id: string }>
type PageSearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function GenericContentReviewPage({ params, searchParams }: { params: PageParams; searchParams: PageSearchParams }) {
  const { collection, id } = await params
  if (collection !== 'creators' && collection !== 'organizations') notFound()
  return ContentReviewDetail({ collection: collection as ContentCollection, id, searchParams })
}
