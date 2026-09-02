import Link from 'next/link'

import { getPublicReleaseManifest } from '@/lib/publicRelease'

export const dynamic = 'force-dynamic'

export default function UpdatesPage() {
  const manifest = getPublicReleaseManifest()

  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">版本记录</p>
        <h1>最近更新</h1>
        <p>这里记录公开快照，而不是伪装成实时流的内部研究活动。</p>
      </section>
      <article className="release-snapshot-note">
        <div>
          <p className="eyebrow">2026-09-02 · 首发候选</p>
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
