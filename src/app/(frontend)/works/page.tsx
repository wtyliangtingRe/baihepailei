import Link from 'next/link'

import MissingSearchIndex from '../_components/MissingSearchIndex'
import { readSearchIndex, type SearchCoverImage } from '../_lib/search-index'

const rankOrder = ['AA', 'A', 'B', 'C', 'D', 'E', 'unknown']

const rankDescriptions: Record<string, string> = {
  AA: '最高优先级关注项，旧站 AA 级在前台统一显示为 S 级。',
  A: '需要优先阅读说明与正文，再决定是否继续深入。',
  B: '存在明确注意点，适合结合标签、说明和上下文判断。',
  C: '一般注意级别，通常适合作为补充参考。',
  D: '较低注意级别，多用于轻量标记或待复核条目。',
  E: '最低注意级别，通常只保留基础记录。',
  unknown: '暂时没有明确分级，等待后续整理或复核。',
}

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

function CoverThumb({ cover, title }: { cover?: SearchCoverImage; title: string }) {
  if (cover?.url) {
    return (
      <div className="work-cover-thumb">
        <img alt={cover.alt || `${title}封面`} src={cover.url} />
      </div>
    )
  }

  return (
    <div className="work-cover-thumb work-cover-placeholder" aria-label="暂无封面">
      <span>暂无封面</span>
    </div>
  )
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
        <p className="eyebrow">作品</p>
        <h1>作品</h1>
        <p>按排雷分级浏览轻量搜索索引中的作品条目。</p>
        <div className="collection-actions">
          <Link className="back-link" href="/search?collection=works">搜索作品</Link>
          <Link className="back-link" href="/browse">浏览全部</Link>
          <span>{items.length} 条</span>
        </div>
        <nav className="rank-jump-list" id="works-rank-nav" aria-label="作品分级快速跳转">
          {groups.map((group) => (
            <a href={`#${rankAnchor(group.rank)}`} key={group.rank}>
              {rankLabel(group.rank)} <span>{group.items.length}</span>
            </a>
          ))}
        </nav>
      </section>

      <section className="rank-explainer" aria-label="排雷分级说明">
        <div>
          <p className="eyebrow">分级说明</p>
          <h2>如何理解这些分级？</h2>
          <p>分级用于帮助快速定位阅读优先级，不等于最终结论。具体判断仍以条目正文、标签和来源说明为准。</p>
        </div>
        <div className="rank-explainer-grid">
          {rankOrder.map((rank) => (
            <article className="rank-explainer-card" key={rank}>
              <h3>{rankLabel(rank)}</h3>
              <p>{rankDescriptions[rank]}</p>
            </article>
          ))}
        </div>
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
                <Link className="collection-card work-card" href={item.url} key={item.id}>
                  <CoverThumb cover={item.cover} title={item.title} />
                  <div className="work-card-body">
                    <p>{rankLabel(item.rank)}</p>
                    <h2>{item.title}</h2>
                    {item.originalTitle ? <span>{item.originalTitle}</span> : null}
                  </div>
                </Link>
              ))}
            </div>

            <div className="rank-group-actions">
              <a href="#works-rank-nav">返回分级导航</a>
            </div>
          </section>
        ))}
      </section>
    </main>
  )
}
