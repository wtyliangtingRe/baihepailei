import Link from 'next/link'

import type { SearchItem } from '../_lib/search-index'

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
  legacy_wiki: '旧站记录',
  platform_page: '平台页面',
  other: '其他证据',
}

const reviewStatusLabels: Record<string, string> = {
  pending: '待复核',
  reviewed: '已复核',
  disputed: '有争议',
  deprecated: '已废弃',
}

const evidenceStrengthLabels: Record<string, string> = {
  unassessed: '未评估',
  weak: '证据弱',
  medium: '证据中',
  strong: '证据强',
}

const mediaGroupLabels: Record<string, string> = {
  anime: '动画',
  manga: '漫画',
  novel: '小说',
  game: '游戏',
  other: '其他',
  unknown: '未知类型',
}

const advisoryLabels: Record<string, string> = {
  suggestive: '暗示性内容',
  erotica: '成人向',
  pornographic: '成人内容',
  doujinshi_or_extra: '同人 / 衍生',
  restricted: '限制展示',
}

function collectionLabel(collection: string) {
  if (collection === 'works') return '作品'
  if (collection === 'creators') return '创作者'
  if (collection === 'organizations') return '机构'
  if (collection === 'evidence') return '证据材料'
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

function mediaGroupLabel(value?: string) {
  if (!value) return ''
  return mediaGroupLabels[value] || value
}

function organizationTypeLabel(value?: string) {
  if (!value) return ''
  return organizationTypeLabels[value] || value
}

function evidenceTypeLabel(value?: string) {
  if (!value) return ''
  return evidenceTypeLabels[value] || value
}

function reviewStatusLabel(value?: string) {
  if (!value) return ''
  return reviewStatusLabels[value] || value
}

function evidenceStrengthLabel(value?: string) {
  if (!value) return ''
  return evidenceStrengthLabels[value] || value
}

function contentVisibilityLabel(value?: string) {
  if (value === 'adult') return '标记内容'
  if (value === 'restricted') return '限制展示'
  return ''
}

function advisoryLabel(value: string) {
  return advisoryLabels[value] || value
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
    ['复核状态', reviewStatusLabel(item.reviewStatus)],
    ['证据强度', evidenceStrengthLabel(item.evidenceStrength)],
    ['作品大类', mediaGroupLabel(item.mediaGroup)],
    ['作品类型', item.mediaType],
    ['作品形态', item.format],
    ['首次发表', item.firstPublishedLabel],
    ['内容标记', contentVisibilityLabel(item.contentVisibility)],
    ['内容提示', item.contentAdvisories?.map(advisoryLabel)],
    ['机构类型', organizationTypeLabel(item.organizationType)],
    ['证据类型', evidenceTypeLabel(item.evidenceType)],
    ['原名', item.originalTitle],
    ['译名 / 地区名', item.localizedTitles || item.localizedNames],
    ['别名', item.aliases],
    ['关联作品', item.relatedWorks],
    ['关联创作者', item.relatedCreators],
    ['关联机构', item.relatedOrganizations],
    ['创作者', item.creators],
    ['相关机构', item.organizations],
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
  const mediaGroup = mediaGroupLabel(item.mediaGroup)
  const organizationType = organizationTypeLabel(item.organizationType)
  const evidenceType = evidenceTypeLabel(item.evidenceType)
  const reviewStatus = reviewStatusLabel(item.reviewStatus)
  const evidenceStrength = evidenceStrengthLabel(item.evidenceStrength)
  const contentVisibility = contentVisibilityLabel(item.contentVisibility)
  const searchLines = compactLines(item.searchText)

  return (
    <main className="page detail-page" data-content-visibility={item.contentVisibility || 'ordinary'}>
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
        {contentVisibility ? <p className="content-visibility-note">此条目标记为「{contentVisibility}」。普通模式下不会出现在列表和搜索结果中。</p> : null}
        <div className="detail-chips">
          {rank ? <span>{rank}</span> : null}
          {mediaGroup ? <span>{mediaGroup}</span> : null}
          {item.mediaType ? <span>{item.mediaType}</span> : null}
          {item.firstPublishedLabel ? <span>{item.firstPublishedLabel}</span> : null}
          {contentVisibility ? <span>{contentVisibility}</span> : null}
          {reviewStatus ? <span>{reviewStatus}</span> : null}
          {evidenceStrength ? <span>{evidenceStrength}</span> : null}
          {organizationType ? <span>{organizationType}</span> : null}
          {evidenceType ? <span>{evidenceType}</span> : null}
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
