import Link from 'next/link'

import MissingSearchIndex from '../_components/MissingSearchIndex'
import { readSearchIndex, type SearchCoverImage, type SearchItem } from '../_lib/search-index'

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

type WorksSearchParams = Promise<Record<string, string | string[] | undefined>>

type NormalizedFilters = {
  q: string
  rank: string
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

function normalizeRank(value: string) {
  const rank = String(value || '').trim()
  if (!rank || rank === 'all') return 'all'
  if (rank.toUpperCase() === 'S') return 'AA'
  if (rank.toLowerCase() === 'unknown') return 'unknown'
  return rank.toUpperCase()
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

function itemMatchesQuery(item: SearchItem, query: string) {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return true

  const haystack = [
    item.title,
    item.originalTitle,
    ...(item.aliases || []),
    ...(item.creators || []),
    ...(item.organizations || []),
    ...(item.tags || []),
    ...(item.warnings || []),
    item.rank,
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
  if (filters.rank !== 'all' && rank !== filters.rank) return false
  if (filters.creator && !compactValues(item.creators).includes(filters.creator)) return false
  if (filters.organization && !compactValues(item.organizations).includes(filters.organization)) return false
  if (filters.evidence === 'with' && !item.hasEvidence) return false
  if (filters.evidence === 'without' && item.hasEvidence) return false
  return itemMatchesQuery(item, filters.q)
}

function filterLabel(filters: NormalizedFilters) {
  const labels = []
  if (filters.q) labels.push(`关键词：${filters.q}`)
  if (filters.rank !== 'all') labels.push(`分级：${rankLabel(filters.rank)}`)
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
    creator: firstParam(params.creator).trim(),
    organization: firstParam(params.organization).trim(),
    evidence: evidence === 'with' || evidence === 'without' ? evidence : 'all',
  }
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
          <input defaultValue={filters.q} name="q" placeholder="作品名、原名、作者、机构、标签" type="search" />
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

export default async function WorksIndexPage({ searchParams }: { searchParams?: WorksSearchParams }) {
  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const params = searchParams ? await searchParams : {}
  const filters = parseFilters(params)

  const allItems = index.items
    .filter((item) => item.collection === 'works')
    .sort((a, b) => rankSortValue(a.rank) - rankSortValue(b.rank) || a.title.localeCompare(b.title, 'zh-CN'))

  const items = allItems.filter((item) => itemMatchesFilters(item, filters))
  const activeFilterLabels = filterLabel(filters)
  const creators = uniqueValues(allItems, 'creators')
  const organizations = uniqueValues(allItems, 'organizations')

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
        <p>按排雷分级、创作者、机构和证据材料状态筛选轻量搜索索引中的作品条目。</p>
        <div className="collection-actions">
          <Link className="back-link" href="/search?collection=works">搜索作品</Link>
          <Link className="back-link" href="/browse">浏览全部</Link>
          <span>{items.length} / {allItems.length} 条</span>
        </div>
        <WorksFilterForm creators={creators} filters={filters} organizations={organizations} />
        {activeFilterLabels.length ? (
          <div className="active-filter-list" aria-label="当前筛选条件">
            {activeFilterLabels.map((label) => <span key={label}>{label}</span>)}
          </div>
        ) : null}
        {groups.length ? (
          <nav className="rank-jump-list" id="works-rank-nav" aria-label="作品分级快速跳转">
            {groups.map((group) => (
              <a href={`#${rankAnchor(group.rank)}`} key={group.rank}>
                {rankLabel(group.rank)} <span>{group.items.length}</span>
              </a>
            ))}
          </nav>
        ) : null}
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
        {groups.length === 0 ? (
          <section className="empty-state small">
            <h2>没有符合条件的作品</h2>
            <p>可以放宽分级、创作者、机构或证据材料筛选条件。</p>
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
                {group.items.map((item) => (
                  <Link className="collection-card work-card" href={item.url} key={item.id}>
                    <CoverThumb cover={item.cover} title={item.title} />
                    <div className="work-card-body">
                      <p>{rankLabel(item.rank)}</p>
                      <h2>{item.title}</h2>
                      {item.originalTitle ? <span>{item.originalTitle}</span> : null}
                      {compactValues(item.creators).length ? <span>创作者：{compactValues(item.creators).join(' / ')}</span> : null}
                      {compactValues(item.organizations).length ? <span>机构：{compactValues(item.organizations).join(' / ')}</span> : null}
                      {item.hasEvidence ? <span>有证据材料</span> : null}
                    </div>
                  </Link>
                ))}
              </div>

              <div className="rank-group-actions">
                <a href="#works-rank-nav">返回分级导航</a>
              </div>
            </section>
          ))
        )}
      </section>
    </main>
  )
}
