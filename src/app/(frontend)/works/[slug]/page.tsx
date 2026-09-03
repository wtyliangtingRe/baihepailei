import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getPublicWorkById } from '@/lib/publicRelease'
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

import { recordIdFromContentRoute } from '../../_lib/content-identity'

export const dynamic = 'force-dynamic'

function feedbackHref(workId: string, title: string): string {
  const params = new URLSearchParams({ workId, title })
  return `/feedback?${params.toString()}`
}

function likelyEnglish(value: string): boolean {
  const latin = (value.match(/[A-Za-z]/g) || []).length
  return latin > Math.max(20, value.length * 0.35)
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

  const rating = work.rating
  const classes = ratingClassEntries(rating)
  const range = rangeLabel(rating)
  const hasBasicMetadata = Boolean(
    work.firstPublished || work.aliases.length || work.creators.length || work.organizations.length,
  )
  const sources = [...work.sources]
  if (rating.evidenceUrl && !sources.some((source) => source.url === rating.evidenceUrl)) {
    sources.unshift({ title: '评级依据页面', url: rating.evidenceUrl })
  }

  return (
    <main className="page collection-page release-detail-page">
      <section className="release-detail-hero release-detail-hero-public">
        <div className="release-detail-grade">
          {rating.grade ? (
            <span className={`rating-chip rating-chip-large grade-${rating.grade}`}>{rating.grade}</span>
          ) : (
            <span className={`status-symbol status-symbol-large status-${rating.state}`}>—</span>
          )}
          <small>{rating.grade ? gradeLabel(rating.grade) : publicStatusLabels[rating.state]}</small>
        </div>
        <div className="release-detail-heading">
          <p className="eyebrow">
            {mediaLabel(work.media.group, work.media.type)} · 反馈编号 Work {work.workId}
          </p>
          <h1>{work.title}</h1>
          {work.aliases.length ? <p className="release-aliases">又名：{work.aliases.join('、')}</p> : null}
          <p className="release-detail-lead">{ratingLead(rating)}</p>
          <div className="release-warning-row" aria-label="评级依据与警示">
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
                : '现存公开权威没有保留可安全复用的细分类；本站不会用旧标签或模型猜测补上。'}
            </p>
          </div>
        ) : null}

        <dl className="release-detail-list release-rating-facts">
          <div><dt>评级状态</dt><dd>{publicStatusLabels[rating.state]}</dd></div>
          {rating.grade ? <div><dt>核心等级</dt><dd>{rating.grade} · {gradeLabel(rating.grade)}</dd></div> : null}
          {range ? <div><dt>结论范围</dt><dd>{range}</dd></div> : null}
          {rating.grade ? <div><dt>资料把握</dt><dd>{confidenceLabel(rating.confidence)}</dd></div> : null}
          <div><dt>仍需补充</dt><dd>{rating.needsMoreResearch ? '是' : '否'}</dd></div>
        </dl>

        {rating.reasoningSummary ? (
          <div className="release-reasoning">
            <strong>研究结论摘要</strong>
            <p lang={likelyEnglish(rating.reasoningSummary) ? 'en' : 'zh-CN'}>{rating.reasoningSummary}</p>
            {likelyEnglish(rating.reasoningSummary) ? (
              <small>此段保留现有权威资料的原文，避免在翻译中改变结论。</small>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="release-detail-grid release-public-info-grid">
        <section className="detail-card">
          <p className="eyebrow">作品基本资料</p>
          <h2>作品信息</h2>
          <dl className="release-detail-list">
            <div><dt>作品类型</dt><dd>{mediaLabel(work.media.group, work.media.type)}</dd></div>
            {work.firstPublished ? <div><dt>首次发行</dt><dd>{work.firstPublished}</dd></div> : null}
            {work.aliases.length ? <div><dt>别名 / 译名</dt><dd>{work.aliases.join('、')}</dd></div> : null}
            <div><dt>反馈编号</dt><dd>Work {work.workId}</dd></div>
          </dl>
          {!hasBasicMetadata ? (
            <p className="release-caution">
              当前快照只恢复了作品类型，作者、机构、日期等基本资料仍待补齐。
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
                      <li key={`${credit.role}-${credit.name}`}>
                        {credit.sourceUrl ? <a href={credit.sourceUrl} rel="noreferrer" target="_blank">{credit.name}</a> : credit.name}
                        <span>{credit.role}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {work.organizations.length ? (
                <section>
                  <h3>制作 / 出版机构</h3>
                  <ul>
                    {work.organizations.map((credit) => (
                      <li key={`${credit.role}-${credit.name}`}>
                        {credit.sourceUrl ? <a href={credit.sourceUrl} rel="noreferrer" target="_blank">{credit.name}</a> : credit.name}
                        <span>{credit.role}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="release-missing-detail compact">
              <strong>现有资料尚未结构化作者或机构</strong>
              <p>字段保留在这里，后续只从可核验来源按精确作品补充。</p>
            </div>
          )}
        </section>
      </div>

      <section className="detail-card release-summary-card">
        <p className="eyebrow">作品介绍</p>
        <h2>{work.summary ? '来源摘要' : '简介待补充'}</h2>
        {work.summary ? (
          <>
            <p className="release-source-summary">{work.summary.text}</p>
            {work.summary.sourceUrl ? (
              <a className="back-link" href={work.summary.sourceUrl} rel="noreferrer" target="_blank">查看摘要来源 ↗</a>
            ) : null}
          </>
        ) : (
          <p className="muted">当前可复用资料中还没有与本 Work 精确绑定的作品简介。</p>
        )}
      </section>

      <section className="detail-card release-sources-card">
        <div className="release-section-heading release-section-heading-top">
          <div>
            <p className="eyebrow">可核验资料</p>
            <h2>资料来源</h2>
          </div>
          <span>{sources.length} 条</span>
        </div>
        {sources.length ? (
          <ul className="release-source-list">
            {sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} rel="noreferrer" target="_blank">
                  <span>{source.title}</span>
                  <small>{source.tier ? `资料层级 ${source.tier} · ` : ''}打开来源 ↗</small>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">当前公开快照没有可直接展示的来源链接；这不代表资料不存在，只表示尚未整理到公开资料层。</p>
        )}
      </section>

      <section className="release-snapshot-note release-snapshot-note-public">
        <div>
          <p className="eyebrow">资料边界</p>
          <h2>不知道的，继续标成不知道。</h2>
        </div>
        <p>
          页面只展示能按 Work ID 精确绑定的当前资料。缺少作者、简介或细分类时保持空缺，
          不使用标题相似度，也不把已退役评级重新包装成现行结论。
        </p>
        <Link className="result-link" href={feedbackHref(work.workId, work.title)}>为这部作品补充资料</Link>
      </section>
    </main>
  )
}
