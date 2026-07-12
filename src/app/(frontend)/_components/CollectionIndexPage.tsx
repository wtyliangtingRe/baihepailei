import Link from 'next/link'

import MissingSearchIndex from './MissingSearchIndex'
import { isPublicSearchItem } from '../_lib/public-entity-guards'
import type { SearchCollection, SearchItem } from '../_lib/search-index'
import { readSearchIndex } from '../_lib/search-index'

type CollectionIndexConfig = {
  collection: SearchCollection
  eyebrow: string
  title: string
  description: string
  searchParams?: Record<string, string | string[] | undefined>
}

const defaultPageSize = 30
const pageSizeOptions = [30, 60]

const organizationTypeLabels: Record<string, string> = {
  publisher: '出版社',
  production_company: '制作公司',
  animation_studio: '动画公司',
  game_company: '游戏公司',
  distributor: '发行商',
  circle: '社团',
  brand: '品牌',
  platform: '平台',
  committee: '制作委员会',
  other: '其他机构',
}

const evidenceTypeLabels: Record<string, string> = {
  work_screenshot: '原作截图',
  official_page: '官方页面',
  interview: '访谈',
  social_media: '社交媒体',
  legacy_wiki: '历史记录',
  platform_page: '平台页面',
  other: '其他证据',
}

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || ''
  return value || ''
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

function compactValues(values: string[] | undefined, limit = 3) {
  if (!Array.isArray(values)) return ''
  return values.filter(Boolean).slice(0, limit).join(' / ')
}

function cleanLine(value?: string) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ')
}

function displayRank(rank?: string) {
  if (!rank || rank === 'unknown') return '未分级'
  if (rank === 'AA') return 'S级'
  return `${rank}级`
}

function organizationTypeLabel(value?: string) {
  if (!value) return ''
  return organizationTypeLabels[value] || value
}

function evidenceTypeLabel(value?: string) {
  if (!value) return ''
  return evidenceTypeLabels[value] || value
}

function contentVisibilityLabel(value?: string) {
  if (value === 'adult') return '标记内容'
  if (value === 'restricted') return '限制展示'
  return ''
}

function primaryMeta(item: SearchItem) {
  if (item.collection === 'works') return displayRank(item.rank)
  if (item.collection === 'creators') return '创作者'
  if (item.collection === 'organizations') return organizationTypeLabel(item.organizationType) || '机构'
  if (item.collection === 'evidence') return evidenceTypeLabel(item.evidenceType) || '证据材料'
  if (item.collection === 'terms') return '名词解释'
  if (item.collection === 'rules') return item.category || '规则'
  return ''
}

function secondaryMeta(item: SearchItem) {
  if (item.collection === 'works') return ''
  if (item.collection === 'creators') return compactValues(item.aliases)
  if (item.collection === 'organizations') return compactValues(item.aliases)
  if (item.collection === 'evidence') return compactValues(item.relatedWorks) || compactValues(item.relatedOrganizations)
  if (item.collection === 'terms') return compactValues(item.relatedWarnings)
  if (item.collection === 'rules') return compactValues(item.relatedWarnings)
  return ''
}

function cardClassName(item: SearchItem) {
  return item.collection === 'works' ? 'collection-card collection-card-compact work-list-card' : 'collection-card collection-card-compact'
}

function pageHref(collection: SearchCollection, page: number, pageSize: number) {
  const params = new URLSearchParams()
  if (page > 1) params.set('page', String(page))
  if (pageSize !== defaultPageSize) params.set('perPage', String(pageSize))
  const query = params.toString()
  return query ? `/${collection}?${query}` : `/${collection}`
}

function paginationPages(currentPage: number, totalPages: number) {
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1])
  return [...pages]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b)
}

