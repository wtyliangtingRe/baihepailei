import Link from 'next/link'

import MissingSearchIndex from './MissingSearchIndex'
import type { SearchCollection, SearchItem } from '../_lib/search-index'
import { readSearchIndex } from '../_lib/search-index'

type CollectionIndexConfig = {
  collection: SearchCollection
  eyebrow: string
  title: string
  description: string
}

function compactValues(values: string[] | undefined, limit = 3) {
  if (!Array.isArray(values)) return ''
  return values.filter(Boolean).slice(0, limit).join(' / ')
}

function primaryMeta(item: SearchItem) {
  if (item.collection === 'works') {
    return item.rank && item.rank !== 'unknown' ? `${item.rank}级` : item.slug
  }

  if (item.collection === 'creators') {
    return item.rank && item.rank !== 'unknown' ? `${item.rank}级` : item.slug
  }

  if (item.collection === 'terms') {
    const relatedTerms = compactValues(item.relatedTerms)
    return relatedTerms ? `相关：${relatedTerms}` : item.slug
  }

  if (item.collection === 'rules') {
    return item.category || item.slug
  }

  return item.slug
}

function secondaryMeta(item: SearchItem) {
  if (item.collection === 'works') return item.originalTitle || compactValues(item.creators)
  if (item.collection === 'creators') return compactValues(item.aliases)
  if (item.collection === 'terms') return compactValues(item.relatedWarnings)
  if (item.collection === 'rules') return compactValues(item.relatedWarnings || item.relatedTags)
  return ''
}

export default function CollectionIndexPage({ collection, eyebrow, title, description }: CollectionIndexConfig) {
  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const items = index.items
    .filter((item) => item.collection === collection)
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))

  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="collection-actions">
          <Link className="back-link" href="/search">
            搜索
          </Link>
          <Link className="back-link" href="/browse">
            浏览全部
          </Link>
          <span>{items.length} 条</span>
        </div>
      </section>

      <section className="collection-grid">
        {items.map((item) => {
          const secondary = secondaryMeta(item)

          return (
            <Link className="collection-card" href={item.url} key={item.id}>
              <p>{primaryMeta(item)}</p>
              <h2>{item.title}</h2>
              {secondary ? <span>{secondary}</span> : null}
            </Link>
          )
        })}
      </section>
    </main>
  )
}
