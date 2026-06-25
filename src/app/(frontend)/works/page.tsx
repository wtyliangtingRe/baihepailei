import Link from 'next/link'

import MissingSearchIndex from '../_components/MissingSearchIndex'
import { readSearchIndex } from '../_lib/search-index'

const rankOrder = ['AA', 'A', 'B', 'C', 'D', 'E', 'unknown']

function rankLabel(rank?: string) {
  if (!rank || rank === 'unknown') return '未分级'
  if (rank === 'AA') return 'S级'
  return `${rank}级`
}

function rankAnchor(rank?: string) {
  if (!rank || rank === 'unknown') return 'rank-unknown'
  if (rank === 'AA') return 'rank-s'
  return `rank-${rank.toLowerCase()}`
}

function rankSortValue(rank?: string) {
  const normalizedRank = rank || 'unknown'
  const index = rankOrder.indexOf(normalizedRank)
  return index === -1 ? rankOrder.length : index
}

export default function WorksIndexPage() {
  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const items = index.items
    .filter((item) => item.collection === 'works')
    .sort((a, b) => rankSortValue(a.rank) - rankSortValue(b.rank) || a.title.localeCompare(b.title, 'zh-CN'))

  const groups = rankOrder
    .map((rank) => ({
      rank,
      items: items.filter((item) => (item.rank || 'unknown') === rank),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">works</p>
        <h1>作品</h1>
        <p>按排雷分级浏览 Lite 搜索索引中的作品条目。</p>
        <div className="collection-actions">
          <Link className="back-link" href="/search">搜索</Link>
          <Link className="back-link" href="/browse">浏览全部</Link>
          <span>{items.length} 条</span>
        </div>
        <nav className="rank-jump-list" aria-label="作品分级快速跳转">
          {groups.map((group) => (
            <a href={`#${rankAnchor(group.rank)}`} key={group.rank}>
              {rankLabel(group.rank)} <span>{group.items.length}</span>
            </a>
          ))}
        </nav>
      </section>

      <section className="ranked-collection-list">
        {groups.map((group) => (
          <section className="rank-group" id={rankAnchor(group.rank)} key={group.rank}>
            <div className="rank-group-heading">
              <h2>{rankLabel(group.rank)}</h2>
              <span>{group.items.length} 条</span>
            </div>

            <div className="collection-grid">
              {group.items.map((item) => (
                <Link className="collection-card" href={item.url} key={item.id}>
                  <p>{rankLabel(item.rank)}</p>
                  <h2>{item.title}</h2>
                  {item.originalTitle ? <span>{item.originalTitle}</span> : null}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </section>
    </main>
  )
}