function CollectionPagination({ collection, currentPage, pageSize, totalItems, totalPages }: { collection: SearchCollection; currentPage: number; pageSize: number; totalItems: number; totalPages: number }) {
  if (totalItems === 0) return null

  const firstItem = (currentPage - 1) * pageSize + 1
  const lastItem = Math.min(totalItems, currentPage * pageSize)
  const pages = paginationPages(currentPage, totalPages)

  return (
    <nav className="collection-actions" aria-label="分页">
      <span>第 {currentPage} / {totalPages} 页</span>
      <span>显示 {firstItem}-{lastItem} / {totalItems} 条</span>
      {currentPage > 1 ? <Link className="back-link" href={pageHref(collection, currentPage - 1, pageSize)}>上一页</Link> : <span>上一页</span>}
      {pages.map((page) => (
        page === currentPage
          ? <span key={page}>{page}</span>
          : <Link className="back-link" href={pageHref(collection, page, pageSize)} key={page}>{page}</Link>
      ))}
      {currentPage < totalPages ? <Link className="back-link" href={pageHref(collection, currentPage + 1, pageSize)}>下一页</Link> : <span>下一页</span>}
      <span>每页</span>
      {pageSizeOptions.map((option) => (
        option === pageSize
          ? <span key={option}>{option}</span>
          : <Link className="back-link" href={pageHref(collection, 1, option)} key={option}>{option}</Link>
      ))}
      <form action={`/${collection}`} className="page-jump-form">
        {pageSize !== defaultPageSize ? <input name="perPage" type="hidden" value={pageSize} /> : null}
        <label>
          跳到
          <input aria-label="跳到页码" defaultValue={currentPage} min="1" max={totalPages} name="page" type="number" />
        </label>
        <button className="back-link" type="submit">跳转</button>
      </form>
    </nav>
  )
}

export default function CollectionIndexPage({ collection, eyebrow, title, description, searchParams = {} }: CollectionIndexConfig) {
  const index = readSearchIndex()
  if (!index) return <MissingSearchIndex />

  const pageSize = normalizePageSize(firstParam(searchParams.perPage))
  const requestedPage = normalizePositiveInteger(firstParam(searchParams.page), 1)

  const items = index.items
    .filter((item) => item.collection === collection && isPublicSearchItem(item))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(requestedPage, totalPages)
  const pageStart = (currentPage - 1) * pageSize
  const pageItems = items.slice(pageStart, pageStart + pageSize)
  const markedItems = items.filter((item) => item.collection === 'works' && item.contentVisibility && item.contentVisibility !== 'ordinary')

  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="collection-actions">
          <Link className="back-link" href={`/search?collection=${collection}`}>
            搜索
          </Link>
          <Link className="back-link" href="/browse">
            浏览全部
          </Link>
          <span>{items.length} 条</span>
          <span>当前页 {pageItems.length} 条</span>
          {markedItems.length ? <span>普通模式隐藏 {markedItems.length} 条标记作品</span> : null}
        </div>
        <CollectionPagination collection={collection} currentPage={currentPage} pageSize={pageSize} totalItems={items.length} totalPages={totalPages} />
      </section>

      <section className="collection-grid collection-grid-compact">
        {pageItems.map((item) => {
          const secondary = secondaryMeta(item)
          const visibilityLabel = contentVisibilityLabel(item.contentVisibility)
          const meta = primaryMeta(item)
          const titleText = cleanLine(item.title)

          return (
            <Link className={cardClassName(item)} data-content-visibility={item.contentVisibility || 'ordinary'} href={item.url} key={item.id}>
              {meta ? <p>{meta}</p> : null}
              <h2 title={titleText}>{titleText}</h2>
              {visibilityLabel ? <span className="content-visibility-chip">{visibilityLabel}</span> : null}
              {secondary ? <span>{secondary}</span> : null}
            </Link>
          )
        })}
      </section>
      <CollectionPagination collection={collection} currentPage={currentPage} pageSize={pageSize} totalItems={items.length} totalPages={totalPages} />
    </main>
  )
}
