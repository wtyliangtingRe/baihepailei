'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  filterAndRankItems,
  getCollectionLabel,
  resultMeta,
  resultSummary,
  splitQuery,
} from './search-utils.mjs'

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

const searchSuggestions = ['作品中文名或日文名', '作者 / 社团 / 制作组', 'S级、B级、D级等分级', '旧站关键词或别名']

function indexModeLabel(mode: string) {
  if (mode === 'include-drafts') return '含草稿'
  if (mode === 'published') return '仅已发布'
  return mode || '未知模式'
}

function HighlightedText({ query, text }: { query: string; text: string }) {
  const terms = splitQuery(query)
  if (!text || terms.length === 0) return <>{text}</>

  const lowerText = text.toLowerCase()
  const term = terms.find((item: string) => lowerText.includes(item))
  if (!term) return <>{text}</>

  const index = lowerText.indexOf(term)
  const before = text.slice(0, index)
  const match = text.slice(index, index + term.length)
  const after = text.slice(index + term.length)

  return (
    <>
      {before}
      <mark>{match}</mark>
      {after}
    </>
  )
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
    return filterAndRankItems(items, { activeCollection, query }) as SearchResult[]
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
        <span>模式：{indexModeLabel(index.mode)}</span>
      </div>

      <label className="search-box">
        <span>关键词</span>
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="例如：樱trick、タチ、分级、作者名"
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
            {getCollectionLabel(collection)} {count}
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
            <p>可以换一个角度搜索，尤其是旧站内容可能存在简称、日文名或不同译名。</p>
            <ul className="search-suggestions">
              {searchSuggestions.map((suggestion) => (
                <li key={suggestion}>{suggestion}</li>
              ))}
            </ul>
          </div>
        ) : (
          results.map((item) => (
            <article className="result-card" key={item.id}>
              <div className="result-card-header">
                <p>{resultMeta(item)}</p>
              </div>
              <h2>
                <HighlightedText query={query} text={item.title} />
              </h2>
              {resultSummary(item) ? <p className="result-text">{resultSummary(item)}</p> : null}
              <a className="result-link" href={item.url}>
                查看详情
              </a>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
