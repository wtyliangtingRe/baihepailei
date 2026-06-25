import Link from 'next/link'

import type { SearchItem } from '../_lib/search-index'

function collectionLabel(collection: string) {
  if (collection === 'works') return '作品'
  if (collection === 'creators') return '创作者'
  if (collection === 'terms') return '名词解释'
  if (collection === 'rules') return '排雷规则'
  return collection
}

function collectionBackLabel(collection: string) {
  return `返回${collectionLabel(collection)}列表`
}

function displayRank(rank?: string) {
  if (!rank || rank === 'unknown') return ''
  if (rank === 'AA') return 'S级'
  return `${rank}级`
}

function compactLines(text: string) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 18)
}

function visibleFieldsOf(fields: Array<[string, string | string[] | undefined]>) {
  return fields
    .map(([label, value]) => {
      const values = Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
      return [label, values] as const
    })
    .filter(([, values]) => values.length > 0)
}

function FieldList({ fields }: { fields: Array<[string, string | string[] | undefined]> }) {
  const visibleFields = visibleFieldsOf(fields)
  if (visibleFields.length === 0) return null

  return (
    <dl className="detail-fields">
      {visibleFields.map(([label, values]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{values.join(' / ')}</dd>
        </div>
      ))}
    </dl>
  )
}

function BasicInfo({ item }: { item: SearchItem }) {
  const fields: Array<[string, string | string[] | undefined]> = [
    ['原名', item.originalTitle],
    ['别名', item.aliases],
    ['创作者', item.creators],
    ['标签', item.tags],
    ['注意点', item.warnings],
    ['相关名词', item.relatedTerms],
    ['相关注意点', item.relatedWarnings],
  ]

  if (visibleFieldsOf(fields).length === 0) return null

  return (
    <section className="detail-card">
      <h2>基础信息</h2>
      <FieldList fields={fields} />
    </section>
  )
}

export default function SearchIndexDetail({ item }: { item: SearchItem }) {
  const rank = displayRank(item.rank)
  const searchLines = compactLines(item.searchText)

  return (
    <main className="page detail-page">
      <section className="detail-hero">
        <div className="detail-actions">
          <Link className="back-link" href="/search">
            ← 返回搜索
          </Link>
          <Link className="back-link" href={`/${item.collection}`}>
            {collectionBackLabel(item.collection)}
          </Link>
        </div>
        <p className="eyebrow">{collectionLabel(item.collection)}</p>
        <h1>{item.title}</h1>
        <div className="detail-chips">
          {rank ? <span>{rank}</span> : null}
          {item.category ? <span>{item.category}</span> : null}
        </div>
      </section>

      <BasicInfo item={item} />

      <section className="detail-card">
        <h2>搜索文本预览</h2>
        {searchLines.length ? (
          <ul className="search-text-preview">
            {searchLines.map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">暂无搜索文本。</p>
        )}
      </section>
    </main>
  )
}
