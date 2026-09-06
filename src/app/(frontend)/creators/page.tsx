import CreatorDirectory, { type CreatorSearchParams } from '../_components/CreatorDirectory'

export const dynamic = 'force-dynamic'
export const metadata = { title: '作者 / 主创' }
export default function CreatorsPage({ searchParams }: { searchParams: CreatorSearchParams }) {
  return <CreatorDirectory kind="person" searchParams={searchParams} />
}
