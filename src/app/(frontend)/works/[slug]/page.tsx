import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'

import { getPublicWorkById } from '@/lib/publicRelease'
import { collectWorkReferences } from '@/lib/publicWorkReferences'
import {
  classTone,
  confidenceLabel,
  gradeLabel,
  gradeSummary,
  mediaLabel,
  publicStatusDescriptions,
  publicStatusLabels,
  rangeLabel,
  ratingClassEntries,
  ratingLead,
  ratingModeLabel,
} from '@/lib/radar/publicPresentation'

import { canonicalContentUrl, recordIdFromContentRoute } from '../../_lib/content-identity'

export const dynamic = 'force-dynamic'

function feedbackHref(workId: string, title: string): string {
  const params = new URLSearchParams({ workId, title })
  return `/feedback?${params.toString()}`
}

function likelyEnglish(value: string): boolean {
  const latin = (value.match(/[A-Za-z]/g) || []).length
  return latin > Math.max(20, value.length * 0.35)
}

function normalizedTitle(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
}

const languageLabels: Record<string, string> = {
  zh: '中文',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁体中文',
  ja: '日文',
  en: '英文',
  ko: '韩文',
}

const localizedTitleKindLabels: Record<string, string> = {
  original: '原名',
  official: '官方名',
  localized: '译名',
  romanized: '罗马字',
  alias: '别名',
}

const publicationPrecisionLabels: Record<string, string> = {
  day: '精确到日',
  month: '精确到月',
  year: '精确到年',
  unknown: '精度待确认',
}

function localizedTitleLabel(language?: string, region?: string, kind?: string): string {
  const languageLabel = language ? languageLabels[language] || language : '其他名称'
  const regionalLabel = region ? `${languageLabel}（${region}）` : languageLabel
  const kindLabel = kind ? localizedTitleKindLabels[kind] || kind : ''
  return kindLabel ? `${regionalLabel} · ${kindLabel}` : regionalLabel
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params
  const workId = recordIdFromContentRoute('works', slug)
  const work = workId ? getPublicWorkById(workId) : null
  if (!work) return {}
  const description = work.rating.grade
    ? `${work.title}：${work.rating.grade} 级（${gradeLabel(work.rating.grade)}）及具体排雷警示。`
    : `${work.title} 的作品资料与评级进度。`
  return { title: work.title, description }
}

