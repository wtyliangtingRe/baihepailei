import Link from 'next/link'

import MissingSearchIndex from '../_components/MissingSearchIndex'
import { readSearchIndex, type SearchItem } from '../_lib/search-index'

const rankOrder = ['AA', 'A', 'B', 'C', 'D', 'E', 'unknown']
const defaultPageSize = 30
const pageSizeOptions = [30, 60]

const mediaGroupOptions = [
  { label: '动画', value: 'anime' },
  { label: '漫画', value: 'manga' },
  { label: '小说', value: 'novel' },
  { label: '游戏', value: 'game' },
  { label: '其他', value: 'other' },
  { label: '未知', value: 'unknown' },
]

const rankDescriptions: Record<string, string> = {
  AA: '最高优先级关注项。前台统一显示为 S 级，通常需要优先阅读正文和材料。',
  A: '整体风险较低或关系较明确，但仍建议先看条目说明再决定是否深入。',
  B: '存在明确注意点，需要结合标签、正文和上下文判断。',
  C: '中等注意级别，适合作为补充参考，不宜只看分级下结论。',
  D: '较低注意级别，多用于轻量标记、边缘情况或待复核条目。',
  E: '最低注意级别，通常只保留基础记录，后续可再整理。',
  unknown: '暂时没有明确分级，等待后续整理或复核。',
}

type WorksSearchParams = Promise<Record<string, string | string[] | undefined>>

type NormalizedFilters = {
  q: string
  rank: string
  media: string
}

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || ''
  return value || ''
}

function cleanLine(value: string | undefined) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ')
}

function normalizeText(value: string | undefined) {
  return cleanLine(value).toLowerCase()
}

function normalizePositiveInteger(value: string | undefined, fallback: number) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue < 1) return fallback
  return Math.floor(numberValue)
}

function normalizePageSize(value: string | undefined) {
  const requested = normalizePositiveInteger(value, defaultPageSize)
  return requested === 60 ? 60 : defaultPageSize
}

function normalizeRank(value: string) {
  const rank = String(value || '').trim()
  if (!rank || rank === 'all') return 'all'
  if (rank.toUpperCase() === 'S') return 'AA'
  if (rank.toLowerCase() === 'unknown') return 'unknown'
  return rank.toUpperCase()
}

function normalizeMediaGroup(value: string) {
  const media = String(value || '').trim()
  if (!media || media === 'all') return 'all'
  return mediaGroupOptions.some((option) => option.value === media) ? media : 'all'
}

function rankLabel(rank?: string) {
  if (!rank || rank === 'unknown') return 'E级'
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

function contentVisibilityLabel(value?: string) {
  if (value === 'adult') return '限制展示'
  if (value === 'restricted') return '限制展示'
  return ''
}

function isChineseTitle(value: string) {
  const text = cleanLine(value)
  if (!/[\p{Script=Han}]/u.test(text)) return false
  return !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)
}

function isJapaneseTitle(value: string) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(cleanLine(value))
}

function isEnglishTitle(value: string) {
  const text = cleanLine(value)
  return /[A-Za-z]/u.test(text) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)
}

function uniqueTitleValues(values: Array<string | undefined>) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const raw of values) {
    const value = cleanLine(raw)
    if (!value) continue
    const key = value.toLowerCase().replace(/[\s\u3000]+/gu, '').replace(/[\-‐‑‒–—―~〜～・:：;；,，.。!！?？'"“”‘’「」『』【】\[\]（）()]/gu, '')
    if (seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output
}

function displayTitle(item: SearchItem) {
  const candidates = uniqueTitleValues([...(item.localizedTitles || []), item.title, item.originalTitle, ...(item.aliases || [])])
  return candidates.find(isChineseTitle) || candidates.find(isJapaneseTitle) || candidates.find(isEnglishTitle) || candidates[0] || item.title
}

function itemMatchesQuery(item: SearchItem, query: string) {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return true

  const haystack = [
    item.title,
    item.originalTitle,
    ...(item.localizedTitles || []),
    ...(item.aliases || []),
    ...(item.creators || []),
    ...(item.organizations || []),
    ...(item.tags || []),
    ...(item.warnings || []),
    item.rank,
    item.mediaGroup,
    item.mediaType,
    item.format,
    item.firstPublishedLabel,
    item.searchText,
  ]
    .map((value) => normalizeText(value))
    .join('\n')

  return normalizedQuery
    .split(/\s+/g)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

function itemMatchesFilters(item: SearchItem, filters: NormalizedFilters) {
  const rank = item.rank || 'unknown'
  const mediaGroup = item.mediaGroup || 'unknown'
  if (filters.rank !== 'all' && rank !== filters.rank) return false
  if (filters.media !== 'all' && mediaGroup !== filters.media) return false
  return itemMatchesQuery(item, filters.q)
}

function filterLabel(filters: NormalizedFilters) {
  const labels = []
  if (filters.q) labels.push(`关键词：${filters.q}`)
  if (filters.rank !== 'all') labels.push(`分级：${rankLabel(filters.rank)}`)
  if (filters.media !== 'all') labels.push(`作品类型：${filters.media}`)
  return labels
}

function parseFilters(params: Record<string, string | string[] | undefined>): NormalizedFilters {
  return {
    q: firstParam(params.q).trim(),
    rank: normalizeRank(firstParam(params.rank)),
    media: normalizeMediaGroup(firstParam(params.media)),
  }
}

function pageHref(filters: NormalizedFilters, page: number, pageSize: number) {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.rank !== 'all') params.set('rank', filters.rank)
  if (filters.media !== 'all') params.set('media', filters.media)
  if (page > 1) params.set('page', String(page))
  if (pageSize !== defaultPageSize) params.set('perPage', String(pageSize))

  const query = params.toString()
  return query ? `/works?${query}` : '/works'
}

function paginationPages(currentPage: number, totalPages: number) {
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1])
  return [...pages]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b)
}

