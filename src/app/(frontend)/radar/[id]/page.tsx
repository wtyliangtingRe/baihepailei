import Link from 'next/link'

export default function RadarDetailPage() {
  return (
    <main className="page collection-page radar-detail-page">
      <section className="empty-state small">
        <h1>历史 Radar 档案已退出运行时</h1>
        <p>旧档案没有迁入正式数据库。新的 Research 对象产生后会拥有独立的新入口，不会复用历史记录 ID。</p>
        <Link className="back-link" href="/radar">返回当前研究状态</Link>
      </section>
    </main>
  )
}
