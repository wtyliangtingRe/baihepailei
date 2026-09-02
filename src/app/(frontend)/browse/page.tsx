import Link from 'next/link'

import { getPublicReleaseManifest } from '@/lib/publicRelease'

export const dynamic = 'force-dynamic'

export default function BrowsePage() {
  const manifest = getPublicReleaseManifest()

  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">首发数据范围</p>
        <h1>目前有多少，就上线多少。</h1>
        <p>
          网站直接读取版本化公开快照，不依赖开发机数据库。身份目录、审计集合、评级与非评级终态各自有明确边界，
          因此本地预览和 AWS 运行会看到同一份结果。
        </p>
      </section>
      <section className="release-scope-grid">
        <article>
          <span>01</span>
          <strong>{manifest.counts.catalogWorks.toLocaleString('zh-CN')}</strong>
          <h2>公开目录</h2>
          <p>排除 198 条不可公开解析的 Bangumi opaque 身份和 1 条反馈烟雾测试记录。</p>
          <Link className="result-link" href="/works">浏览目录</Link>
        </article>
        <article>
          <span>02</span>
          <strong>{manifest.counts.auditedWorks.toLocaleString('zh-CN')}</strong>
          <h2>去重审计集合</h2>
          <p>活动批次与 legacy 集合全局按 Work ID 去重后的真实评级边界。</p>
          <Link className="result-link" href="/works?status=rated">查看审计结果</Link>
        </article>
        <article>
          <span>03</span>
          <strong>{manifest.counts.ratedWorks.toLocaleString('zh-CN')}</strong>
          <h2>可发布评级</h2>
          <p>S–F 当前结论，包含保留低置信标记的证据不足型 D。</p>
          <Link className="result-link" href="/ratings">查看分布</Link>
        </article>
        <article>
          <span>04</span>
          <strong>{manifest.counts.nonratingTerminalWorks.toLocaleString('zh-CN')}</strong>
          <h2>非评级终态</h2>
          <p>仅资料、冲突、阻断和待专项研究，不为完整率强行生成等级。</p>
          <Link className="result-link" href="/radar">查看边界</Link>
        </article>
      </section>
    </main>
  )
}
