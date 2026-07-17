'use client'

import { useDeferredValue, useEffect, useMemo, useState } from 'react'

import AssessmentOriginBadge from '../_components/AssessmentOriginBadge'
import { isPublicSearchItem } from '../_lib/public-entity-guards'
import { filterAndRankItems, getCollectionLabel, resultMeta, resultSummary, splitQuery, workTypeLabel } from './search-utils.mjs'

type ContentScope = 'ordinary' | 'all'
type ContentVisibility = 'ordinary' | 'adult' | 'restricted'

type SearchItem = {
  id: string
  collection: 'works' | 'creators' | 'organizations' | 'evidence' | 'terms' | 'rules' | string
  typeLabel: string
  title: string
  slug: string
  url: string
  rank?: string
  reviewStatus?: string
  ratingNotice?: string
  radarAssessment?: {
    assessedAt?: string
    suggestedGrade?: string
  }
  originalTitle?: string
  aliases?: string[]
  localizedTitles?: string[]
  localizedNames?: string[]
  mediaGroup?: string
  mediaType?: string
  format?: string
  firstPublishedLabel?: string
  creators?: string[]
  organizations?: string[]
  relatedWorks?: string[]
  relatedCreators?: string[]
  relatedOrganizations?: string[]
  tags?: string[]
  warnings?: string[]
  relatedTerms?: string[]
  relatedWarnings?: string[]
  category?: string
  organizationType?: string
  evidenceType?: string
  contentVisibility?: ContentVisibility
  contentAdvisories?: string[]
  searchText: string
}

type SearchIndex = {
  schemaVersion: number
  generatedAt: string
  mode: string
  counts: Record<string, number>
  visibilityCounts?: Record<string, number>
  total: number
  items: SearchItem[]
}

type SearchResult = SearchItem & { score: number }

const searchSuggestions = ['作品中文名、日文名或别名', '作者 / 社团 / 制作组 / 机构', '媒介类型，例如“动画”“手机游戏”', '分级、标签或注意点']
const validCollections = new Set(['all', 'works', 'creators', 'organizations'])
const validMedia = new Set(['all', 'anime', 'manga', 'novel', 'game', 'other', 'unknown'])
const validRanks = new Set(['all', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'unknown'])
const publicSearchCollections = new Set(['works', 'creators', 'organizations'])
const mediaOptions = [
  { value: 'all', label: '全部作品类型' }, { value: 'anime', label: '动画' }, { value: 'manga', label: '漫画' },
  { value: 'novel', label: '小说' }, { value: 'game', label: '游戏' }, { value: 'other', label: '其他' }, { value: 'unknown', label: '未知' },
]

function indexModeLabel(mode: string) {
  if (mode === 'include-drafts' || mode === 'drafts-and-published') return '含草稿'
  if (mode === 'published' || mode === 'published-only') return '仅已发布'
  return mode || '未知模式'
}

function readContentScope(): ContentScope {
  if (typeof document === 'undefined') return 'ordinary'
  return document.documentElement.dataset.contentScope === 'all' ? 'all' : 'ordinary'
}

function itemAllowedByScope(item: SearchItem, scope: ContentScope) {
  if (!publicSearchCollections.has(item.collection) || !isPublicSearchItem(item)) return false
  if (item.collection !== 'works' || scope === 'all') return true
  return !item.contentVisibility || item.contentVisibility === 'ordinary'
}

function visibleItemsForScope(items: SearchItem[], scope: ContentScope) {
  return items.filter((item) => itemAllowedByScope(item, scope))
}

function countVisibleByCollection(items: SearchItem[]) {
  const counts: Record<string, number> = {}
  for (const item of items) counts[item.collection] = (counts[item.collection] || 0) + 1
  return counts
}

function contentVisibilityLabel(value?: ContentVisibility) {
  if (value === 'adult') return '标记内容'
  if (value === 'restricted') return '限制展示'
  return ''
}

function normalizedRank(value?: string) {
  if (value === 'S') return 'AA'
  return value || 'unknown'
}

function HighlightedText({ query, text }: { query: string; text: string }) {
  const terms = splitQuery(query)
  if (!text || terms.length === 0) return <>{text}</>
  const normalizedText = text.normalize('NFKC').toLowerCase()
  const term = terms.find((item: string) => normalizedText.includes(item))
  if (!term) return <>{text}</>
  const index = normalizedText.indexOf(term)
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + term.length)}</mark>{text.slice(index + term.length)}</>
}

function SearchEmptyArtwork() {
  return <div aria-hidden="true" className="search-empty-symbol">⌕</div>
}

