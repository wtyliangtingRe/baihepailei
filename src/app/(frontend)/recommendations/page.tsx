import Link from 'next/link'

export default function RecommendationsPage() {
  return <main className="page"><section className="empty-state small"><h1>当前推荐尚未生成</h1><p>旧评级没有迁入，系统不会用历史结论生成推荐。新的 Assessment 产生后再建立推荐投影。</p><Link className="back-link" href="/works">浏览正式作品</Link></section></main>
}
