import Link from 'next/link'

import {
  getPublicReleaseManifest,
  getPublicWorkList,
} from '@/lib/publicRelease'

import { canonicalContentUrl } from './_lib/content-identity'

export const dynamic = 'force-dynamic'

function number(value: number): string {
  return value.toLocaleString('zh-CN')
}

export default function HomePage() {
  const manifest = getPublicReleaseManifest()
  const featured = getPublicWorkList({ grade: 'S', status: 'rated', limit: 6 }).items

  return (
    <main className="home release-home">
      <div className="home-stack">
        <section className="hero release-hero">
          <div className="release-kicker">
            <span className="release-live-dot" aria-hidden="true" />
            首发数据已冻结 · 不再等待增量
          </div>
          <p className="eyebrow">百合作品评级与排雷资料库</p>
          <h1>先把现在知道的，<br />诚实地摆出来。</h1>
          <p className="release-hero-copy">
            当前收录 {number(manifest.counts.catalogWorks)} 个作品身份；其中 {number(manifest.counts.auditedWorks)}
            个进入本轮完整审计，{number(manifest.counts.ratedWorks)} 个已有 S–F 评级。
            证据不够的项目会明确标成低置信、仅资料、冲突或阻断，不会被硬塞进一个看似确定的等级。
          </p>
          <form action="/search" className="search-box release-search" role="search">
            <label htmlFor="home-search-input">搜索作品、Work ID 或外部站点 ID</label>
            <div>
              <input id="home-search-input" name="q" placeholder="例如：Work 4974、作品名、Bangumi ID" type="search" />
              <button className="result-link" type="submit">开始搜索</button>
            </div>
          </form>
          <div className="actions">
            <Link className="release-primary-action" href="/works?status=rated">查看全部评级</Link>
            <Link href="/ratings">评级分布</Link>
            <Link href="/radar">数据缺口说明</Link>
          </div>
        </section>

        <section className="release-stat-grid" aria-label="首发快照统计">
          <article>
            <span>公开目录</span>
            <strong>{number(manifest.counts.catalogWorks)}</strong>
            <small>当前可检索作品身份</small>
          </article>
          <article>
            <span>完整审计</span>
            <strong>{number(manifest.counts.auditedWorks)}</strong>
            <small>全量去重后的研究集合</small>
          </article>
          <article>
            <span>已评级</span>
            <strong>{number(manifest.counts.ratedWorks)}</strong>
            <small>S–F 当前结论</small>
          </article>
          <article>
            <span>显式终态</span>
            <strong>{number(manifest.counts.nonratingTerminalWorks)}</strong>
            <small>仅资料 / 冲突 / 阻断 / 待研究</small>
          </article>
        </section>

        <section className="release-section">
          <div className="release-section-heading">
            <div>
              <p className="eyebrow">S 级样例</p>
              <h2>当前最高等级作品</h2>
            </div>
            <Link className="back-link" href="/works?grade=S">查看 {number(manifest.gradeCounts.S)} 条 S 级</Link>
          </div>
          <div className="release-featured-grid">
            {featured.map((work) => (
              <Link className="release-featured-card" href={canonicalContentUrl('works', work.workId)} key={work.workId}>
                <span className="rating-chip grade-S">S</span>
                <div>
                  <h3>{work.title}</h3>
                  <p>Work {work.workId} · {work.identity.provider}</p>
                </div>
                <span aria-hidden="true">↗</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="release-method-note">
          <div>
            <p className="eyebrow">这版怎么处理不确定性</p>
            <h2>当前数据先上线，边界原样保留。</h2>
          </div>
          <p>
            {number(manifest.counts.dUnclearRatings)} 条证据不足型 D 会显示“低置信 / 待补证”；
            {number(manifest.nonratingTerminalBreakdown.research_record_only)} 条没有 Assessment 的记录只作为资料；
            剩余冲突、阻断与专项研究项也保留独立状态。后续补证通过新版本追加，不改写这次快照。
          </p>
          <Link className="result-link" href="/rules">阅读评级与发布规则</Link>
        </section>
      </div>
    </main>
  )
}