export default function SearchClient() {
  const [index, setIndex] = useState<SearchIndex | null>(null)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [activeCollection, setActiveCollection] = useState('all')
  const [activeMedia, setActiveMedia] = useState('all')
  const [activeRank, setActiveRank] = useState('all')
  const [contentScope, setContentScope] = useState<ContentScope>('ordinary')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialCollection = params.get('collection') || 'all'
    const initialMedia = params.get('media') || 'all'
    const initialRank = params.get('rank') || 'all'
    setQuery(params.get('q')?.trim() || '')
    if (validCollections.has(initialCollection)) setActiveCollection(initialCollection)
    if (validMedia.has(initialMedia)) setActiveMedia(initialMedia)
    if (validRanks.has(initialRank)) setActiveRank(initialRank)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (activeCollection !== 'all') params.set('collection', activeCollection)
    if (activeMedia !== 'all') params.set('media', activeMedia)
    if (activeRank !== 'all') params.set('rank', activeRank)
    const next = params.toString() ? `/search?${params.toString()}` : '/search'
    window.history.replaceState(null, '', next)
  }, [activeCollection, activeMedia, activeRank, query])

  useEffect(() => {
    setContentScope(readContentScope())
    const handleScopeChange = () => setContentScope(readContentScope())
    window.addEventListener('baihepailei:content-scope-change', handleScopeChange)
    return () => window.removeEventListener('baihepailei:content-scope-change', handleScopeChange)
  }, [])

  useEffect(() => {
    let isMounted = true
    fetch('/search-index.json', { cache: 'force-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((data: SearchIndex) => { if (isMounted) setIndex(data) })
      .catch((loadError) => { if (isMounted) setError(String(loadError instanceof Error ? loadError.message : loadError)) })
      .finally(() => { if (isMounted) setIsLoading(false) })
    return () => { isMounted = false }
  }, [])

  const visibleItems = useMemo(() => visibleItemsForScope(index?.items || [], contentScope), [contentScope, index?.items])
  const refinedItems = useMemo(() => visibleItems.filter((item) => {
    if (item.collection !== 'works') return activeMedia === 'all' && activeRank === 'all'
    if (activeMedia !== 'all' && (item.mediaGroup || 'unknown') !== activeMedia) return false
    if (activeRank !== 'all' && normalizedRank(item.rank) !== activeRank) return false
    return true
  }), [activeMedia, activeRank, visibleItems])
  const results = useMemo<SearchResult[]>(() => filterAndRankItems(refinedItems, { activeCollection, query: deferredQuery }) as SearchResult[], [activeCollection, deferredQuery, refinedItems])
  const collectionCounts = useMemo(() => countVisibleByCollection(visibleItems), [visibleItems])
  const hiddenMarkedWorks = Math.max(0, Number(index?.visibilityCounts?.adult || 0) + Number(index?.visibilityCounts?.restricted || 0))

  if (isLoading) return <div className="search-panel">正在加载搜索索引…</div>
  if (error || !index) return <section className="search-panel empty-state"><SearchEmptyArtwork /><h2>还没有可用的搜索索引</h2><p>请先生成 public/search-index.json。</p><pre>pnpm export:lite-search -- --url "http://localhost:3000" --include-drafts</pre></section>

  return (
    <section className="search-panel">
      <div className="search-meta"><span>索引：{visibleItems.length} / {index.total} 条</span><span>生成：{new Date(index.generatedAt).toLocaleString('zh-CN')}</span><span>模式：{indexModeLabel(index.mode)}</span>{contentScope === 'ordinary' && hiddenMarkedWorks ? <span>普通模式隐藏 {hiddenMarkedWorks} 条标记作品</span> : null}</div>

      <label className="search-box"><span>关键词</span><input autoFocus onChange={(event) => setQuery(event.target.value)} placeholder="作品名、别名、作者、机构、类型、标签或注意点" type="search" value={query} /></label>

      <div className="search-filters" aria-label="搜索范围">
        <button className={activeCollection === 'all' ? 'active' : ''} onClick={() => setActiveCollection('all')} type="button">全部 {visibleItems.length}</button>
        {['works', 'creators', 'organizations'].map((collection) => <button className={activeCollection === collection ? 'active' : ''} key={collection} onClick={() => setActiveCollection(collection)} type="button">{getCollectionLabel(collection)} {collectionCounts[collection] || 0}</button>)}
      </div>

      <div className="search-refine-grid">
        <label><span>作品类型</span><select onChange={(event) => setActiveMedia(event.target.value)} value={activeMedia}>{mediaOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label><span>排雷分级</span><select onChange={(event) => setActiveRank(event.target.value)} value={activeRank}><option value="all">全部分级</option><option value="AA">S级</option>{['A','B','C','D','E','F','X'].map((rank) => <option key={rank} value={rank}>{rank}级</option>)}<option value="unknown">未分级</option></select></label>
      </div>

      <div className="result-summary">{deferredQuery.trim() ? `找到 ${results.length} 条高相关结果` : `显示前 ${results.length} 条条目`}</div>
      <div className="results-list">
        {results.length === 0 ? (
          <div className="empty-state small"><SearchEmptyArtwork /><h2>没有搜到</h2><p>可以换一个译名，或放宽作品类型与分级筛选。</p><ul className="search-suggestions">{searchSuggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul></div>
        ) : results.map((item) => {
          const visibilityLabel = contentVisibilityLabel(item.contentVisibility)
          const specificType = item.collection === 'works' ? workTypeLabel(item) : ''
          return (
            <article className="result-card" data-content-visibility={item.contentVisibility || 'ordinary'} key={item.id}>
              <div className="result-card-header"><div className="result-type-badges"><span>{resultMeta(item)}</span>{specificType ? <span>{specificType}</span> : null}<AssessmentOriginBadge item={item} /></div>{visibilityLabel ? <span className="content-visibility-chip">{visibilityLabel}</span> : null}</div>
              <h2><HighlightedText query={deferredQuery} text={item.title} /></h2>
              {resultSummary(item) ? <p className="result-text">{resultSummary(item)}</p> : null}
              <a className="result-link" href={item.url}>查看详情</a>
            </article>
          )
        })}
      </div>
    </section>
  )
}
