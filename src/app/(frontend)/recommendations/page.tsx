import Link from 'next/link'

import { getPublicWorkList } from '@/lib/publicRelease'
import {
  gradeLabel,
  mediaLabel,
  ratingClassEntries,
} from '@/lib/radar/publicPresentation'

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
          这里不另造“推荐分”，只从当前 S / A 评级中提供浏览入口。
          每部作品仍需结合细分类、连载边界与资料完整度阅读。
        </p>
        <div className="collection-actions">
          <Link className="back-link" href="/works?grade=S">全部 S 级</Link>
          <Link className="back-link" href="/works?grade=A">全部 A 级</Link>
        </div>
      </section>
      <section className="release-featured-grid">
        {works.map((work) => {
          const firstClass = ratingClassEntries(work.rating)[0]
          return (
            <Link className="release-featured-card" href={canonicalContentUrl('works', work.workId)} key={work.workId}>
              <span className={`rating-chip grade-${work.rating.grade}`}>{work.rating.grade}</span>
              <div>
                <h3>{work.title}</h3>
                <p>
                  {mediaLabel(work.media.group, work.media.type)} · {firstClass?.definition.label || gradeLabel(work.rating.grade!)}
                </p>
              </div>
              <span aria-hidden="true">↗</span>
            </Link>
          )
        })}
      </section>
    </main>
  )
}
