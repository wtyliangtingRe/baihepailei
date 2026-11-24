import Link from 'next/link'
import { redirect } from 'next/navigation'

import {
  getPublicWorkList,
  PUBLIC_GRADES,
  PUBLIC_MEDIA_GROUPS,
  PUBLIC_RATING_STATES,
  type PublicGrade,
  type PublicMediaGroup,
  type PublicRatingState,
  type PublicWorkRecord,
} from '@/lib/publicRelease'
import {
  chineseEditionTitle,
  compactCredits,
  gradeLabel,
  mediaGroupLabels,
  mediaLabel,
  publicStatusLabels,
  ratingClassEntries,
  ratingLead,
} from '@/lib/radar/publicPresentation'

import DisplayAd from '../_components/DisplayAd'
import { canonicalContentUrl } from '../_lib/content-identity'

export const dynamic = 'force-dynamic'

const worksPerPage = 20

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function pageHref(filters: URLSearchParams, page: number): string {
  const params = new URLSearchParams(filters)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/works?${query}` : '/works'
}

function workCredits(work: PublicWorkRecord): string {
  if (work.creators.length) return compactCredits(work.creators)
  if (work.organizations.length) return compactCredits(work.organizations)
  return ''
}

export default async function WorksPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const q = first(params.q).trim().slice(0, 200)
  const gradeRaw = first(params.grade).toUpperCase()
  const grade = PUBLIC_GRADES.includes(gradeRaw as PublicGrade) ? gradeRaw : ''
  const statusRaw = first(params.status)
  const status = PUBLIC_RATING_STATES.includes(statusRaw as PublicRatingState) ? statusRaw : ''
  const mediaRaw = first(params.media)
  const media = PUBLIC_MEDIA_GROUPS.includes(mediaRaw as PublicMediaGroup) ? mediaRaw : ''
  const rawSource = first(params.source)
  const source = rawSource === 'official' || rawSource === 'community' ? rawSource : ''
  const rawPage = first(params.page)
  const page = /^\d+$/.test(rawPage) ? Math.max(1, Math.min(Number(rawPage), 10_000)) : 1
  const filters = Object.entries({ q, grade, status, source, media }).filter(([, value]) => value)
  const paginationParams = new URLSearchParams(filters)
  const result = getPublicWorkList({
    query: q,
    source,
    grade,
    status,
    media,
    limit: worksPerPage,
    offset: (page - 1) * worksPerPage,
  })
  const totalPages = Math.max(1, Math.ceil(result.total / worksPerPage))

  if (page > totalPages) {
    redirect(pageHref(paginationParams, totalPages))
  }

  return (
    <main className="page collection-page release-works-page">
      <section className="page-heading collection-heading">
        <h1>作品资料库</h1>
        <p>
          可按作品名、别名、作者、制作机构或警示关键词检索，并按等级、作品类型、评级来源和进度筛选。
        </p>
        <form action="/works" className="works-filter-panel release-filter-panel">
          <div className="works-filter-grid release-filter-grid">
            <label>
              <span>作品、别名、作者、机构或警示</span>
              <input defaultValue={q} name="q" placeholder="例如：终将成为你、Bloom Into You、NTR" type="search" />
            </label>
            <label>
              <span>评级</span>
              <select defaultValue={grade} name="grade">
                <option value="">全部等级</option>
                {PUBLIC_GRADES.map((value) => (
                  <option key={value} value={value}>{value} · {gradeLabel(value)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>作品类型</span>
              <select defaultValue={media} name="media">
                <option value="">全部类型</option>
                {PUBLIC_MEDIA_GROUPS.filter((value) => value !== 'unknown').map((value) => (
                  <option key={value} value={value}>{mediaGroupLabels[value]}</option>
                ))}
                <option value="unknown">类型待补</option>
              </select>
            </label>
            <label>
              <span>评级进度</span>
              <select defaultValue={status} name="status">
                <option value="">全部进度</option>
                {PUBLIC_RATING_STATES.map((value) => (
                  <option key={value} value={value}>{publicStatusLabels[value]}</option>
                ))}
              </select>
            </label>
            <label>
              <span>评级来源</span>
              <select defaultValue={source} name="source">
                <option value="">全部来源</option>
                <option value="official">官方来源</option>
                <option value="community">社区来源</option>
              </select>
            </label>
          </div>
          <div className="works-filter-actions">
            <button className="result-link" type="submit">应用筛选</button>
            <Link className="back-link" href="/works">清除</Link>
          </div>
        </form>
        <div className="collection-actions">
          <span>{result.total.toLocaleString('zh-CN')} 条结果</span>
          {result.total > 0 && <span>第 {page} / {totalPages} 页</span>}
        </div>
      </section>

      {result.items.length ? (
        <section className="release-work-list">
          {result.items.map((work) => {
            const classes = ratingClassEntries(work.rating)
            const assessment = work.rating.gradeReviewed && work.rating.reviewMethod === 'assessment' ? work.rating.reasoningSummary : undefined
            const credits = workCredits(work)
            const translated = chineseEditionTitle(work.title, work.localizedTitles)
            return (
              <article className="release-work-card release-work-card-public" key={work.workId}>
                <div className="release-work-rating">
                  {work.rating.grade ? (
                    <>
                      <span className={`rating-chip grade-${work.rating.grade}`}>{work.rating.grade}</span>
                      <small>{gradeLabel(work.rating.grade)}</small>
                    </>
                  ) : (
                    <>
                      <span className={`status-symbol status-${work.rating.state}`}>—</span>
                      <small>{publicStatusLabels[work.rating.state]}</small>
                    </>
                  )}
                </div>
                <div className="release-work-body">
                  <div className="result-card-header release-public-meta">
                    <span>{mediaLabel(work.media.group, work.media.type)}</span>
                    {work.rating.state !== 'rated' ? <span>{publicStatusLabels[work.rating.state]}</span> : null}
                  </div>
                  <h2><Link href={canonicalContentUrl('works', work.workId)}>{translated || work.title}</Link></h2>
                  {translated ? <p className="edition-original-title">{work.title}</p> : null}
                  {credits ? <p className="release-credit-line">{credits}</p> : null}
                  {!assessment && <p className="result-text">{ratingLead(work.rating)}</p>}
                  <div className="release-warning-row" aria-label="评级依据与警示">
                    {work.publicTags.slice(0, 2).map((tag) => (
                      <span className="release-warning-chip warning-preference" key={tag.key}>{tag.label}</span>
                    ))}
                    {classes.map(({ code, definition }) => (
                      <span className={`release-warning-chip warning-grade-${definition.grade}`} key={code}>
                        {definition.label}
                      </span>
                    ))}
                    {work.rating.uncertaintyKind ? <span className="release-warning-chip warning-data">具体雷点未确认</span> : null}
                    {work.rating.needsMoreResearch && !work.rating.gradeReviewed ? <span className="release-warning-chip warning-data">资料仍待补充</span> : null}
                    {work.rating.state === 'rated' && !classes.length && !work.rating.uncertaintyKind ? (
                      <span className="release-warning-chip warning-data">细分依据待补录</span>
                    ) : null}
                  </div>
                  {assessment && (
                    <details className="card-assessment-reason">
                      <summary>评级理由<span>含剧透</span></summary>
                      <p>{assessment}</p>
                    </details>
                  )}
                  <div className="release-work-footer">
                    {work.firstPublished && <span>首发 <time dateTime={work.firstPublished}>{work.firstPublishedLabel || work.firstPublished.slice(0, 10)}</time></span>}
                    <Link className="result-link" href={canonicalContentUrl('works', work.workId)}>查看详情</Link>
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      ) : (
        <section className="empty-state small">
          <h2>没有匹配记录</h2>
          <p>试试清除评级、类型或进度筛选，或者输入作品名、别名、作者、制作机构或警示关键词。</p>
        </section>
      )}

      {totalPages > 1 && (
        <nav className="collection-actions release-pagination" aria-label="作品分页">
          {page > 1 ? (
            <Link className="back-link" href={pageHref(paginationParams, page - 1)} rel="prev">上一页</Link>
          ) : <span aria-disabled="true">上一页</span>}
          <span aria-current="page">第 {page} / {totalPages} 页</span>
          {page < totalPages ? (
            <Link className="back-link" href={pageHref(paginationParams, page + 1)} rel="next">下一页</Link>
          ) : <span aria-disabled="true">下一页</span>}
          <form action="/works" className="works-page-jump" method="get">
            {filters.map(([name, value]) => (
              <input key={name} name={name} type="hidden" value={value} />
            ))}
            <label>
              页码
              <input
                key={page}
                defaultValue={page}
                inputMode="numeric"
                max={totalPages}
                min={1}
                name="page"
                required
                step={1}
                type="number"
              />
            </label>
            <button className="back-link" type="submit">跳转</button>
          </form>
        </nav>
      )}
      {result.items.length > 0 && process.env.NEXT_PUBLIC_ADSENSE_ENABLED === 'true' && <DisplayAd />}
    </main>
  )
}
