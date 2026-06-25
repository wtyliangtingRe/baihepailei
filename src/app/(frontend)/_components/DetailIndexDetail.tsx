import Link from 'next/link'

import type { DetailCoverImage, DetailItem } from '../_lib/detail-index'
import RichTextRenderer from './RichTextRenderer'

type ExtendedDetailItem = DetailItem & {
  organizationType?: string
  organizations?: string[]
}

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

function collectionLabel(collection: string) {
  if (collection === 'works') return '作品'
  if (collection === 'creators') return '创作者'
  if (collection === 'organizations') return '机构'
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

function organizationTypeLabel(value?: string) {
  if (!value) return ''
  return organizationTypeLabels[value] || value
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
  const extendedItem = item as ExtendedDetailItem
  const fields: Array<[string, string | string[] | boolean | undefined]> = [
    ['机构类型', organizationTypeLabel(extendedItem.organizationType)],
    ['原名', item.originalTitle],
    ['别名', item.aliases],
    ['创作者', item.creators],
    ['相关机构', extendedItem.organizations],
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

function WorkCover({ cover, title }: { cover?: DetailCoverImage; title: string }) {
  if (cover?.url) {
    return (
      <figure className="detail-cover">
        <img alt={cover.alt || `${title}封面`} src={cover.url} />
      </figure>
    )
  }

  return (
    <figure className="detail-cover detail-cover-placeholder" aria-label="暂无封面">
      <span>暂无封面</span>
    </figure>
  )
}

function RelatedWorks({ works }: { works: DetailItem[] }) {
  if (works.length === 0) return null

  return (
    <section className="detail-card related-works-card">
      <h2>相关作品</h2>
      <div className="related-work-list">
        {works.map((work) => (
          <Link className="related-work-item" href={work.url} key={work.id}>
            <span>{displayRank(work.rank) || '未分级'}</span>
            <strong>{work.title}</strong>
            {work.originalTitle ? <em>{work.originalTitle}</em> : null}
          </Link>
        ))}
      </div>
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

export default function DetailIndexDetail({ item, relatedWorks = [] }: { item: DetailItem; relatedWorks?: DetailItem[] }) {
  const extendedItem = item as ExtendedDetailItem
  const rank = displayRank(item.rank)
  const organizationType = organizationTypeLabel(extendedItem.organizationType)

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
        <div className="detail-hero-layout">
          {item.collection === 'works' ? <WorkCover cover={item.cover} title={item.title} /> : null}
          <div>
            <p className="eyebrow">{collectionLabel(item.collection)}</p>
            <h1>{item.title}</h1>
            <div className="detail-chips">
              {rank ? <span>{rank}</span> : null}
              {organizationType ? <span>{organizationType}</span> : null}
              {item.category ? <span>{item.category}</span> : null}
              {item.hasEvidence ? <span>有证据材料</span> : null}
            </div>
          </div>
        </div>
      </section>

      <BasicInfo item={item} />
      <RelatedWorks works={relatedWorks} />
      <RichTextSections item={item} />
      <SourceLinks item={item} />
    </main>
  )
}
