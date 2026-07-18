import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageParams = Promise<{ id: string }>
type PageSearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

export default async function LegacyReviewWorkEditorRedirect({ params, searchParams }: { params: PageParams; searchParams: PageSearchParams }) {
  const { id } = await params
  const raw = await searchParams
  const returnTo = first(raw.returnTo) || '/me/review/content'
  redirect(`/me/studio/works/${encodeURIComponent(id)}?returnTo=${encodeURIComponent(returnTo)}`)
}
