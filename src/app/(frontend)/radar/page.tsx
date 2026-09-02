import Link from 'next/link'

import { getPublicReleaseManifest } from '@/lib/publicRelease'

export const dynamic = 'force-dynamic'

export default function RadarIndexPage() {
  const manifest = getPublicReleaseManifest()
  const terminal = manifest.nonratingTerminalBreakdown

  const cards = [
    {
      status: 'research_record_only',
      count: terminal.research_record_only,
      title: '仅资料记录',
      copy: '跨全部引用没有找到 Assessment 决策。现有资料可查，但不能冒充评级。',
    },
    {
      status: 'conflict',
      count: terminal.conflict,
      title: '评级权威冲突',
      copy: '作者等级、终态或多个精确等级互相冲突；保留冲突，等待后续裁决。',
    },
    {
      status: 'blocked',
      count: terminal.blocked,
      title: '身份 / 数据阻断',
      copy: '精确身份或数据包边界仍未闭合；先公开阻断，不越权评级。',
    },
    {
      status: 'research_required',
      count: terminal.research_required,
      title: '待专项研究',
      copy: '只有针对性补证才能形成权威结论；本版明确停在研究需求。',
    },
  ] as const

  return (
    <main className="page collection-page radar-index-page release-status-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">非评级终态</p>
        <h1>117 条，保持不确定。</h1>
        <p>
          本轮审计已覆盖 {manifest.counts.auditedWorks.toLocaleString('zh-CN')} 个去重 Work ID。
          其中 {manifest.counts.ratedWorks.toLocaleString('zh-CN')} 个可以评级；剩余 117 个各自停在有证据支持的终态，
          不等待下一批数据，也不为了“100% 有等级”而制造结论。
        </p>
        <div className="collection-actions">
          <Link className="result-link" href="/works?status=research_record_only">浏览非评级记录</Link>
          <Link className="back-link" href="/ratings">查看评级分布</Link>
        </div>
      </section>

      <section className="release-status-grid">
        {cards.map((card) => (
          <article className={`release-status-card status-card-${card.status}`} key={card.status}>
            <div>
              <span className={`status-symbol status-${card.status}`}>—</span>
              <strong>{card.count}</strong>
            </div>
            <h2>{card.title}</h2>
            <p>{card.copy}</p>
            <Link href={`/works?status=${card.status}`}>查看这 {card.count} 条 →</Link>
          </article>
        ))}
      </section>

      <section className="release-method-note">
        <div>
          <p className="eyebrow">目录和审计不是一回事</p>
          <h2>另外 {manifest.counts.notAssessedWorks.toLocaleString('zh-CN')} 条只是可检索目录。</h2>
        </div>
        <p>
          公开目录共有 {manifest.counts.catalogWorks.toLocaleString('zh-CN')} 条身份记录。
          未进入本轮 4,115 条审计集合的作品统一标为“尚未评估”，不会继承旧标签，也不会混进评级统计。
          这让网站现在可以完整检索，又不扩大结论边界。
        </p>
        <Link className="result-link" href="/works?status=not_assessed">浏览尚未评估目录</Link>
      </section>

      <section className="release-snapshot-note">
        <div>
          <p className="eyebrow">版本策略</p>
          <h2>本版不再等，后续只追加。</h2>
        </div>
        <p>
          新证据到来时会生成新的版本化结论；当前快照继续可追溯。
          Work ID、冻结研究与历史评级源文件不会被回写覆盖。
        </p>
      </section>
    </main>
  )
}
