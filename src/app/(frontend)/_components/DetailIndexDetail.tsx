import Link from 'next/link'

import type { DetailItem } from '../_lib/detail-index'
import RichTextRenderer from './RichTextRenderer'

function collectionLabel(collection: string) {
  if (collection === 'works') return '作品'
  if (collection === 'creators') return '创作者'
  if (collection === 'terms') return '名词解释'
  if (collection === 'rules') return '规则'
  return collection
}

function valuesOf(value: string | string[] | boolean | undefined) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'boolean') return value ? ['是'] : []
  return value ? [value] : []
}

function visibleFieldsOf(fields: Array<[string, string | string[] | boolean | undefined]>) {
  return fields
    .map(([label, value]) => [label, valuesOf(value)] as const)
    .filter(([, values]) => values.length > 0)
}

function FieldList({ fields }: { fields: Array<[string, string | string[] | boolean | undefined]> }) {
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

function BasicInfo({ item }: { item: DetailItem }) {
  const fields: Array<[string, string | string[] | boolean | undefined]> = [
    ['原名', item.originalTitle],
    ['别名', item.aliases],
    ['创作者', item.creators],
    ['标签', item.tags],
    ['注意点', item.warnings],
    ['相关名词', item.relatedTerms],
    ['相关注意点', item.relatedWarnings],
    ['相关标签', item.relatedTags],
    ['相关作品', item.examples],
    ['证据备注', item.evidenceNote],
    ['状态', item.status],
  ]

  if (visibleFieldsOf(fields).length === 0) return null

  return (
    <section className="detail-card">
      <h2>基础信息</h2>
      <FieldList fields={fields} />
    </section>
  )
}

function SourceLinks({ item }: { item: DetailItem }) {
  const links = (item.sourceLinks || []).filter((link) => link.url)
  if (links.length === 0) return null

  return (
    <section className="detail-card">
      <h2>来源链接</h2>
      <ul className="source-links">
        {links.map((link) => (
          <li key={link.url}>
            <a href={link.url} rel="noreferrer" target="_blank">
              {link.label || link.url}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RichTextSections({ item }: { item: DetailItem }) {
  const sections = item.sections || []
  if (sections.length === 0) {
    return (
      <section className="detail-card">
        <h2>正文</h2>
        <p className="muted">暂无正文详情。请重新生成 detail-index.json 后再查看。</p>
      </section>
    )
  }

  return (
    <>
      {sections.map((section) => (
        <section className="detail-card" key={section.key}>
          <h2>{section.label}</h2>
          <RichTextRenderer content={section.content} fallback={section.plainText} />
        </section>
      ))}
    </>
  )
}

export default function DetailIndexDetail({ item }: { item: DetailItem }) {
  return (
    <main className="page detail-page">
      <section className="detail-hero">
        <div className="detail-actions">
          <Link className="back-link" href="/search">
            ← 返回搜索
          </Link>
          <Link className="back-link" href={`/${item.collection}`}>
            浏览同类
          </Link>
        </div>
        <p className="eyebrow">{collectionLabel(item.collection)}</p>
        <h1>{item.title}</h1>
        <div className="detail-chips">
          {item.rank && item.rank !== 'unknown' ? <span>{item.rank}级</span> : null}
          {item.category ? <span>{item.category}</span> : null}
          {item.hasEvidence ? <span>有证据材料</span> : null}
        </div>
      </section>

      <BasicInfo item={item} />
      <RichTextSections item={item} />
      <SourceLinks item={item} />
    </main>
  )
}
