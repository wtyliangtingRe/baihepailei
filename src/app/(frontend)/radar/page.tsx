import Link from 'next/link'

import { getPublicWorkList } from '@/lib/publicRelease'

export const dynamic = 'force-dynamic'

export default function RadarIndexPage() {
  const cards = [
    {
      status: 'research_record_only',
      count: getPublicWorkList({ status: 'research_record_only', limit: 1 }).total,
      title: '已有资料，暂未评级',
      copy: '已有作品或研究资料，但当前证据还不足以形成可公开的 S–F 结论。',
    },
    {
      status: 'conflict',
      count: getPublicWorkList({ status: 'conflict', limit: 1 }).total,
      title: '结论待核对',
      copy: '不同材料指向不同等级，本站暂不替用户制造一个确定答案。',
    },
    {
      status: 'blocked',
      count: getPublicWorkList({ status: 'blocked', limit: 1 }).total,
      title: '资料暂不可用',
      copy: '关键资料存在缺失或对应问题，需要先完成核对。',
    },
    {
      status: 'research_required',
      count: getPublicWorkList({ status: 'research_required', limit: 1 }).total,
      title: '需要专项研究',
      copy: '需要针对关系、结局或设定继续查证，现阶段不宜评级。',
    },
  ] as const
  const terminalTotal = cards.reduce((sum, card) => sum + card.count, 0)
  const notAssessed = getPublicWorkList({ status: 'not_assessed', limit: 1 }).total

  return (
    <main className="page collection-page radar-index-page release-status-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">评级进度</p>
        <h1>{terminalTotal.toLocaleString('zh-CN')} 部作品暂不评级。</h1>
        <p>
          它们已经有一定资料，但还不能给出可靠结论。页面保留真实进度，
          不为了让每部作品都有字母等级而猜测剧情或雷点。
        </p>
        <div className="collection-actions">
          <Link className="result-link" href="/works?status=research_record_only">浏览待补资料作品</Link>
          <Link className="back-link" href="/ratings">评级怎么读</Link>
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
          <p className="eyebrow">尚未进入评级</p>
          <h2>另有 {notAssessed.toLocaleString('zh-CN')} 部作品。</h2>
        </div>
        <p>
          这些作品目前只有可检索标题与类型，没有继承旧评级。你仍可以用作品名或别名找到页面并补充线索。
        </p>
        <Link className="result-link" href="/works?status=not_assessed">浏览尚未评级作品</Link>
      </section>
    </main>
  )
}
