import Link from 'next/link'

import { getPublicWorkList } from '@/lib/publicRelease'

import { canonicalContentUrl } from '../_lib/content-identity'

export const dynamic = 'force-dynamic'

export default function RecommendationsPage() {
  const works = [
    ...getPublicWorkList({ grade: 'S', status: 'rated', limit: 12 }).items,
    ...getPublicWorkList({ grade: 'A', status: 'rated', limit: 6 }).items,
  ]

  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">从高等级开始</p>
        <h1>安心向浏览</h1>
        <p>
          这里不另造“推荐分”。首版只从当前 S / A 评级中提供一个浏览入口；
          具体版本边界、置信状态与补证标记仍以作品详情页为准。
        </p>
        <div className="collection-actions">
          <Link className="back-link" href="/works?grade=S">全部 S 级</Link>
          <Link className="back-link" href="/works?grade=A">全部 A 级</Link>
        </div>
      </section>
      <section className="release-featured-grid">
        {works.map((work) => (
          <Link className="release-featured-card" href={canonicalContentUrl('works', work.workId)} key={work.workId}>
            <span className={`rating-chip grade-${work.rating.grade}`}>{work.rating.grade}</span>
            <div>
              <h3>{work.title}</h3>
              <p>Work {work.workId} · {work.identity.provider}</p>
            </div>
            <span aria-hidden="true">↗</span>
          </Link>
        ))}
      </section>
    </main>
  )
}