function HiddenFilterInputs({ filters, pageSize }: { filters: NormalizedFilters; pageSize: number }) {
  return (
    <>
      {filters.q ? <input name="q" type="hidden" value={filters.q} /> : null}
      {filters.rank !== 'all' ? <input name="rank" type="hidden" value={filters.rank} /> : null}
      {filters.media !== 'all' ? <input name="media" type="hidden" value={filters.media} /> : null}
      {pageSize !== defaultPageSize ? <input name="perPage" type="hidden" value={pageSize} /> : null}
    </>
  )
}

function WorksFilterForm({ filters }: { filters: NormalizedFilters }) {
  return (
    <form action="/works" className="works-filter-panel">
      <div className="works-filter-grid">
        <label>
          <span>关键词</span>
          <input defaultValue={filters.q} name="q" placeholder="作品名、译名、原名、作者、机构、标签" type="search" />
        </label>
        <label>
          <span>作品类型</span>
          <select defaultValue={filters.media} name="media">
            <option value="all">全部类型</option>
            {mediaGroupOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>分级</span>
          <select defaultValue={filters.rank} name="rank">
            <option value="all">全部分级</option>
            <option value="AA">S级</option>
            <option value="A">A级</option>
            <option value="B">B级</option>
            <option value="C">C级</option>
            <option value="D">D级</option>
            <option value="E">E级</option>
            <option value="unknown">E级 / 未录入</option>
          </select>
        </label>
      </div>
      <div className="works-filter-actions">
        <button className="result-link" type="submit">筛选作品</button>
        <Link className="back-link" href="/works">清除筛选</Link>
      </div>
    </form>
  )
}

function WorksPagination({ currentPage, filters, pageSize, totalItems, totalPages }: { currentPage: number; filters: NormalizedFilters; pageSize: number; totalItems: number; totalPages: number }) {
  if (totalItems === 0) return null

  const firstItem = (currentPage - 1) * pageSize + 1
  const lastItem = Math.min(totalItems, currentPage * pageSize)
  const pages = paginationPages(currentPage, totalPages)

  return (
    <nav className="collection-actions" aria-label="作品分页">
      <span>第 {currentPage} / {totalPages} 页</span>
      <span>显示 {firstItem}-{lastItem} / {totalItems} 条</span>
      {currentPage > 1 ? <Link className="back-link" href={pageHref(filters, currentPage - 1, pageSize)}>上一页</Link> : <span>上一页</span>}
      {pages.map((page) => (
        page === currentPage
          ? <span key={page}>{page}</span>
          : <Link className="back-link" href={pageHref(filters, page, pageSize)} key={page}>{page}</Link>
      ))}
      {currentPage < totalPages ? <Link className="back-link" href={pageHref(filters, currentPage + 1, pageSize)}>下一页</Link> : <span>下一页</span>}
      <span>每页</span>
      {pageSizeOptions.map((option) => (
        option === pageSize
          ? <span key={option}>{option}</span>
          : <Link className="back-link" href={pageHref(filters, 1, option)} key={option}>{option}</Link>
      ))}
      <form action="/works" className="page-jump-form">
        <HiddenFilterInputs filters={filters} pageSize={pageSize} />
        <label>
          跳到
          <input aria-label="跳到页码" defaultValue={currentPage} min="1" max={totalPages} name="page" type="number" />
        </label>
        <button className="back-link" type="submit">跳转</button>
      </form>
    </nav>
  )
}

export default async function WorksIndexPage({ searchParams }: { searchParams?: WorksSearchParams }) {
  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const params = searchParams ? await searchParams : {}
  const filters = parseFilters(params)
  const pageSize = normalizePageSize(firstParam(params.perPage))
  const requestedPage = normalizePositiveInteger(firstParam(params.page), 1)

  const allItems = index.items
    .filter((item) => item.collection === 'works')
    .sort((a, b) => rankSortValue(a.rank) - rankSortValue(b.rank) || displayTitle(a).localeCompare(displayTitle(b), 'zh-CN'))

  const markedItems = allItems.filter((item) => item.contentVisibility && item.contentVisibility !== 'ordinary')
  const items = allItems.filter((item) => itemMatchesFilters(item, filters))
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(requestedPage, totalPages)
  const pageStart = (currentPage - 1) * pageSize
  const pageItems = items.slice(pageStart, pageStart + pageSize)
  const activeFilterLabels = filterLabel(filters)

  const groups = rankOrder
    .map((rank) => ({
      rank,
      items: pageItems.filter((item) => (item.rank || 'unknown') === rank),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">作品</p>
        <h1>作品</h1>
        <p>浏览轻量搜索索引中的作品条目，并按作品类型和排雷分级筛选。</p>
        <div className="collection-actions">
          <Link className="back-link" href="/search?collection=works">搜索作品</Link>
          <Link className="back-link" href="/browse">浏览全部</Link>
          <span>{items.length} / {allItems.length} 条</span>
          <span>当前页 {pageItems.length} 条</span>
          {markedItems.length ? <span>普通模式隐藏 {markedItems.length} 条标记作品</span> : null}
        </div>
        <nav className="media-group-links" aria-label="作品类型快速筛选">
          <Link href="/works">全部</Link>
          {mediaGroupOptions.map((option) => (
            <Link href={`/works?media=${option.value}`} key={option.value}>{option.label}</Link>
          ))}
        </nav>
        <WorksFilterForm filters={filters} />
        {activeFilterLabels.length ? (
          <div className="active-filter-list" aria-label="当前筛选条件">
            {activeFilterLabels.map((label) => <span key={label}>{label}</span>)}
          </div>
        ) : null}
        <WorksPagination currentPage={currentPage} filters={filters} pageSize={pageSize} totalItems={items.length} totalPages={totalPages} />
        {groups.length ? (
          <nav className="rank-jump-list" id="works-rank-nav" aria-label="当前页作品分级快速跳转">
            {groups.map((group) => (
              <a href={`#${rankAnchor(group.rank)}`} key={group.rank}>
                {rankLabel(group.rank)} <span>{group.items.length}</span>
              </a>
            ))}
          </nav>
        ) : null}
      </section>

      <details className="rank-explainer" aria-label="排雷分级说明">
        <summary>
          <span>分级说明</span>
          <strong>如何理解这些分级？</strong>
        </summary>
        <p>分级用于帮助快速定位阅读优先级，不等于最终结论。具体判断仍以条目正文、标签、材料和完整排雷原则为准。</p>
        <div className="rank-explainer-grid">
          {rankOrder.map((rank) => (
            <article className="rank-explainer-card" key={rank}>
              <h3>{rankLabel(rank)}</h3>
              <p>{rankDescriptions[rank]}</p>
            </article>
          ))}
          <Link className="rank-explainer-card rank-explainer-link" href="/rules">
            <h3>完整原则</h3>
            <p>查看排雷原则全文，了解 S / A / B / C / D / E 各级的完整判断边界。</p>
          </Link>
        </div>
      </details>

      <section className="ranked-collection-list">
        {groups.length === 0 ? (
          <section className="empty-state small">
            <h2>没有符合条件的作品</h2>
            <p>可以放宽作品类型、分级或关键词筛选条件。</p>
            <Link className="result-link" href="/works">清除筛选</Link>
          </section>
        ) : (
          groups.map((group) => (
            <section className="rank-group" id={rankAnchor(group.rank)} key={group.rank}>
              <div className="rank-group-heading">
                <h2>{rankLabel(group.rank)}</h2>
                <span>{group.items.length} 条</span>
              </div>

              <div className="collection-grid work-title-only-grid">
                {group.items.map((item) => {
                  const visibilityLabel = contentVisibilityLabel(item.contentVisibility)

                  return (
                    <Link className="collection-card work-card work-title-only-card" data-content-visibility={item.contentVisibility || 'ordinary'} href={item.url} key={item.id}>
                      <p>{rankLabel(item.rank)}</p>
                      <h2>{displayTitle(item)}</h2>
                      {visibilityLabel ? <span className="content-visibility-chip">{visibilityLabel}</span> : null}
                    </Link>
                  )
                })}
              </div>

              <div className="rank-group-actions">
                <a href="#works-rank-nav">返回分级导航</a>
              </div>
            </section>
          ))
        )}
      </section>
      <WorksPagination currentPage={currentPage} filters={filters} pageSize={pageSize} totalItems={items.length} totalPages={totalPages} />
    </main>
  )
}
