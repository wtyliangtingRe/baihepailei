import Link from 'next/link'

import MissingSearchIndex from '../_components/MissingSearchIndex'
import { readSearchIndex, type SearchCoverImage, type SearchItem } from '../_lib/search-index'

const rankOrder = ['AA', 'A', 'B', 'C', 'D', 'E', 'unknown']
const defaultPageSize = 30

const mediaGroupOptions = [
  { label: '动画', value: 'anime' },
  { label: '漫画', value: 'manga' },
  { label: '小说', value: 'novel' },
  { label: '游戏', value: 'game' },
  { label: '其他', value: 'other' },
  { label: '未知', value: 'unknown' },
]

const mediaGroupLabels: Record<string, string> = {
  anime: '动画',
  manga: '漫画',
  novel: '小说',
  game: '游戏',
  other: '其他',
  unknown: '未知类型',
}

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

type WorksSearchItem = SearchItem & {
  hasEvidence?: boolean
}

type NormalizedFilters = {
  q: string
  rank: string
  media: string
  creator: string
  organization: string
  evidence: string
}

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || ''
  return value || ''
}

function normalizeText(value: string | undefined) {
  return String(value || '').trim().toLowerCase()
}

function normalizePositiveInteger(value: string | undefined, fallback: number) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue < 1) return fallback
  return Math.floor(numberValue)
}

function normalizePageSize() {
  return defaultPageSize
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

function mediaGroupLabel(value?: string) {
  if (!value) return ''
  return mediaGroupLabels[value] || value
}

function hasEvidence(item: SearchItem) {
  return Boolean((item as WorksSearchItem).hasEvidence)
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

function compactValues(values?: string[]) {
  if (!Array.isArray(values)) return []
  return values.filter(Boolean)
}

function uniqueValues(items: SearchItem[], key: 'creators' | 'organizations') {
  const values = new Set<string>()
  for (const item of items) {
    for (const value of compactValues(item[key])) values.add(value)
  }
  return [...values].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

function contentVisibilityLabel(value?: string) {
  if (value === 'adult') return '标记内容'
  if (value === 'restricted') return '限制展示'
  return ''
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
  if (filters.creator && !compactValues(item.creators).includes(filters.creator)) return false
  if (filters.organization && !compactValues(item.organizations).includes(filters.organization)) return false
  if (filters.evidence === 'with' && !hasEvidence(item)) return false
  if (filters.evidence === 'without' && hasEvidence(item)) return false
  return itemMatchesQuery(item, filters.q)
}

function filterLabel(filters: NormalizedFilters) {
  const labels = []
  if (filters.q) labels.push(`关键词：${filters.q}`)
  if (filters.rank !== 'all') labels.push(`分级：${rankLabel(filters.rank)}`)
  if (filters.media !== 'all') labels.push(`作品类型：${mediaGroupLabel(filters.media)}`)
  if (filters.creator) labels.push(`创作者：${filters.creator}`)
  if (filters.organization) labels.push(`机构：${filters.organization}`)
  if (filters.evidence === 'with') labels.push('只看有证据材料')
  if (filters.evidence === 'without') labels.push('只看暂无证据材料')
  return labels
}

function parseFilters(params: Record<string, string | string[] | undefined>): NormalizedFilters {
  const evidence = firstParam(params.evidence)
  return {
    q: firstParam(params.q).trim(),
    rank: normalizeRank(firstParam(params.rank)),
    media: normalizeMediaGroup(firstParam(params.media)),
    creator: firstParam(params.creator).trim(),
    organization: firstParam(params.organization).trim(),
    evidence: evidence === 'with' || evidence === 'without' ? evidence : 'all',
  }
}

function pageHref(filters: NormalizedFilters, page: number) {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.rank !== 'all') params.set('rank', filters.rank)
  if (filters.media !== 'all') params.set('media', filters.media)
  if (filters.creator) params.set('creator', filters.creator)
  if (filters.organization) params.set('organization', filters.organization)
  if (filters.evidence !== 'all') params.set('evidence', filters.evidence)
  if (page > 1) params.set('page', String(page))

  const query = params.toString()
  return query ? `/works?${query}` : '/works'
}

function paginationPages(currentPage: number, totalPages: number) {
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1])
  return [...pages]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b)
}

