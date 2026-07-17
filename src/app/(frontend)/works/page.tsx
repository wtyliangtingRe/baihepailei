import Link from 'next/link'

import { publicContentImagesEnabled } from '@/lib/deploymentProfile'

import MissingSearchIndex from '../_components/MissingSearchIndex'
import AssessmentOriginBadge from '../_components/AssessmentOriginBadge'
import { readSearchIndex, type SearchItem } from '../_lib/search-index'

const rankOrder = ['AA', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'unknown']
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

const mediaGroupLabels = Object.fromEntries(mediaGroupOptions.map((option) => [option.value, option.label])) as Record<string, string>
const mediaTypeLabels: Record<string, string> = {
  anime: '动画',
  manga: '漫画',
  novel: '小说',
  light_novel: '轻小说',
  visual_novel: '视觉小说',
  game: '游戏',
  audio_drama: '广播剧 / 音声',
  live_action: '真人影视',
  webtoon: 'Webtoon',
  doujin: '同人作品',
  anthology: '合集 / 选集',
  other: '其他',
  unknown: '未知类型',
}
const workFormatLabels: Record<string, string> = {
  tv_anime: 'TV 动画',
  anime_movie: '动画电影',
  ova: 'OVA',
  ona: '网络动画',
  manga_series: '漫画连载',
  manga_oneshot: '漫画短篇',
  novel_series: '小说系列',
  light_novel_series: '轻小说系列',
  web_serial: 'Web 连载',
  visual_novel: '视觉小说',
  pc_game: 'PC 游戏',
  console_game: '主机游戏',
  mobile_game: '手机游戏',
  audio_drama: '广播剧 / 音声',
  live_action: '真人影视',
  webtoon_series: 'Webtoon 连载',
  doujin: '同人作品',
  anthology: '合集 / 选集',
  other: '其他',
  unknown: '未知形态',
}

let cachedSourceItems: SearchItem[] | undefined
let cachedSortedWorks: SearchItem[] = []
let cachedMarkedWorks = 0
const titleCache = new WeakMap<SearchItem, string>()
const searchBlobCache = new WeakMap<SearchItem, string>()

const rankDescriptions: Record<string, string> = {
  AA: '高度稳定的百合作品。核心关系明确，整体风险极低，通常适合作为优先阅读对象。',
  A: '整体较安全。可能存在轻微注意点，但通常不影响其作为百合作品的基本判断。',
  B: '仍可作为百合作品参考，但已存在明确注意点，建议结合条目正文、标签和上下文进一步理解。',
  C: '中度注意级别。不宜只看分级下结论，需要结合页面提示、正文与证据材料综合判断。',
  D: '边界项、特殊设定项或低优先级参考项，需进一步查看说明与具体原因。',
  E: '重雷级别。已存在较明显的不适内容、恶意要素或显著风险，设立该级是为了公开展示并帮助避雷。',
  F: '高危排雷。用于标记严重结局雷、明显高危内容或其他需要强提示的情况。',
  X: '黑名单级别。用于标记极端恶意或超出普通整理框架的高风险对象，并保持公开展示。',
  unknown: '暂时没有明确分级，等待后续整理、补充证据或复核。',
}

type WorksSearchParams = Promise<Record<string, string | string[] | undefined>>

