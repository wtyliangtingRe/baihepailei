import Link from 'next/link'

export default function RatingsPage() {
  return (
    <main className="page collection-page ratings-public-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">新评估流程</p>
        <h1>当前评级</h1>
        <p>当前正式评级为 0 条。10,563 条旧评级、旧指标和旧复核标记均未导入；新评级必须由新的 Research 与 Assessment 产生。</p>
        <div className="collection-actions">
          <span>0 条当前评级</span>
          <Link className="back-link" href="/works">浏览正式作品</Link>
          <Link className="back-link" href="/rules">查看现行规则</Link>
        </div>
      </section>
      <section className="empty-state small">
        <h2>尚无新流程评级</h2>
        <p>这里不会显示或回退到历史 Radar/Payload 评级。</p>
      </section>
    </main>
  )
}
