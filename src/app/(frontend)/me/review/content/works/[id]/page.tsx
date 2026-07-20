import { ContentReviewDetail } from '../../review-detail'

export const dynamic = 'force-dynamic'

type PageParams = Promise<{ id: string }>
type PageSearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function WorkContentReviewPage({ params, searchParams }: { params: PageParams; searchParams: PageSearchParams }) {
  const { id } = await params
  return ContentReviewDetail({ collection: 'works', id, searchParams })
}
