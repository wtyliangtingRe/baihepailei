import Link from 'next/link'

export default function CreatorsPage() {
  return <main className="page"><section className="empty-state small"><h1>创作者资料尚未正式导入</h1><p>迁移没有从旧字段或字段组合制造新的创作者实体。新流程建立正式关系后再开放此区。</p><Link className="back-link" href="/works">浏览正式作品</Link></section></main>
}
