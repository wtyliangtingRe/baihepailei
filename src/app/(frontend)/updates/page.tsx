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
          发布 {manifest.counts.catalogWorks.toLocaleString('zh-CN')} 条可检索作品、
          {manifest.counts.ratedWorks.toLocaleString('zh-CN')} 条 S–F 评级和
          {manifest.counts.nonratingTerminalWorks.toLocaleString('zh-CN')} 条显式非评级终态。

        </p>
        <Link className="result-link" href="/ratings">查看评级分布</Link>
      </article>
    </main>
  )
}
