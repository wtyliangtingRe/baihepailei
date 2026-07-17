import Link from 'next/link'

import { publicContentImagesEnabled } from '@/lib/deploymentProfile'

import type { DetailCandidateSource, DetailCoverImage, DetailItem, DetailSourceLink } from '../_lib/detail-index'
import type { SearchItem } from '../_lib/search-index'
import AssessmentOriginBadge from './AssessmentOriginBadge'
import CommentBlock from './CommentBlock'
import WorkAssessmentTrustCard from './WorkAssessmentTrustCard'
import WorkListControl from './WorkListControl'
import WorkRiskMatrixCard from './WorkRiskMatrixCard'

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
  if (value === 'adult') return '限制展示'
  if (value === 'restricted') return '限制展示'
  return ''
}

function advisoryLabel(value: string) {
  return advisoryLabels[value] || value
}

function cleanLine(value?: string) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ')
}

function linesOf(text?: string) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
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

function displayTitle(item: SearchItem) {
  const candidates = uniqueTitleValues([...(item.localizedTitles || []), item.title, item.originalTitle, ...(item.localizedNames || []), ...(item.aliases || [])])
  return candidates.find(isChineseTitle) || candidates.find(isJapaneseTitle) || candidates.find(isEnglishTitle) || candidates[0] || item.title
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

function SearchableTitleTable({ titles }: { titles: string[] }) {
  if (titles.length === 0) return null

  return (
    <div className="detail-title-table-wrap">
      <h3>可搜索作品名</h3>
      <table className="detail-title-table">
        <tbody>
          {titles.map((title, index) => (
            <tr key={`${title}-${index}`}>
              <th scope="row">{index + 1}</th>
              <td>{title}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BasicInfo({ item }: { item: SearchItem }) {
  const searchableTitles = uniqueTitleValues([displayTitle(item), item.title, item.originalTitle, ...(item.localizedTitles || []), ...(item.localizedNames || []), ...(item.aliases || [])])
  const fields: Array<[string, string | string[] | boolean | undefined]> = [
    ['作品大类', mediaGroupLabel(item.mediaGroup)],
    ['作品类型', mediaTypeLabel(item.mediaType)],
    ['作品形态', workFormatLabel(item.format)],
    ['日期', item.firstPublishedLabel],
    ['复核状态', reviewStatusLabel(item.reviewStatus)],
    ['证据强度', evidenceStrengthLabel(item.evidenceStrength)],
    ['内容标记', contentVisibilityLabel(item.contentVisibility)],
    ['内容提示', item.contentAdvisories?.map(advisoryLabel)],
    ['机构类型', organizationTypeLabel(item.organizationType)],
    ['证据类型', evidenceTypeLabel(item.evidenceType)],
    ['创作者', item.creators],
    ['相关机构', item.organizations],
    ['标签', item.tags],
    ['注意点', item.warnings],
    ['相关名词', item.relatedTerms],
    ['相关注意点', item.relatedWarnings],
    ['关联作品', item.relatedWorks],
    ['关联创作者', item.relatedCreators],
    ['关联机构', item.relatedOrganizations],
    ['状态', (item as { status?: string }).status],
  ]

  return (
    <section className="detail-card">
      <h2>基础信息</h2>
      <SearchableTitleTable titles={searchableTitles} />
      {visibleFieldsOf(fields).length > 0 ? <FieldList fields={fields} /> : <p className="muted">基础信息暂未补全。后续可在后台继续完善。</p>}
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
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function inferFallbackSources(item: SearchItem) {
  const lines = linesOf(item.searchText)
  const sourceLinks: DetailSourceLink[] = []
  const candidateSources: DetailCandidateSource[] = []
  const externalIds: Record<string, string> = {}

  const bangumiId = item.searchText.match(/(?:bangumiSubjectId|Bangumi)[:：]\s*(\d+)/i)?.[1]
  if (bangumiId) {
    externalIds.bangumiSubjectId = bangumiId
    candidateSources.push({ source: 'bangumi', label: 'Bangumi', externalId: bangumiId, url: `https://bgm.tv/subject/${bangumiId}` })
    sourceLinks.push({ label: 'Bangumi', url: `https://bgm.tv/subject/${bangumiId}` })
  }

  for (const [index, line] of lines.entries()) {
    if (!/^https?:\/\//i.test(line)) continue
    const previous = cleanLine(lines[index - 1])
    const label = previous && !/^https?:\/\//i.test(previous) && previous.length <= 40 ? previous : hostnameLabel(line)
    if (sourceLinks.some((link) => link.url === line)) continue
    sourceLinks.push({ label, url: line })
  }

  return { sourceLinks, candidateSources, externalIds }
}

function allSourceLinks(item: SearchItem) {
  const inferred = inferFallbackSources(item)
  const rows: DetailSourceLink[] = []
  for (const link of inferred.sourceLinks) if (link.url) rows.push({ label: link.label || hostnameLabel(link.url), url: link.url })
  for (const source of inferred.candidateSources) if (source.url) rows.push({ label: [sourceName(source.source), source.label, source.externalId].filter(Boolean).join(' / ') || hostnameLabel(source.url), url: source.url })
  const seen = new Set<string>()
  return rows.filter((link) => {
    const key = String(link.url || '').trim().replace(/\/+$/u, '')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function SourceLinks({ item }: { item: SearchItem }) {
  const inferred = inferFallbackSources(item)
  const sourceLinks = allSourceLinks(item)
  const candidateSources = inferred.candidateSources
  const externalIdRows = Object.entries(inferred.externalIds).filter(([, value]) => value)

  return (
    <section className="detail-card" id="public-sources">
      <h2>公开来源</h2>
      {sourceLinks.length || candidateSources.length || externalIdRows.length ? (
        <>
          <FieldList
            fields={[
              ['外部 ID', externalIdRows.map(([key, value]) => `${key}: ${value}`)],
              ['候选来源', candidateSources.map((source) => [sourceName(source.source), source.label, source.externalId].filter(Boolean).join(' / '))],
            ]}
          />
          {sourceLinks.length > 0 ? (
            <ul className="source-links">
              {sourceLinks.map((link) => (
                <li key={link.url}>
                  <a href={link.url} rel="noreferrer" target="_blank">
                    {link.label || link.url}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="muted">暂无公开来源。后续可补充来源链接或候选来源。</p>
      )}
    </section>
  )
}

function WorkIntro() {
  return (
    <section className="detail-card">
      <h2>作品简介</h2>
      <p className="muted">作品简介暂未填写。后续可在后台摘要字段补充，用于搜索和推荐。</p>
    </section>
  )
}

function RelatedEvidencePlaceholder({ collection }: { collection: string }) {
  if (!['works', 'creators', 'organizations'].includes(collection)) return null

  return (
    <section className="detail-card evidence-card-list">
      <h2>材料留存</h2>
      <p className="muted">暂无材料。后续可在证据材料中关联这个条目。</p>
    </section>
  )
}

function toDetailItem(item: SearchItem): DetailItem {
  const inferred = inferFallbackSources(item)
  return {
    ...item,
    title: displayTitle(item),
    allTitles: uniqueTitleValues([displayTitle(item), item.title, item.originalTitle, ...(item.localizedTitles || []), ...(item.localizedNames || []), ...(item.aliases || [])]),
    sections: [],
    sourceLinks: inferred.sourceLinks,
    candidateSources: inferred.candidateSources,
    externalIds: inferred.externalIds,
  }
}

export default function SearchIndexDetail({ item }: { item: SearchItem }) {
  const detailLikeItem = toDetailItem(item)
  const rank = displayRank(item.rank)
  const mediaGroup = mediaGroupLabel(item.mediaGroup)
  const mediaType = mediaTypeLabel(item.mediaType)
  const workFormat = workFormatLabel(item.format)
  const organizationType = organizationTypeLabel(item.organizationType)
  const evidenceType = evidenceTypeLabel(item.evidenceType)
  const reviewStatus = reviewStatusLabel(item.reviewStatus)
  const evidenceStrength = evidenceStrengthLabel(item.evidenceStrength)
  const contentVisibility = contentVisibilityLabel(item.contentVisibility)
  const title = displayTitle(item)
  const showImages = publicContentImagesEnabled()

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
        <div className="detail-hero-layout">
          {showImages && item.collection === 'works' ? <WorkCover cover={item.cover} title={title} /> : null}
          <div>
            <p className="eyebrow">{collectionLabel(item.collection)}</p>
            <h1>{title}</h1>
            {contentVisibility ? <p className="content-visibility-note">此条目标记为「{contentVisibility}」。普通模式下不会出现在列表和搜索结果中。</p> : null}
            <div className="detail-chips">
              <AssessmentOriginBadge item={item} />
              {rank ? <span>{rank}</span> : null}
              {mediaGroup ? <span>{mediaGroup}</span> : null}
              {mediaType && mediaType !== mediaGroup ? <span>{mediaType}</span> : null}
              {workFormat && workFormat !== mediaType ? <span>{workFormat}</span> : null}
              {reviewStatus ? <span>{reviewStatus}</span> : null}
              {evidenceStrength ? <span>{evidenceStrength}</span> : null}
              {contentVisibility ? <span>{contentVisibility}</span> : null}
              {organizationType ? <span>{organizationType}</span> : null}
              {evidenceType ? <span>{evidenceType}</span> : null}
              {item.category ? <span>{item.category}</span> : null}
              {item.hasEvidence ? <span>有证据材料</span> : null}
            </div>
          </div>
        </div>
      </section>

      <WorkAssessmentTrustCard item={detailLikeItem} />
      <BasicInfo item={item} />
      <WorkRiskMatrixCard item={detailLikeItem} />
      <WorkListControl item={detailLikeItem} />
      {item.collection === 'works' ? <WorkIntro /> : null}
      <RelatedEvidencePlaceholder collection={item.collection} />
      <SourceLinks item={item} />
      <CommentBlock item={detailLikeItem} />
    </main>
  )
}