export default async function WorkDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const workId = recordIdFromContentRoute('works', slug)
  if (!workId) notFound()
  const work = getPublicWorkById(workId)
  if (!work) notFound()
  if (work.workId !== workId) permanentRedirect(canonicalContentUrl('works', work.workId))

  const rating = work.rating
  const localizedTitleKeys = new Set([
    normalizedTitle(work.title),
    ...work.localizedTitles.map((title) => normalizedTitle(title.title)),
  ])
  const displayAliases = work.aliases.filter((title) => !localizedTitleKeys.has(normalizedTitle(title)))
  const classes = ratingClassEntries(rating)
  const range = rangeLabel(rating)
  const hasBasicMetadata = Boolean(
    work.firstPublished || work.creators.length || work.organizations.length,
  )
  const references = collectWorkReferences(work)
  function referenceMarks(urls: Array<string | undefined>) {
    const numbers = [...new Set(urls.flatMap(url => {
      const reference = references.find(row => row.url === url?.trim())
      return reference ? [reference.number] : []
    }))].sort((a, b) => a - b)
    return numbers.length ? <sup className="work-reference-marks">
      {numbers.map(number => <a key={number} href={`#ref-${number}`} role="doc-noteref" aria-label={`查看注释 ${number}`}>[{number}]</a>)}
    </sup> : null
  }

  return (
    <main className="page collection-page release-detail-page">
      <section className="release-detail-hero release-detail-hero-public">
        <div className="release-detail-visual">
          {work.cover ? (
            <img
              alt={work.cover.alt || `${work.title} 封面`}
              className="release-work-cover"
              height={work.cover.height || 360}
              loading="eager"
              src={work.cover.url}
              width={work.cover.width || 240}
            />
          ) : null}
          <div className="release-detail-grade">
            {rating.grade ? (
              <span className={`rating-chip rating-chip-large grade-${rating.grade}`}>{rating.grade}</span>
            ) : (
              <span className={`status-symbol status-symbol-large status-${rating.state}`}>—</span>
            )}
            <small>{rating.grade ? gradeLabel(rating.grade) : publicStatusLabels[rating.state]}</small>
          </div>
        </div>
        <div className="release-detail-heading">
          <p className="eyebrow">
            {mediaLabel(work.media.group, work.media.type)}
          </p>
          <h1>{work.title}</h1>
          {work.localizedTitles.length || displayAliases.length ? (
            <p className="release-aliases">
              又名：{[
                ...work.localizedTitles.map((title) => title.title),
                ...displayAliases,
              ].filter((title, index, values) => title !== work.title && values.indexOf(title) === index).join('、')}
            </p>
          ) : null}
          <p className="release-detail-lead">{ratingLead(rating)}</p>
          <div className="release-warning-row" aria-label="评级依据与警示">
            {work.publicTags.map((tag) => (
              <span className="release-warning-chip warning-preference" key={tag.key}>{tag.label}</span>
            ))}
            {classes.map(({ code, definition }) => (
              <span className={`release-warning-chip warning-grade-${definition.grade}`} key={code}>
                {definition.label}
              </span>
            ))}
            {rating.uncertaintyKind ? <span className="release-warning-chip warning-data">具体雷点未确认</span> : null}
            {rating.needsMoreResearch ? <span className="release-warning-chip warning-data">资料仍待补充</span> : null}
          </div>
          <div className="collection-actions">
            <Link className="back-link" href="/works">返回作品列表</Link>
            {rating.grade ? <Link className="back-link" href={`/works?grade=${rating.grade}`}>查看同级作品</Link> : null}
            <Link className="back-link" href={feedbackHref(work.workId, work.title)}>补充或纠错</Link>
          </div>
        </div>
      </section>

      {rating.grade === 'E' || rating.grade === 'F' ? (
        <section className={`release-risk-banner risk-grade-${rating.grade}`} role="note">
          <strong>{rating.grade === 'F' ? '高危排雷：建议先读完具体警示' : '重度排雷：可能明显影响观看体验'}</strong>
          <p>{gradeSummary(rating.grade)}</p>
        </section>
      ) : null}

      <section className="detail-card release-title-alias-card" aria-label="译名与别名">
        <p className="eyebrow">名称资料</p>
        <h2>译名与别名</h2>
        {work.localizedTitles.length || displayAliases.length ? (
          <dl className="release-detail-list">
            {work.localizedTitles.map((title) => (
              <div key={`${title.language || 'und'}-${title.region || ''}-${title.kind || ''}-${title.title}`}>
                <dt>{localizedTitleLabel(title.language, title.region, title.kind)}</dt>
                <dd>{title.title}</dd>
              </div>
            ))}
            {displayAliases.length ? (
              <div>
                <dt>其他别名</dt>
                <dd>{displayAliases.join('、')}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <dl className="release-detail-list"><div><dt>当前收录名</dt><dd>{work.title}</dd></div></dl>
        )}
      </section>

      <div className="release-detail-grid release-public-info-grid">
        <section className="detail-card">
          <p className="eyebrow">作品基本资料</p>
          <h2>作品信息</h2>
          <dl className="release-detail-list">
            <div><dt>作品类型</dt><dd>{mediaLabel(work.media.group, work.media.type)}</dd></div>
            {work.media.format ? <div><dt>作品形态</dt><dd>{work.media.format}</dd></div> : null}
            {work.firstPublished || work.firstPublishedLabel ? (
              <div><dt>首次发行</dt><dd>{work.firstPublishedLabel || work.firstPublished}</dd></div>
            ) : null}
            {work.firstPublishedPrecision ? (
              <div><dt>日期精度</dt><dd>{publicationPrecisionLabels[work.firstPublishedPrecision]}</dd></div>
            ) : null}
          </dl>
          {!hasBasicMetadata ? (
            <p className="release-caution">
              发行日期尚待核实。<Link href={feedbackHref(work.workId, work.title)}>补充作品资料</Link>
            </p>
          ) : null}
        </section>

        <section className="detail-card">
          <p className="eyebrow">作者与创作机构</p>
          <h2>创作信息</h2>
          {work.creators.length || work.organizations.length ? (
            <div className="release-credit-groups">
              {work.creators.length ? (
                <section>
                  <h3>作者 / 主创</h3>
                  <ul>
                    {work.creators.map((credit) => (
                      <li key={`${credit.creatorId}-${credit.role}-${credit.name}`}>
                        <div>
                          <Link href={canonicalContentUrl(credit.creatorKind === 'organization' ? 'organizations' : 'creators', credit.creatorId!)}>{credit.name}</Link>
                          {referenceMarks([credit.sourceUrl, ...(credit.sourceUrls || [])])}
                        </div>
                        <span>{credit.role}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {work.organizations.length ? (
                <section>
                  <h3>制作 / 出版方</h3>
                  <ul>
                    {work.organizations.map((credit) => (
                      <li key={`${credit.creatorId}-${credit.role}-${credit.name}`}>
                        <div>
                          <Link href={canonicalContentUrl(credit.creatorKind === 'person' ? 'creators' : 'organizations', credit.creatorId!)}>{credit.name}</Link>
                          {referenceMarks([credit.sourceUrl, ...(credit.sourceUrls || [])])}
                        </div>
                        <span>{credit.role}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="release-missing-detail compact">
              <p>暂未查到可靠的主创资料。<Link href={feedbackHref(work.workId, work.title)}>补充作者或机构</Link></p>
            </div>
          )}
        </section>
      </div>

      <section className="detail-card release-summary-card">
        <p className="eyebrow">作品介绍</p>
        <h2>{work.summary?.kind === 'identity_summary' ? '作品识别信息' : '简短介绍'}</h2>
        {work.summary ? (
          <>
            <p className="release-source-summary">{work.summary.text}{referenceMarks([work.summary.sourceUrl])}</p>
          </>
        ) : (
          <p className="muted">暂缺能准确识别这部作品的简介。<Link href={feedbackHref(work.workId, work.title)}>补充一两句介绍</Link></p>
        )}
      </section>

      <section className="detail-card release-conclusion-card">
        <div className="release-section-heading release-section-heading-top">
          <div>
            <p className="eyebrow">排雷结论</p>
            <h2>{rating.grade ? `${rating.grade} 级 · ${gradeLabel(rating.grade)}` : publicStatusLabels[rating.state]}</h2>
          </div>
          {rating.grade ? <span className={`release-grade-pill grade-outline-${rating.grade}`}>{ratingModeLabel(rating.mode)}</span> : null}
        </div>

        <p className="release-grade-explanation">
          {rating.grade ? gradeSummary(rating.grade) : publicStatusDescriptions[rating.state]}
        </p>

        {work.publicTags.length ? (
          <section className="release-preference-notices" aria-label="独立设定与内容提示">
            <div>
              <p className="eyebrow">独立设定与内容提示</p>
              <h3>这些提示与核心等级分开阅读</h3>
            </div>
            <div className="release-preference-grid">
              {work.publicTags.map((tag) => (
                <article key={tag.key}>
                  <span>{tag.group}</span>
                  <strong>{tag.label}</strong>
                  <p>{tag.description}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {classes.length ? (
          <div className="release-class-grid">
            {classes.map(({ code, definition }) => (
              <article className={`release-class-card class-tone-${classTone(code)}`} key={code}>
                <div>
                  <span>{definition.grade} 级细则</span>
                  <code>{code}</code>
                </div>
                <h3>{definition.label}</h3>
                <p>{definition.summary}</p>
                <details>
                  <summary>查看这条规则的判定边界</summary>
                  <div className="release-rule-boundaries">
                    <section>
                      <strong>需要满足</strong>
                      <ul>{definition.inclusionCriteria.map((item) => <li key={item}>{item}</li>)}</ul>
                    </section>
                    <section>
                      <strong>不应误判为</strong>
                      <ul>{definition.exclusionCriteria.map((item) => <li key={item}>{item}</li>)}</ul>
                    </section>
                  </div>
                </details>
              </article>
            ))}
          </div>
        ) : rating.state === 'rated' ? (
          <div className="release-missing-detail">
            <strong>{rating.uncertaintyKind ? '当前没有确认具体雷点' : '当前只保留了等级结论'}</strong>
            <p>
              {rating.uncertaintyKind
                ? '这是一条资料不足型 D：不能据此推断男性结局、NTR 或其他具体情节。'
                : '具体细分类与评级依据仍待补充。'}
            </p>
          </div>
        ) : null}

        <dl className="release-detail-list release-rating-facts">
          <div><dt>评级状态</dt><dd>{publicStatusLabels[rating.state]}{referenceMarks([rating.evidenceUrl])}</dd></div>
          {rating.grade ? <div><dt>核心等级</dt><dd>{rating.grade} · {gradeLabel(rating.grade)}</dd></div> : null}
          {range ? <div><dt>结论范围</dt><dd>{range}</dd></div> : null}
          {rating.grade ? <div><dt>资料把握</dt><dd>{confidenceLabel(rating.confidence)}</dd></div> : null}
          <div><dt>仍需补充</dt><dd>{rating.needsMoreResearch ? '是' : '否'}</dd></div>
        </dl>

        {rating.reasoningSummary ? (
          <div className="release-reasoning">
            <strong>为什么这样评</strong>
            <p lang={likelyEnglish(rating.reasoningSummary) ? 'en' : 'zh-CN'}>{rating.reasoningSummary}</p>
            {likelyEnglish(rating.reasoningSummary) ? (
              <small>来源原文</small>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="detail-card release-sources-card">
        <div className="release-section-heading release-section-heading-top">
          <div>
            <p className="eyebrow">注释与外部入口</p>
            <h2>资料来源与获取方式</h2>
          </div>
          <span>{references.length} 条</span>
        </div>
        {references.length ? (
          <ol className="work-reference-list" role="doc-endnotes">
            {references.map((reference) => (
              <li id={`ref-${reference.number}`} key={reference.url}>
                <span className="work-reference-number">[{reference.number}]</span>
                <div>
                  <a href={reference.url} rel="noreferrer" target="_blank">{reference.title} ↗</a>
                  <small>{reference.purpose}{reference.tier ? ` · 资料层级 ${reference.tier}` : ''}</small>
                  {reference.usages.length ? <p>{reference.usages.join('；')}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">资料来源链接待整理。</p>
        )}
      </section>

      <section className="release-snapshot-note release-snapshot-note-public">
        <div>
          <p className="eyebrow">补充与纠错</p>
          <h2>发现遗漏或错误？告诉我们。</h2>
        </div>
        <p>
          欢迎补充作品资料、评级依据或报告错误。从这里提交反馈时会自动关联当前作品。
        </p>
        <Link className="result-link" href={feedbackHref(work.workId, work.title)}>为这部作品补充资料</Link>
      </section>
    </main>
  )
}
