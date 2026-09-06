import CreatorDirectory, { type CreatorSearchParams } from '../_components/CreatorDirectory'

export const dynamic = 'force-dynamic'
export const metadata = { title: '创作机构' }
export default function OrganizationsPage({ searchParams }: { searchParams: CreatorSearchParams }) {
  return <CreatorDirectory kind="organization" searchParams={searchParams} />
}
