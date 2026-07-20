import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageParams = Promise<{ collection: string; id: string }>
type PageSearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function GenericContentReviewPage(_: { params: PageParams; searchParams: PageSearchParams }) {
  notFound()
}
