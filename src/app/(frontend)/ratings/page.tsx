import Link from 'next/link'

import {
  getPublicReleaseManifest,
  PUBLIC_GRADES,
  type PublicGrade,
} from '@/lib/publicRelease'

export const dynamic = 'force-dynamic'

const gradeCopy: Record<PublicGrade, { title: string; summary: string }> = {
  S: { title: '无争议核心百合', summary: '关系或长期承诺明确，属于当前最高置信区间。' },
  A: { title: '安心推荐', summary: '百合方向稳定；可能仍有连载、开放结局等边界。' },
  B: { title: '轻度条件推荐', summary: '已建立百合基线，同时保留轻度条件或上下文风险。' },
  C: { title: '有条件推荐', summary: '友情、配角、群像或上下文边界较明显。' },
  D: { title: '非核心 / 证据不足', summary: '包括一般向、路线不稳定，以及明确标记的证据不足型 D。' },
  E: { title: '重度排雷', summary: '现有证据支持较强的关系、路线或定位风险。' },
  F: { title: '高危排雷', summary: '现有权威结论支持结局级或欺诈级高风险。' },
}

export default function RatingsPage() {
  const manifest = getPublicReleaseManifest()
  const total = manifest.counts.ratedWorks

  return (
    <main className="page collection-page ratings-public-page release-ratings-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">当前可发布结论</p>
        <h1>{total.toLocaleString('zh-CN')} 条评级</h1>
        <p>
          这是当前持久化资料按权威规则闭环后的首发分布。评级只覆盖本轮审计中可以发布 S–F 结论的作品；
          117 条没有足够权威的记录保持独立终态，没有被凑数评级。
        </p>
        <div className="collection-actions">
          <Link className="result-link" href="/works?status=rated">浏览全部评级</Link>
          <Link className="back-link" href="/rules">查看完整规则</Link>
          <Link className="back-link" href="/radar">查看非评级终态</Link>
        </div>
      </section>

      <section className="release-grade-distribution" aria-label="评级分布">
        {PUBLIC_GRADES.map((grade) => {
          const count = manifest.gradeCounts[grade]
          const percent = (count / total) * 100
          return (
            <article className="release-grade-row" key={grade}>
              <Link className={`rating-chip grade-${grade}`} href={`/works?grade=${grade}`}>{grade}</Link>
              <div className="release-grade-copy">
                <div>
                  <h2>{gradeCopy[grade].title}</h2>
                  <strong>{count.toLocaleString('zh-CN')} 条 · {percent.toFixed(1)}%</strong>
                </div>
                <p>{gradeCopy[grade].summary}</p>
                <div className="release-grade-track" aria-hidden="true">
                  <span className={`grade-bg-${grade}`} style={{ width: `${percent}%` }} />
                </div>
              </div>
            </article>
          )
        })}
      </section>

      <section className="release-method-note release-d-unclear-note">
        <div>
          <p className="eyebrow">D 不等于“确定有雷”</p>
          <h2>{manifest.counts.dUnclearRatings.toLocaleString('zh-CN')} 条是证据不足型 D</h2>
        </div>
        <p>
          这批作品已有精确身份，但现存 Research 无法建立明确的百合 / 女性关系拓扑。
          按本轮闭环规则发布为 D，同时保留低置信与“仍需补证”；它不声称作品存在男性结局、NTR
          或任何其他具体负面情节。页面会把这类 D 单独标明。
        </p>
        <Link className="result-link" href="/works?grade=D">查看 D 级作品</Link>
      </section>

      <section className="release-integrity-grid">
        <article>
          <strong>0</strong>
          <span>重复审计 Work ID</span>
        </article>
        <article>
          <strong>0</strong>
          <span>未覆盖审计 Work ID</span>
        </article>
        <article>
          <strong>0</strong>
          <span>被改写的冻结源文件</span>
        </article>
        <article>
          <strong>100%</strong>
          <span>4,115 条终态覆盖</span>
        </article>
      </section>
    </main>
  )
}
