import Link from 'next/link'

export default function RadarIndexPage() {
  return (
    <main className="page collection-page radar-index-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">新研究流程</p>
        <h1>当前研究档案</h1>
        <p>当前正式研究档案为 0 条。历史事实和证据只保留在生产库外的参考包中，不能被运行时读取，也不能原地升级。</p>
        <div className="collection-actions">
          <span>0 条当前研究</span>
          <Link className="back-link" href="/works">浏览正式作品</Link>
        </div>
      </section>
      <section className="empty-state small">
        <h2>等待新的发现—研究—评估</h2>
        <p>新流程产生的对象将使用新数据库和新 Provenance；旧 Radar 记录不会作为兼容层继续提供。</p>
      </section>
    </main>
  )
}
