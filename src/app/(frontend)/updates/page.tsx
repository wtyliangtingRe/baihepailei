import Link from 'next/link'

import {
  getPublicEnrichmentManifest,
  getPublicReleaseManifest,
} from '@/lib/publicRelease'

export const dynamic = 'force-dynamic'

export default function UpdatesPage() {
  const manifest = getPublicReleaseManifest()
  const enrichment = getPublicEnrichmentManifest()

  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">版本记录</p>
        <h1>最近更新</h1>
        <p>这里记录用户实际能看到的资料与规则变化。</p>
      </section>
      <article className="release-snapshot-note">
        <div>
          <p className="eyebrow">2026-09-03 · 本地预览候选</p>
          <h2>作品资料与警示回到主位</h2>
        </div>
        <p>
          全目录补入作品类型；恢复 {enrichment.sources.workAssets.summaries.toLocaleString('zh-CN')} 条可核验来源摘要，
          并为 {enrichment.sources.ratingDetails.uniqueRows.toLocaleString('zh-CN')} 条评级补回具体理由或范围。
          作品页不再把内部身份字段当成主要内容。
        </p>
        <Link className="result-link" href="/works">查看新版作品页</Link>
      </article>
      <article className="release-snapshot-note">
        <div>
          <p className="eyebrow">2026-09-02 · 数据快照</p>
          <h2>当前数据闭环</h2>
        </div>
        <p>
          发布 {manifest.counts.catalogWorks.toLocaleString('zh-CN')} 条可检索作品、
          {manifest.counts.ratedWorks.toLocaleString('zh-CN')} 条 S–F 评级和
          {manifest.counts.nonratingTerminalWorks.toLocaleString('zh-CN')} 条显式非评级终态。
          停止等待额外数据，后续更新采用追加版本。
        </p>
        <Link className="result-link" href="/ratings">查看首发评级</Link>
      </article>
    </main>
  )
}