type NormalizedFilters = {
  q: string
  rank: string
  media: string
  assessment: string
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

function normalizeAssessment(value: string) {
  return ['ai', 'human', 'pending', 'disputed', 'unassessed'].includes(value) ? value : 'all'
}

function assessmentKey(item: SearchItem) {
  if (item.reviewStatus === 'disputed') return 'disputed'
  if (item.reviewStatus === 'reviewed' || item.ratingNotice === 'manual_reviewed') return 'human'
  if (item.ratingNotice === 'ai_synthesized_pending_review' || item.radarAssessment?.assessedAt || item.radarAssessment?.suggestedGrade || item.researchPreview) return 'ai'
  if (item.reviewStatus === 'pending') return 'pending'
  return 'unassessed'
}

function rankLabel(rank?: string) {
  if (!rank || rank === 'unknown') return '未录入'
  if (rank === 'AA') return 'S级'
  return `${rank}级`
}

function rankAnchor(rank?: string) {
  if (!rank || rank === 'unknown') return 'rank-unknown'
  if (rank === 'AA') return 'rank-s'
  return `rank-${rank.toLowerCase()}`
}

function storedRankKey(rank?: string) {
  const normalized = String(rank || 'unknown').trim().toUpperCase()
  if (normalized === 'S' || normalized === 'AA') return 'AA'
  return normalized.toLowerCase() === 'unknown' ? 'unknown' : normalized
}

function rankSortValue(rank?: string) {
  const normalizedRank = storedRankKey(rank)
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
  const cached = titleCache.get(item)
  if (cached) return cached
  const candidates = uniqueTitleValues([...(item.localizedTitles || []), item.title, item.originalTitle, ...(item.aliases || [])])
  const title = candidates.find(isChineseTitle) || candidates.find(isJapaneseTitle) || candidates.find(isEnglishTitle) || candidates[0] || item.title
  titleCache.set(item, title)
  return title
}

function sortedWorks(items: SearchItem[]) {
  if (cachedSourceItems === items) return cachedSortedWorks

  cachedSourceItems = items
  cachedSortedWorks = items
    .filter((item) => item.collection === 'works')
    .sort((a, b) => rankSortValue(a.rank) - rankSortValue(b.rank) || displayTitle(a).localeCompare(displayTitle(b), 'zh-CN'))
  cachedMarkedWorks = cachedSortedWorks.filter((item) => item.contentVisibility && item.contentVisibility !== 'ordinary').length
  return cachedSortedWorks
}

function searchBlob(item: SearchItem) {
  const cached = searchBlobCache.get(item)
  if (cached !== undefined) return cached

  const value = [
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
    mediaGroupLabels[item.mediaGroup || 'unknown'],
    mediaTypeLabels[item.mediaType || 'unknown'],
    workFormatLabels[item.format || 'unknown'],
    item.firstPublishedLabel,
    item.searchText,
  ]
    .map((value) => normalizeText(value))
    .join('\n')

  searchBlobCache.set(item, value)
  return value
}

function workTypeLabels(item: SearchItem) {
  const group = mediaGroupLabels[item.mediaGroup || 'unknown'] || item.mediaGroup || '未知类型'
  const format = workFormatLabels[item.format || 'unknown']
  const type = mediaTypeLabels[item.mediaType || 'unknown']
  const specific = format && format !== '未知形态' ? format : type && type !== '未知类型' ? type : group
  return { group, specific }
}

function itemMatchesQuery(item: SearchItem, query: string) {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return true

  const haystack = searchBlob(item)

  return normalizedQuery
    .split(/\s+/g)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

function itemMatchesFilters(item: SearchItem, filters: NormalizedFilters) {
  const rank = storedRankKey(item.rank)
  const mediaGroup = item.mediaGroup || 'unknown'
  if (filters.rank !== 'all' && rank !== filters.rank) return false
  if (filters.media !== 'all' && mediaGroup !== filters.media) return false
  if (filters.assessment !== 'all' && assessmentKey(item) !== filters.assessment) return false
  return itemMatchesQuery(item, filters.q)
}

function filterLabel(filters: NormalizedFilters) {
  const labels = []
  if (filters.q) labels.push(`关键词：${filters.q}`)
  if (filters.rank !== 'all') labels.push(`分级：${rankLabel(filters.rank)}`)
  if (filters.media !== 'all') labels.push(`作品类型：${filters.media}`)
  if (filters.assessment !== 'all') labels.push(`评估状态：${filters.assessment}`)
  return labels
}

function parseFilters(params: Record<string, string | string[] | undefined>): NormalizedFilters {
  return {
    q: firstParam(params.q).trim(),
    rank: normalizeRank(firstParam(params.rank)),
    media: normalizeMediaGroup(firstParam(params.media)),
    assessment: normalizeAssessment(firstParam(params.assessment)),
  }
}

function pageHref(filters: NormalizedFilters, page: number, pageSize: number) {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.rank !== 'all') params.set('rank', filters.rank)
  if (filters.media !== 'all') params.set('media', filters.media)
  if (filters.assessment !== 'all') params.set('assessment', filters.assessment)
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
      {filters.assessment !== 'all' ? <input name="assessment" type="hidden" value={filters.assessment} /> : null}
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
          <span>评估状态</span>
          <select defaultValue={filters.assessment} name="assessment">
            <option value="all">全部状态</option>
            <option value="ai">AI 已评估 · 待人工复核</option>
            <option value="human">人工已复核</option>
            <option value="pending">待复核（尚无 AI 明细）</option>
            <option value="disputed">有争议 / 已退回</option>
            <option value="unassessed">尚未评估</option>
          </select>
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
            <option value="F">F级</option>
            <option value="X">X级</option>
            <option value="unknown">未录入</option>
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

  const allItems = sortedWorks(index.items)
  const items = allItems.filter((item) => itemMatchesFilters(item, filters))
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(requestedPage, totalPages)
  const pageStart = (currentPage - 1) * pageSize
  const pageItems = items.slice(pageStart, pageStart + pageSize)
  const activeFilterLabels = filterLabel(filters)
  const showImages = publicContentImagesEnabled() && index.mediaMode !== 'text'
  const aiPendingCount = allItems.filter((item) => assessmentKey(item) === 'ai').length

  const groups = rankOrder
    .map((rank) => ({
      rank,
      items: pageItems.filter((item) => storedRankKey(item.rank) === rank),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">作品</p>
        <h1>作品</h1>
        <p>浏览作品条目、排雷分级与页面提示，并按作品类型、分级或关键词筛选。</p>
        <div className="collection-actions">
          <Link className="back-link" href="/search?collection=works">搜索作品</Link>
          <Link className="back-link" href="/browse">浏览全部</Link>
          <span>{items.length} / {allItems.length} 条</span>
          <span>当前页 {pageItems.length} 条</span>
          <span>AI 已评估待复核 {aiPendingCount} 条</span>
          <span>{index.profile === 'lite' ? '轻量索引' : '完整索引'}</span>
          {cachedMarkedWorks ? <span>普通模式隐藏 {cachedMarkedWorks} 条标记作品</span> : null}
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
        <p>分级用于帮助读者快速判断作品的大致排雷风险与阅读优先级，但不等于完整结论。实际判断仍应结合作品正文、标签、证据材料、页面提示与完整排雷规则综合理解。</p>
        <div className="rank-explainer-grid">
          {rankOrder.map((rank) => (
            <article className="rank-explainer-card" key={rank}>
              <h3>{rankLabel(rank)}</h3>
              <p>{rankDescriptions[rank]}</p>
            </article>
          ))}
          <Link className="rank-explainer-card rank-explainer-link" href="/rules">
            <h3>完整规则</h3>
            <p>查看排雷规则全文，了解 S / A / B / C / D / E / F / X 各级的完整判断边界。</p>
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
                  const typeLabels = workTypeLabels(item)

                  return (
                    <Link className={`collection-card work-card work-title-only-card${showImages ? ' work-card-with-cover' : ''}`} data-content-visibility={item.contentVisibility || 'ordinary'} href={item.url} key={item.id}>
                      {showImages ? (
                        item.cover?.url
                          ? <img alt={item.cover.alt || `${displayTitle(item)}封面`} className="work-card-cover" height={item.cover.height} loading="lazy" src={item.cover.url} width={item.cover.width} />
                          : <span aria-hidden="true" className="work-card-cover work-card-cover-placeholder">百合</span>
                      ) : null}
                      <div className="work-card-copy">
                        <div className="work-card-badges">
                          <p>{rankLabel(item.rank)}</p>
                          <span className="work-type-chip">{typeLabels.specific}</span>
                          <AssessmentOriginBadge item={item} />
                        </div>
                        <h2>{displayTitle(item)}</h2>
                        {typeLabels.group !== typeLabels.specific ? <small>{typeLabels.group}</small> : null}
                        {visibilityLabel ? <span className="content-visibility-chip">{visibilityLabel}</span> : null}
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
