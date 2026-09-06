import CreatorDetail, { creatorMetadata } from '../../_components/CreatorDetail'
import type { CreatorSearchParams } from '../../_components/CreatorDirectory'

export const dynamic = 'force-dynamic'
type Props = { params: Promise<{ slug: string }>; searchParams: CreatorSearchParams }
export function generateMetadata({ params }: Props) { return creatorMetadata('organization', params) }
export default function OrganizationDetailPage(props: Props) {
  return <CreatorDetail kind="organization" {...props} />
}
