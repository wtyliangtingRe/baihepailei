import Link from 'next/link'

import {
  getPublicCatalogMergeStats,
  getPublicEnrichmentManifest,
  getPublicReleaseManifest,
  getPublicWorkList,
} from '@/lib/publicRelease'
import {
  compactCredits,
  gradeLabel,
  mediaLabel,
  ratingClassEntries,
} from '@/lib/radar/publicPresentation'

import { canonicalContentUrl } from './_lib/content-identity'

export const dynamic = 'force-dynamic'

function number(value: number): string {
  return value.toLocaleString('zh-CN')
}

export default function HomePage() {
  const manifest = getPublicReleaseManifest()
  const enrichment = getPublicEnrichmentManifest()
  const merge = getPublicCatalogMergeStats()
  const ratedVisible = getPublicWorkList({ status: 'rated', limit: 1 }).total
  const safeVisible =
    getPublicWorkList({ grade: 'S', status: 'rated', limit: 1 }).total +
    getPublicWorkList({ grade: 'A', status: 'rated', limit: 1 }).total
  const notAssessedVisible = merge.visibleWorks - ratedVisible
  const featured = [
    ...getPublicWorkList({ grade: 'S', status: 'rated', limit: 4 }).items,
    ...getPublicWorkList({ grade: 'A', status: 'rated', limit: 2 }).items,
  ]

  return (
    <main className="home release-home">
      <div className="home-stack">
        <section aria-labelledby="library-title" className="library-cover">
          <div className="library-intro">
            <h1 id="library-title">百合排雷资料库</h1>
            <p>查找百合漫画、动画、小说和游戏，了解作品中的关系走向、内容警示与评级依据。</p>
            <form action="/search" className="library-search" role="search">
              <label htmlFor="home-search-input">搜索作品、作者、机构或警示</label>
              <div>
                <input id="home-search-input" name="q" placeholder="作品名、别名或关键词" type="search" />
                <button type="submit">搜索</button>
              </div>
            </form>
            <nav aria-label="浏览资料库" className="library-shortcuts">
              <Link href="/works">全部作品</Link>
              <Link href="/works?status=rated">已有评级</Link>
              <Link href="/rules">警示细则</Link>
            </nav>
          </div>
          <div aria-hidden="true" className="library-art" />
        </section>

        <section className="release-stat-grid release-stat-grid-public" aria-label="公开资料概览">
          <article>
            <span>已有评级</span>
            <strong>{number(ratedVisible)}</strong>
            <small>S–F 评级作品</small>
          </article>
          <article>
            <span>S / A 级</span>
            <strong>{number(safeVisible)}</strong>
            <small>安心向优先入口</small>
          </article>
          <article>
            <span>可浏览作品</span>
            <strong>{number(merge.visibleWorks)}</strong>
            <small>动画、漫画、小说与游戏等</small>
          </article>
          <article>
            <span>已有来源简介</span>
            <strong>{number(enrichment.sources.workAssets.summaries)}</strong>
            <small>有可核验简介资料</small>
          </article>
        </section>

        <section className="release-section">
          <div className="release-section-heading">
            <div>
              <h2>安心向作品</h2>
            </div>
            <Link className="back-link" href="/recommendations">浏览全部 S / A 级作品</Link>
          </div>
          <div className="release-featured-grid">
            {featured.map((work) => {
              const firstClass = ratingClassEntries(work.rating)[0]
              const credits = work.creators.length
                ? compactCredits(work.creators, 1)
                : work.organizations.length
                  ? compactCredits(work.organizations, 1)
                  : ''
              return (
                <Link className="release-featured-card" href={canonicalContentUrl('works', work.workId)} key={work.workId}>
                  <span className={`rating-chip grade-${work.rating.grade}`}>{work.rating.grade}</span>
                  <div>
                    <h3>{work.title}</h3>
                    <p>
                      {mediaLabel(work.media.group, work.media.type)} · {firstClass?.definition.label || gradeLabel(work.rating.grade!)}
                      {credits ? ` · ${credits}` : ''}
                    </p>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>

        <section className="release-reading-model release-home-guide">
          <article>
            <h2>看核心等级</h2>
            <p>S–F 先说明整体关系与风险区间。</p>
          </article>
          <article>
            <h2>看警示标签</h2>
            <p>男性关系、路线、设定与结局分别列出。</p>
          </article>
          <article>
            <h2>看依据与缺口</h2>
            <p>结合结论范围、资料日期与待补信息阅读。</p>
          </article>
        </section>

        <section className="release-method-note release-method-note-public">
          <div>
            <h2>资料完善进度</h2>
          </div>
          <p>
            目前有 {number(notAssessedVisible)} 部作品尚未评级。
            另有 {number(manifest.counts.dUnclearRatings)} 条资料不足型 D 评级记录，标注为“具体雷点未确认”，仍需进一步核实。
          </p>
          <Link className="result-link" href="/works">进入作品资料库</Link>
        </section>
        <details className="library-disclaimer">
          <summary>评级说明与免责声明</summary>
          <p>本站借助 AI 收集资料、辅助评级，可能出现误判或遗漏。评级以已核实的版本和剧情为准，连载进展、改编和新资料都可能改变结论。尚未评级或缺少警示的作品仍需核验。</p>
          <p>如发现错误，可在<Link href="/feedback">补充纠错页</Link>提交作品名、版本与相关依据。</p>
        </details>
      </div>
    </main>
  )
}
