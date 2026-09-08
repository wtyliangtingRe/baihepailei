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
  const notAssessedVisible = getPublicWorkList({ status: 'not_assessed', limit: 1 }).total
  const featured = [
    ...getPublicWorkList({ grade: 'S', status: 'rated', limit: 4 }).items,
    ...getPublicWorkList({ grade: 'A', status: 'rated', limit: 2 }).items,
  ]

  return (
    <main className="home release-home">
      <div className="home-stack">
        <section className="hero release-hero">
          <div className="release-kicker">
            <span className="release-live-dot" aria-hidden="true" />
            当前已有 {number(ratedVisible)} 部作品公开评级
          </div>
          <p className="eyebrow">百合作品评级与排雷资料库</p>
          <h1>关于百合排雷</h1>
          <p className="release-hero-copy">
            本站收录百合及相关作品，整理作品资料、作者与创作机构、关系评级和具体雷点，
            帮助读者查找作品、了解内容，并按自己的偏好选择阅读、观看或游玩。
          </p>
          <aside className="release-disclaimer" aria-labelledby="site-disclaimer-title">
            <h2 id="site-disclaimer-title">免责声明</h2>
            <p>
              本站主要借助 AI 收集资料与辅助评级，可能存在误判、遗漏或理解偏差，内容仅供参考。
              目前维护人手有限，许多作品仍缺少资料或尚未评级；空白条目和缺失警示不代表作品已经确认安全。
            </p>
            <p>
              评级以当时收集到的资料为依据。连载进展、后续剧情、版本差异及新增信息都可能影响结论，
              站内更新也可能滞后，请结合具体版本、资料日期和原作内容阅读。
              如有异议或补充，欢迎通过<Link href="/feedback">补充纠错页的表单或联系方式</Link>反馈，并附上作品名与相关依据。
            </p>
          </aside>
          <form action="/search" className="search-box release-search" role="search">
            <label htmlFor="home-search-input">搜索作品、作者、制作机构或警示</label>
            <div>
              <input id="home-search-input" name="q" placeholder="例如：终将成为你、仲谷鳰、男性替身" type="search" />
              <button className="result-link" type="submit">查作品</button>
            </div>
          </form>
          <div className="actions">
            <Link className="release-primary-action" href="/works?status=rated">浏览已有评级</Link>
            <Link href="/ratings">评级原则</Link>
            <Link href="/rules">查看警示细则</Link>
          </div>
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
              <p className="eyebrow">从高等级开始</p>
              <h2>当前安心向作品</h2>
            </div>
            <Link className="back-link" href="/recommendations">查看完整入口</Link>
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
                  <span aria-hidden="true">↗</span>
                </Link>
              )
            })}
          </div>
        </section>

        <section className="release-reading-model release-home-guide">
          <article>
            <span>1</span>
            <h2>看核心等级</h2>
            <p>S–F 先说明整体关系与风险区间。</p>
          </article>
          <article>
            <span>2</span>
            <h2>看警示标签</h2>
            <p>男性关系、路线、设定与结局分别列出。</p>
          </article>
          <article>
            <span>3</span>
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
      </div>
    </main>
  )
}