function HiddenFilterInputs({ filters }: { filters: NormalizedFilters }) {
  return (
    <>
      {filters.q ? <input name="q" type="hidden" value={filters.q} /> : null}
      {filters.rank !== 'all' ? <input name="rank" type="hidden" value={filters.rank} /> : null}
      {filters.media !== 'all' ? <input name="media" type="hidden" value={filters.media} /> : null}
      {filters.creator ? <input name="creator" type="hidden" value={filters.creator} /> : null}
      {filters.organization ? <input name="organization" type="hidden" value={filters.organization} /> : null}
      {filters.evidence !== 'all' ? <input name="evidence" type="hidden" value={filters.evidence} /> : null}
    </>
  )
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

function WorksFilterForm({ creators, filters, organizations }: { creators: string[]; filters: NormalizedFilters; organizations: string[] }) {
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
            <option value="unknown">未分级</option>
          </select>
        </label>
        <label>
          <span>创作者</span>
          <select defaultValue={filters.creator} name="creator">
            <option value="">全部创作者</option>
            {creators.map((creator) => (
              <option key={creator} value={creator}>{creator}</option>
            ))}
          </select>
        </label>
        <label>
          <span>机构</span>
          <select defaultValue={filters.organization} name="organization">
            <option value="">全部机构</option>
            {organizations.map((organization) => (
              <option key={organization} value={organization}>{organization}</option>
            ))}
          </select>
        </label>
        <label>
          <span>证据材料</span>
          <select defaultValue={filters.evidence} name="evidence">
            <option value="all">全部作品</option>
            <option value="with">只看有证据材料</option>
            <option value="without">只看暂无证据材料</option>
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
      {currentPage > 1 ? <Link className="back-link" href={pageHref(filters, currentPage - 1)}>上一页</Link> : <span>上一页</span>}
      {pages.map((page) => (
        page === currentPage
          ? <span key={page}>{page}</span>
          : <Link className="back-link" href={pageHref(filters, page)} key={page}>{page}</Link>
      ))}
      {currentPage < totalPages ? <Link className="back-link" href={pageHref(filters, currentPage + 1)}>下一页</Link> : <span>下一页</span>}
      <form action="/works" className="page-jump-form">
        <HiddenFilterInputs filters={filters} />
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
  const pageSize = normalizePageSize()
  const requestedPage = normalizePositiveInteger(firstParam(params.page), 1)

  const allItems = index.items
    .filter((item) => item.collection === 'works')
    .sort((a, b) => rankSortValue(a.rank) - rankSortValue(b.rank) || a.title.localeCompare(b.title, 'zh-CN'))

  const markedItems = allItems.filter((item) => item.contentVisibility && item.contentVisibility !== 'ordinary')
  const items = allItems.filter((item) => itemMatchesFilters(item, filters))
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(requestedPage, totalPages)
  const pageStart = (currentPage - 1) * pageSize
  const pageItems = items.slice(pageStart, pageStart + pageSize)
  const activeFilterLabels = filterLabel(filters)
  const creators = uniqueValues(allItems, 'creators')
  const organizations = uniqueValues(allItems, 'organizations')

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
        <p>浏览轻量搜索索引中的作品条目，并按作品类型、排雷分级、创作者、机构和证据材料状态筛选。</p>
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
        <WorksFilterForm creators={creators} filters={filters} organizations={organizations} />
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
            <p>可以放宽作品类型、分级、创作者、机构或证据材料筛选条件。</p>
            <Link className="result-link" href="/works">清除筛选</Link>
          </section>
        ) : (
          groups.map((group) => (
            <section className="rank-group" id={rankAnchor(group.rank)} key={group.rank}>
              <div className="rank-group-heading">
                <h2>{rankLabel(group.rank)}</h2>
                <span>{group.items.length} 条</span>
              </div>

              <div className="collection-grid">
                {group.items.map((item) => {
                  const visibilityLabel = contentVisibilityLabel(item.contentVisibility)

                  return (
                    <Link className="collection-card work-card" data-content-visibility={item.contentVisibility || 'ordinary'} href={item.url} key={item.id}>
                      <CoverThumb cover={item.cover} title={item.title} />
                      <div className="work-card-body">
                        <p>{[rankLabel(item.rank), mediaGroupLabel(item.mediaGroup)].filter(Boolean).join(' · ')}</p>
                        <h2>{item.title}</h2>
                        {visibilityLabel ? <span className="content-visibility-chip">{visibilityLabel}</span> : null}
                        {item.originalTitle ? <span>原名：{item.originalTitle}</span> : null}
                        {compactValues(item.localizedTitles).length ? <span>译名：{compactValues(item.localizedTitles).slice(0, 2).join(' / ')}</span> : null}
                        {[item.mediaType, item.format, item.firstPublishedLabel].filter(Boolean).length ? (
                          <span>基础信息：{[item.mediaType, item.format, item.firstPublishedLabel].filter(Boolean).join(' / ')}</span>
                        ) : null}
                        {compactValues(item.creators).length ? <span>创作者：{compactValues(item.creators).join(' / ')}</span> : null}
                        {compactValues(item.organizations).length ? <span>机构：{compactValues(item.organizations).join(' / ')}</span> : null}
                        {hasEvidence(item) ? <span>有证据材料</span> : null}
                      </div>
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
