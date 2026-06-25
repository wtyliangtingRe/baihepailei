'use client'

import { useEffect, useMemo, useState } from 'react'

type SearchItem = {
  id: string
  collection: 'works' | 'creators' | 'terms' | 'rules' | string
  typeLabel: string
  title: string
  slug: string
  url: string
  rank?: string
  originalTitle?: string
  aliases?: string[]
  creators?: string[]
  tags?: string[]
  warnings?: string[]
  relatedTerms?: string[]
  relatedWarnings?: string[]
  category?: string
  legacyXWikiPage?: string
  searchText: string
}

type SearchIndex = {
  schemaVersion: number
  generatedAt: string
  mode: string
  counts: Record<string, number>
  total: number
  items: SearchItem[]
}

type SearchResult = SearchItem & {
  score: number
}

const collectionLabels: Record<string, string> = {
  works: '作品',
  creators: '创作者',
  terms: '名词解释',
  rules: '规则',
}

function normalizeText(value: string) {
  return value.trim().toLowerCase()
}

function splitQuery(query: string) {
  return normalizeText(query)
    .split(/\s+/g)
    .map((part) => part.trim())
    .filter(Boolean)
}

function scoreItem(item: SearchItem, query: string) {
  const terms = splitQuery(query)
  if (terms.length === 0) return 0

  const title = normalizeText(item.title || '')
  const originalTitle = normalizeText(item.originalTitle || '')
  const aliases = (item.aliases || []).map(normalizeText)
  const creators = (item.creators || []).map(normalizeText)
  const searchText = normalizeText(item.searchText || '')
  const slug = normalizeText(item.slug || '')
  const legacy = normalizeText(item.legacyXWikiPage || '')

  let score = 0

  for (const term of terms) {
    if (title === term) score += 120
    if (title.includes(term)) score += 60
    if (originalTitle === term) score += 90
    if (originalTitle.includes(term)) score += 45
    if (aliases.some((alias) => alias === term)) score += 80
    if (aliases.some((alias) => alias.includes(term))) score += 40
    if (creators.some((creator) => creator.includes(term))) score += 35
    if (slug.includes(term)) score += 18
    if (legacy.includes(term)) score += 12
    if (searchText.includes(term)) score += 10
  }

  const compactQuery = terms.join('')
  const compactTitle = title.replaceAll(' ', '')
  if (compactQuery && compactTitle.includes(compactQuery)) score += 30

  return score
}

function highlightText(text: string, query: string) {
  const terms = splitQuery(query)
  if (!text || terms.length === 0) return text

  let output = text
  for (const term of terms) {
    const index = output.toLowerCase().indexOf(term)
    if (index < 0) continue
    const before = output.slice(0, index)
    const match = output.slice(index, index + term.length)
    const after = output.slice(index + term.length)
    output = `${before}<mark>${match}</mark>${after}`
    break
  }
  return output
}

function resultMeta(item: SearchItem) {
  const parts = [collectionLabels[item.collection] || item.typeLabel || item.collection]
  if (item.rank && item.rank !== 'unknown') parts.push(`${item.rank}级`)
  if (item.category) parts.push(item.category)
  return parts.filter(Boolean).join(' · ')
}

function resultSummary(item: SearchItem) {
  const parts = [
    item.originalTitle,
    ...(item.aliases || []),
    ...(item.creators || []),
    ...(item.tags || []),
    ...(item.warnings || []),
    item.legacyXWikiPage,
  ].filter(Boolean)

  return parts.slice(0, 8).join(' / ')
}

export default function SearchClient() {
  const [index, setIndex] = useState<SearchIndex | null>(null)
  const [query, setQuery] = useState('')
  const [activeCollection, setActiveCollection] = useState('all')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function loadIndex() {
      try {
        const response = await fetch('/search-index.json', { cache: 'no-store' })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const data = (await response.json()) as SearchIndex
        if (isMounted) setIndex(data)
      } catch (loadError) {
        if (isMounted) {
          setError(String(loadError instanceof Error ? loadError.message : loadError))
        }
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    loadIndex()

    return () => {
      isMounted = false
    }
  }, [])

  const results = useMemo<SearchResult[]>(() => {
    const items = index?.items || []
    const visibleItems = activeCollection === 'all'
      ? items
      : items.filter((item) => item.collection === activeCollection)

    if (!query.trim()) {
      return visibleItems.slice(0, 30).map((item) => ({ ...item, score: 0 }))
    }

    return visibleItems
      .map((item) => ({ ...item, score: scoreItem(item, query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-CN'))
      .slice(0, 50)
  }, [activeCollection, index?.items, query])

  const collectionCounts = index?.counts || {}

  if (isLoading) {
    return <div className="search-panel">正在加载搜索索引…</div>
  }

  if (error || !index) {
    return (
      <section className="search-panel empty-state">
        <h2>还没有可用的搜索索引</h2>
        <p>请先在本地生成 public/search-index.json。</p>
        <pre>pnpm export:lite-search -- --url "http://localhost:3000" --include-drafts</pre>
      </section>
    )
  }

  return (
    <section className="search-panel">
      <div className="search-meta">
        <span>索引：{index.total} 条</span>
        <span>生成：{new Date(index.generatedAt).toLocaleString('zh-CN')}</span>
        <span>{index.mode}</span>
      </div>

      <label className="search-box">
        <span>关键词</span>
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="例如：樱trick、タチ、MtF、B级、奈叶"
        />
      </label>

      <div className="search-filters" aria-label="搜索范围">
        <button className={activeCollection === 'all' ? 'active' : ''} onClick={() => setActiveCollection('all')} type="button">
          全部 {index.total}
        </button>
        {Object.entries(collectionCounts).map(([collection, count]) => (
          <button
            className={activeCollection === collection ? 'active' : ''}
            key={collection}
            onClick={() => setActiveCollection(collection)}
            type="button"
          >
            {collectionLabels[collection] || collection} {count}
          </button>
        ))}
      </div>

      <div className="result-summary">
        {query.trim() ? `找到 ${results.length} 条结果` : `显示前 ${results.length} 条条目`}
      </div>

      <div className="results-list">
        {results.length === 0 ? (
          <div className="empty-state small">
            <h2>没有搜到</h2>
            <p>可以试试作品简称、日文名、作者名、分级或旧站关键词。</p>
          </div>
        ) : (
          results.map((item) => (
            <article className="result-card" key={item.id}>
              <div className="result-card-header">
                <p>{resultMeta(item)}</p>
                {item.score > 0 ? <span>score {item.score}</span> : null}
              </div>
              <h2 dangerouslySetInnerHTML={{ __html: highlightText(item.title, query) }} />
              {resultSummary(item) ? <p className="result-text">{resultSummary(item)}</p> : null}
              <a className="result-link" href={item.url}>
                {item.url}
              </a>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
