import Link from 'next/link'

import MissingSearchIndex from '../_components/MissingSearchIndex'
import { readSearchIndex } from '../_lib/search-index'

export default function WorksIndexPage() {
  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const items = index.items
    .filter((item) => item.collection === 'works')
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))

  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">works</p>
        <h1>作品</h1>
        <p>浏览 Lite 搜索索引中的作品条目。</p>
        <div className="collection-actions">
          <Link className="back-link" href="/search">搜索</Link>
          <span>{items.length} 条</span>
        </div>
      </section>

      <section className="collection-grid">
        {items.map((item) => (
          <Link className="collection-card" href={item.url} key={item.id}>
            <p>{item.rank && item.rank !== 'unknown' ? `${item.rank}级` : item.slug}</p>
            <h2>{item.title}</h2>
            {item.originalTitle ? <span>{item.originalTitle}</span> : null}
          </Link>
        ))}
      </section>
    </main>
  )
}
