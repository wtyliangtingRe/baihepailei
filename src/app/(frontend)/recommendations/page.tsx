import Link from 'next/link'

import DisplayAd from '../_components/DisplayAd'
import { getRecommendationBatch } from './get-batch'
import RecommendationList from './RecommendationList'

export const dynamic = 'force-dynamic'

export default function RecommendationsPage() {
  const batch = getRecommendationBatch()

  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">从高等级开始</p>
        <h1>安心向浏览</h1>
        <div className="collection-actions">
          <Link className="back-link" href="/works?grade=S">全部 S 级</Link>
          <Link className="back-link" href="/works?grade=A">全部 A 级</Link>
        </div>
      </section>
      <RecommendationList initialBatch={batch} />
      {process.env.NEXT_PUBLIC_ADSENSE_ENABLED === 'true' && batch.cards.length > 0 ? <DisplayAd /> : null}
    </main>
  )
}
