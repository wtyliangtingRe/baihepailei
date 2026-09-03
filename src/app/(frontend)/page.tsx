import Link from 'next/link'

import {
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
            当前已有 {number(manifest.counts.ratedWorks)} 条公开评级
          </div>
          <p className="eyebrow">百合作品评级与排雷资料库</p>
          <h1>先看关系结论，<br />再看具体雷点。</h1>
          <p className="release-hero-copy">
            搜索作品后，你会直接看到 S–F 等级、具体警示、评级理由、作品类型，
            以及当前已经核实的作者、创作机构、简介与来源。资料没有补齐的部分会明确留空。
          </p>
          <form action="/search" className="search-box release-search" role="search">
            <label htmlFor="home-search-input">搜索作品、作者、制作机构或警示</label>
            <div>
              <input id="home-search-input" name="q" placeholder="例如：终将成为你、仲谷鳰、男性替身" type="search" />
              <button className="result-link" type="submit">查作品</button>
            </div>
          </form>
          <div className="actions">
            <Link className="release-primary-action" href="/works?status=rated">浏览已有评级</Link>
            <Link href="/ratings">评级怎么读</Link>
            <Link href="/rules">查看警示细则</Link>
          </div>
        </section>

        <section className="release-stat-grid release-stat-grid-public" aria-label="公开资料概览">
          <article>
            <span>已有评级</span>
            <strong>{number(manifest.counts.ratedWorks)}</strong>
            <small>S–F 当前结论</small>
          </article>
          <article>
            <span>S / A 级</span>
            <strong>{number(manifest.gradeCounts.S + manifest.gradeCounts.A)}</strong>
            <small>安心向优先入口</small>
          </article>
          <article>
            <span>可检索作品</span>
            <strong>{number(manifest.counts.catalogWorks)}</strong>
            <small>动画、漫画、小说与游戏</small>
          </article>
          <article>
            <span>已恢复来源摘要</span>
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
            <p>结论摘要、范围和待补资料不会藏起来。</p>
          </article>
        </section>

        <section className="release-method-note release-method-note-public">
          <div>
            <p className="eyebrow">当前资料边界</p>
            <h2>有多少可靠资料，就展示多少。</h2>
          </div>
          <p>
            {number(manifest.counts.dUnclearRatings)} 条资料不足型 D 会明确写“具体雷点未确认”；
            {number(manifest.counts.notAssessedWorks)} 部作品尚未评级。缺少作者、机构或细分类时保持空缺，
            不用旧结论和标题猜测填满页面。
          </p>
          <Link className="result-link" href="/works">进入作品资料库</Link>
        </section>
      </div>
    </main>
  )
}
