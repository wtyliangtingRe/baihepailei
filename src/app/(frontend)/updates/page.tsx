import Link from 'next/link'

import {
  getPublicEnrichmentManifest,
  getPublicRecentWorks,
  getPublicCatalogMergeStats,
} from '@/lib/publicRelease'

import { gradeLabel, mediaLabel } from '@/lib/radar/publicPresentation'
import { canonicalContentUrl } from '../_lib/content-identity'

export const dynamic = 'force-dynamic'

export default function UpdatesPage() {
  const catalog = getPublicCatalogMergeStats()
  const enrichment = getPublicEnrichmentManifest()
  const recent = getPublicRecentWorks()

  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">版本记录</p>
        <h1>最近更新</h1>
        <p>这里记录用户实际能看到的资料与规则变化。</p>
      </section>
      {recent.length > 0 && <section className="release-section" id="recent-works" aria-labelledby="recent-works-title">
        <div className="release-section-heading">
          <div><h2 id="recent-works-title">2026 年秋季新作评级</h2><p>9 月 1 日至 11 月 22 日 · {recent.length} 部 · 按发行日期排列</p></div>
        </div>
        <ul className="creator-works">
          {recent.map(({ work, releasedOn, scope, title }) => (
            <li key={work.workId}>
              <div className="creator-work-title">
                <Link href={canonicalContentUrl('works', work.workId)}>{title}</Link>
                <span><time dateTime={releasedOn}>{releasedOn}</time> · {mediaLabel(work.media.group, work.media.type)}</span>
                <small>{scope}</small>
              </div>
              <Link className="creator-work-rating" href={canonicalContentUrl('works', work.workId)} aria-label={`查看《${title}》的评级`}>
                <span className={`rating-chip grade-${work.rating.grade}`}>{work.rating.grade}</span>
                <small>{gradeLabel(work.rating.grade!)} · {work.rating.decidingSource === 'official' ? '官方来源' : '社区来源'}</small>
              </Link>
            </li>
          ))}
        </ul>
      </section>}
      <article className="release-snapshot-note">
        <div><p className="eyebrow">2026-11-21</p><h2>逐作复核与来源标签</h2></div>
        <p>作品页现在列出官方资料和社区资料各自支持的等级。部分旧评级仅补核了出处，仍沿用原调查记录。全库复核进行中。</p>
        <Link className="result-link" href="/rules">查看评级规则</Link>
      </article>
      <article className="release-snapshot-note">
        <div>
          <p className="eyebrow">2026-09-03 · 本地预览候选</p>
          <h2>作品资料与警示回到主位</h2>
        </div>
        <p>
          全目录补入作品类型；恢复 {enrichment.sources.workAssets.summaries.toLocaleString('zh-CN')} 条可核验来源摘要，
          并为 {enrichment.sources.ratingDetails.uniqueRows.toLocaleString('zh-CN')} 条评级补回具体理由或范围。
          作品页优先展示读者需要的基本资料、创作信息、评级理由与具体警示。
        </p>
        <Link className="result-link" href="/works">查看新版作品页</Link>
      </article>
      <article className="release-snapshot-note">
        <div>
          <p className="eyebrow">当前目录</p>
          <h2>目录收录情况</h2>
        </div>
        <p>
          合并同一作品的重复记录后，可浏览 {catalog.visibleWorks.toLocaleString('zh-CN')} 部作品。
          其中 {catalog.reviewedVisibleWorks.toLocaleString('zh-CN')} 部已按本轮规则复评，
          {(catalog.ratedVisibleWorks - catalog.reviewedVisibleWorks).toLocaleString('zh-CN')} 部沿用先前评级，
          {(catalog.visibleWorks - catalog.ratedVisibleWorks).toLocaleString('zh-CN')} 部待评级。
        </p>
        <Link className="result-link" href="/ratings">查看评级分布</Link>
      </article>
    </main>
  )
}
