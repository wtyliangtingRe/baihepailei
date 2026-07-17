import Link from 'next/link'

import { publicContentImagesEnabled } from '@/lib/deploymentProfile'

import { readDetailIndex, type DetailCoverImage, type DetailItem, type DetailSourceLink } from '../_lib/detail-index'
import AssessmentOriginBadge from './AssessmentOriginBadge'
import CommentBlock from './CommentBlock'
import ContentCallout, { type ContentCalloutItem } from './ContentCallout'
import RichTextRenderer from './RichTextRenderer'
import WorkAssessmentTrustCard from './WorkAssessmentTrustCard'
import WorkListControl from './WorkListControl'
import WorkRiskMatrixCard from './WorkRiskMatrixCard'

type ExtendedDetailItem = DetailItem & {
  organizationType?: string
  organizations?: string[]
  evidenceType?: string
  reviewStatus?: string
  evidenceStrength?: string
  mediaGroup?: string
  mediaType?: string
  format?: string
  firstPublishedAt?: string
  firstPublishedPrecision?: string
  firstPublishedLabel?: string
  image?: DetailCoverImage
  description?: string
  capturedAt?: string
  relatedWorks?: string[]
  relatedCreators?: string[]
  relatedOrganizations?: string[]
  callouts?: ContentCalloutItem[]
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

const evidenceTypeLabels: Record<string, string> = {
  work_screenshot: '原作截图',
  official_page: '官方页面',
  interview: '访谈',
  social_media: '社交媒体',
  legacy_wiki: '历史归档记录',
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

const mediaTypeLabels: Record<string, string> = {
  anime: '动画', manga: '漫画', novel: '小说', light_novel: '轻小说', visual_novel: '视觉小说',
  game: '游戏', audio_drama: '广播剧 / 音声', live_action: '真人影视', webtoon: 'Webtoon',
  doujin: '同人作品', anthology: '合集 / 选集', other: '其他', unknown: '未知类型',
}

const workFormatLabels: Record<string, string> = {
  tv_anime: 'TV 动画', anime_movie: '动画电影', ova: 'OVA', ona: '网络动画', manga_series: '漫画连载',
  manga_oneshot: '漫画短篇', novel_series: '小说系列', light_novel_series: '轻小说系列', web_serial: 'Web 连载',
  visual_novel: '视觉小说', pc_game: 'PC 游戏', console_game: '主机游戏', mobile_game: '手机游戏',
  audio_drama: '广播剧 / 音声', live_action: '真人影视', webtoon_series: 'Webtoon 连载', doujin: '同人作品',
  anthology: '合集 / 选集', other: '其他', unknown: '未知形态',
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

function mediaGroupLabel(value?: string) {
  if (!value || value === 'unknown') return ''
  return mediaGroupLabels[value] || value
}

function mediaTypeLabel(value?: string) {
  if (!value || value === 'unknown') return ''
  return mediaTypeLabels[value] || value
}

function workFormatLabel(value?: string) {
  if (!value || value === 'unknown') return ''
  return workFormatLabels[value] || value
}

function visibleMetadataValue(value?: string) {
  const normalized = String(value || '').trim()
  if (!normalized || normalized === 'unknown') return ''
  return normalized
}

function cleanLine(value?: string) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ')
}

function normalizeKey(value: string) {
  return cleanLine(value).toLowerCase()
}

function normalizedTitleKey(value: string) {
  return cleanLine(value)
    .toLowerCase()
    .replace(/[\s\u3000]+/gu, '')
    .replace(/[\-‐‑‒–—―~〜～・:：;；,，.。!！?？'"“”‘’「」『』【】\[\]（）()]/gu, '')
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

function uniqueValues(values: Array<string | undefined>) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const raw of values) {
    const value = cleanLine(raw)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output
}

function uniqueTitleValues(values: Array<string | undefined>) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const raw of values) {
    const value = cleanLine(raw)
    if (!value) continue
    const key = normalizedTitleKey(value)
    if (seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output
}

function displayTitle(item: DetailItem) {
  const candidates = uniqueTitleValues([...(item.localizedTitles || []), item.title, item.originalTitle, ...(item.aliases || []), ...(item.allTitles || [])])
  return candidates.find(isChineseTitle) || candidates.find(isJapaneseTitle) || candidates.find(isEnglishTitle) || candidates[0] || item.title
}

function valuesOf(value: string | string[] | boolean | undefined) {
  if (Array.isArray(value)) return uniqueValues(value)
  if (typeof value === 'boolean') return value ? ['是'] : []
  return value ? [value] : []
}

function visibleFieldsOf(fields: Array<[string, string | string[] | boolean | undefined]>) {
  return fields
    .map(([label, value]) => [label, valuesOf(value)] as const)
    .filter(([, values]) => values.length > 0)
}

function relationCollection(label: string) {
  if (['创作者', '关联创作者'].includes(label)) return 'creators'
  if (['相关机构', '关联机构'].includes(label)) return 'organizations'
  if (['相关作品', '关联作品', '示例作品'].includes(label)) return 'works'
  if (label === '相关名词') return 'terms'
  return ''
}

function detailTarget(collection: string, value: string) {
  const index = readDetailIndex()
  if (!index) return null
  const key = normalizeKey(value)
  if (!key) return null
  return index.items.find((item) => item.collection === collection && normalizeKey(item.title) === key) || null
}

function InlineValue({ collection, value }: { collection: string; value: string }) {
  const target = collection ? detailTarget(collection, value) : null
  if (!target) return <span>{value}</span>
  return <Link className="detail-inline-link" href={target.url}>{value}</Link>
}

function FieldList({ fields }: { fields: Array<[string, string | string[] | boolean | undefined]> }) {
  const visibleFields = visibleFieldsOf(fields)
  if (visibleFields.length === 0) return null

  return (
    <dl className="detail-fields">
      {visibleFields.map(([label, values]) => {
        const collection = relationCollection(label)
        return (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={collection ? 'detail-inline-values' : undefined}>
              {values.map((value, index) => (
                <span key={`${label}-${index}-${normalizedTitleKey(value) || value}`}>
                  {index > 0 ? <span className="detail-inline-separator">/</span> : null}
                  <InlineValue collection={collection} value={value} />
                </span>
              ))}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

function SearchableTitleTable({ titles }: { titles: string[] }) {
  if (titles.length === 0) return null

  return (
    <div className="detail-title-table-wrap">
      <h3>可搜索作品名</h3>
      <table className="detail-title-table">
        <tbody>
          {titles.map((title, index) => (
            <tr key={`${index}-${normalizedTitleKey(title)}`}>
              <th scope="row">{index + 1}</th>
              <td>{title}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BasicInfo({ item }: { item: DetailItem }) {
  const extendedItem = item as ExtendedDetailItem
  const searchableTitles = uniqueTitleValues([displayTitle(item), item.title, item.originalTitle, ...(item.localizedTitles || []), ...(item.aliases || []), ...(item.allTitles || [])])
  const fields: Array<[string, string | string[] | boolean | undefined]> = [
    ['作品大类', mediaGroupLabel(extendedItem.mediaGroup)],
    ['作品类型', mediaTypeLabel(extendedItem.mediaType)],
    ['作品形态', workFormatLabel(extendedItem.format)],
    ['日期', extendedItem.firstPublishedLabel || extendedItem.firstPublishedAt],
    ['复核状态', reviewStatusLabel(extendedItem.reviewStatus)],
    ['证据强度', evidenceStrengthLabel(extendedItem.evidenceStrength)],
    ['机构类型', organizationTypeLabel(extendedItem.organizationType)],
    ['证据类型', evidenceTypeLabel(extendedItem.evidenceType)],
    ['截图时间', extendedItem.capturedAt],
    ['关联作品', extendedItem.relatedWorks],
    ['关联创作者', extendedItem.relatedCreators],
    ['关联机构', extendedItem.relatedOrganizations],
    ['创作者', item.creators],
    ['相关机构', extendedItem.organizations],
    ['标签', item.tags],
    ['注意点', item.warnings],
    ['相关名词', item.relatedTerms],
    ['相关注意点', item.relatedWarnings],
    ['相关标签', item.relatedTags],
    ['相关作品', item.examples],
    ['状态', item.status],
  ]

  if (searchableTitles.length === 0 && visibleFieldsOf(fields).length === 0) return null

  return (
    <section className="detail-card">
      <h2>基础信息</h2>
      <SearchableTitleTable titles={searchableTitles} />
      <FieldList fields={fields} />
    </section>
  )
}

function sourceName(source?: string) {
  const value = String(source || '').trim()
  if (!value) return ''
  if (value.toLowerCase() === 'bangumi') return 'Bangumi'
  if (value.toLowerCase() === 'anilist') return 'AniList'
  if (value.toLowerCase() === 'vndb') return 'VNDB'
  if (value.toLowerCase() === 'steam') return 'Steam'
  if (value.toLowerCase() === 'yurizukan') return 'Yurizukan'
  if (value.toLowerCase() === 'wikidata') return 'Wikidata'
  return value
}

function hostnameLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./u, '')
  } catch {
    return url
  }
}

function allSourceLinks(item: DetailItem) {
  const rows: DetailSourceLink[] = []
  for (const link of item.sourceLinks || []) if (link.url) rows.push({ label: link.label || hostnameLabel(link.url), url: link.url })
  for (const source of item.candidateSources || []) if (source.url) rows.push({ label: [sourceName(source.source), source.label, source.externalId].filter(Boolean).join(' / ') || hostnameLabel(source.url), url: source.url })
  const seen = new Set<string>()
  return rows.filter((link) => {
    const key = String(link.url || '').trim().replace(/\/+$/u, '')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function SourceLinks({ item }: { item: DetailItem }) {
  const links = allSourceLinks(item)
  const externalIds = Object.entries(item.externalIds || {}).filter(([, value]) => value)
  const candidateSources = (item.candidateSources || []).filter((source) => source.source || source.label || source.externalId || source.url)

  if (links.length === 0 && externalIds.length === 0 && candidateSources.length === 0) return null

  return (
    <section className="detail-card" id="public-sources">
      <h2>公开来源</h2>
      <FieldList
        fields={[
          ['外部 ID', externalIds.map(([key, value]) => `${key}: ${value}`)],
          ['候选来源', candidateSources.map((source) => [sourceName(source.source), source.label, source.externalId].filter(Boolean).join(' / '))],
        ]}
      />
      {links.length > 0 ? (
        <ul className="source-links">
          {links.map((link, index) => (
            <li key={`${index}-${link.url}`}>
              <a href={link.url} rel="noreferrer" target="_blank">
                {link.label || link.url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
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

function EvidenceImage({ image, title }: { image?: DetailCoverImage; title: string }) {
  if (image?.url) {
    return (
      <figure className="evidence-image">
        <img alt={image.alt || `${title}证据截图`} src={image.url} />
      </figure>
    )
  }

  return (
    <figure className="evidence-image evidence-image-placeholder" aria-label="暂无证据截图">
      <span>暂无截图</span>
    </figure>
  )
}

function DetailCallouts({ item, showImages }: { item: DetailItem; showImages: boolean }) {
  const callouts = ((item as ExtendedDetailItem).callouts || []).filter(Boolean)
  if (callouts.length === 0) return null

  return (
    <section className="detail-callouts" aria-label="图文提示块">
      {callouts.map((callout, index) => (
        <ContentCallout callout={callout} key={callout.id || `${callout.title || 'callout'}-${index}`} showImage={showImages} />
      ))}
    </section>
  )
}

function RelatedEvidence({ evidence, showImages, showPlaceholder }: { evidence: DetailItem[]; showImages: boolean; showPlaceholder: boolean }) {
  if (evidence.length === 0 && !showPlaceholder) return null

  return (
    <section className="detail-card evidence-card-list">
      <h2>材料留存</h2>
      {evidence.length === 0 ? (
        <p className="muted">暂无材料。后续可在证据材料中关联这个条目。</p>
      ) : (
        <div className="evidence-list">
          {evidence.map((item) => {
            const evidenceItem = item as ExtendedDetailItem
            const title = displayTitle(item)
            return (
              <Link className="evidence-item" href={item.url || `/evidence/${item.slug}`} key={item.id}>
                {showImages ? <EvidenceImage image={evidenceItem.image} title={title} /> : null}
                <div>
                  <span>{evidenceTypeLabel(evidenceItem.evidenceType) || '证据材料'}</span>
                  {evidenceItem.evidenceStrength ? <span>{evidenceStrengthLabel(evidenceItem.evidenceStrength)}</span> : null}
                  <strong>{title}</strong>
                  {evidenceItem.description ? <p>{evidenceItem.description}</p> : null}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
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
            <strong>{displayTitle(work)}</strong>
            {work.originalTitle ? <em>{work.originalTitle}</em> : null}
          </Link>
        ))}
      </div>
    </section>
  )
}

function RichTextSections({ item }: { item: DetailItem }) {
  const extendedItem = item as ExtendedDetailItem
  const sections = item.sections || []
  if (sections.length === 0 && !extendedItem.description) {
    if (item.collection === 'creators' || item.collection === 'organizations') return null
    if (item.collection === 'works') {
      return (
        <section className="detail-card">
          <h2>作品简介</h2>
          <p className="muted">作品简介暂未填写。后续可在后台摘要字段补充，用于搜索和推荐。</p>
        </section>
      )
    }
    return null
  }

  return (
    <>
      {extendedItem.description ? (
        <section className="detail-card">
          <h2>说明</h2>
          <p className="muted">{extendedItem.description}</p>
        </section>
      ) : null}
      {sections.map((section) => (
        <section className="detail-card" key={section.key}>
          <h2>{item.collection === 'works' && section.key === 'summary' ? '作品简介' : section.label}</h2>
          <RichTextRenderer content={section.content} fallback={section.plainText} />
        </section>
      ))}
    </>
  )
}

export default function DetailIndexDetail({ item, relatedWorks = [], relatedEvidence = [] }: { item: DetailItem; relatedWorks?: DetailItem[]; relatedEvidence?: DetailItem[] }) {
  const extendedItem = item as ExtendedDetailItem
  const rank = item.collection === 'works' ? displayRank(item.rank) : ''
  const mediaGroup = item.collection === 'works' ? mediaGroupLabel(extendedItem.mediaGroup) : ''
  const mediaType = item.collection === 'works' ? mediaTypeLabel(extendedItem.mediaType) : ''
  const workFormat = item.collection === 'works' ? workFormatLabel(extendedItem.format) : ''
  const organizationType = organizationTypeLabel(extendedItem.organizationType)
  const evidenceType = evidenceTypeLabel(extendedItem.evidenceType)
  const reviewStatus = reviewStatusLabel(extendedItem.reviewStatus)
  const evidenceStrength = evidenceStrengthLabel(extendedItem.evidenceStrength)
  const showEvidencePlaceholder = ['works', 'creators', 'organizations'].includes(item.collection)
  const title = displayTitle(item)
  const showImages = publicContentImagesEnabled()

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
          {showImages && item.collection === 'works' ? <WorkCover cover={item.cover} title={title} /> : null}
          {showImages && item.collection === 'evidence' ? <EvidenceImage image={extendedItem.image} title={title} /> : null}
          <div>
            <p className="eyebrow">{collectionLabel(item.collection)}</p>
            <h1>{title}</h1>
            <div className="detail-chips">
              <AssessmentOriginBadge item={item} />
              {rank ? <span>{rank}</span> : null}
              {mediaGroup ? <span>{mediaGroup}</span> : null}
              {mediaType && mediaType !== mediaGroup ? <span>{mediaType}</span> : null}
              {workFormat && workFormat !== mediaType ? <span>{workFormat}</span> : null}
              {reviewStatus ? <span>{reviewStatus}</span> : null}
              {evidenceStrength ? <span>{evidenceStrength}</span> : null}
              {organizationType ? <span>{organizationType}</span> : null}
              {evidenceType ? <span>{evidenceType}</span> : null}
              {item.category ? <span>{item.category}</span> : null}
              {item.hasEvidence ? <span>有证据材料</span> : null}
            </div>
          </div>
        </div>
      </section>

      <WorkAssessmentTrustCard item={item} />
      <BasicInfo item={item} />
      <WorkRiskMatrixCard item={item} />
      <WorkListControl item={item} />
      <DetailCallouts item={item} showImages={showImages} />
      <RelatedWorks works={relatedWorks} />
      <RichTextSections item={item} />
      <RelatedEvidence evidence={relatedEvidence} showImages={showImages} showPlaceholder={showEvidencePlaceholder} />
      <SourceLinks item={item} />
      <CommentBlock item={item} />
    </main>
  )
}
