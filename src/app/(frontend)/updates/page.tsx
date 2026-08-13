import Link from 'next/link'

export default function UpdatesPage() {
  return <main className="page"><section className="empty-state small"><h1>新流程更新时间线尚为空</h1><p>历史详情索引没有迁入。后续更新时间线只记录新数据库中产生的对象。</p><Link className="back-link" href="/works">浏览正式作品</Link></section></main>
}
