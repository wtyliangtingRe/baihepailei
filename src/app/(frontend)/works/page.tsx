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
  compactCredits,
  gradeLabel,
  mediaGroupLabels,
  mediaLabel,
  publicStatusLabels,
  ratingClassEntries,
  ratingLead,
} from '@/lib/radar/publicPresentation'

import { canonicalContentUrl } from '../_lib/content-identity'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function pageHref(input: {
  q: string
  grade: string
  status: string
  media: string
  page: number
  perPage: number
}): string {
  const params = new URLSearchParams()
  if (input.q) params.set('q', input.q)
  if (input.grade) params.set('grade', input.grade)
  if (input.status) params.set('status', input.status)
  if (input.media) params.set('media', input.media)
  if (input.page > 1) params.set('page', String(input.page))
  if (input.perPage !== 30) params.set('perPage', String(input.perPage))
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
  const requestedPerPage = positiveInteger(first(params.perPage), 30)
  const perPage = [30, 60, 100].includes(requestedPerPage) ? requestedPerPage : 30
  const page = Math.min(positiveInteger(first(params.page), 1), 10_000)
  const result = getPublicWorkList({
    query: q,
    grade,
    status,
    media,
    limit: perPage,
    offset: (page - 1) * perPage,
  })
  const totalPages = Math.max(1, Math.ceil(result.total / perPage))

  if (result.total > 0 && page > totalPages) {
    redirect(pageHref({ q, grade, status, media, page: totalPages, perPage }))
  }

  const paginationInput = { q, grade, status, media, perPage }

  return (
    <main className="page collection-page release-works-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">作品资料库</p>
        <h1>找作品，也先看清雷点。</h1>
        <p>
          可按作品名、作者、制作机构或反馈编号检索。列表优先展示作品类型、当前等级与具体警示；
          没有细分依据的条目会如实标出，不拿内部身份字段占用阅读位置。
        </p>
        <form action="/works" className="works-filter-panel release-filter-panel">
          <div className="works-filter-grid release-filter-grid">
            <label>
              <span>作品、作者、机构或 Work ID</span>
              <input defaultValue={q} name="q" placeholder="例如：终将成为你、仲谷鳰、Work 4974" type="search" />
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
              <span>每页</span>
              <select defaultValue={String(perPage)} name="perPage">
                <option value="30">30</option>
                <option value="60">60</option>
                <option value="100">100</option>
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
          <span>第 {page} / {totalPages} 页</span>
        </div>
      </section>

      {result.items.length ? (
        <section className="release-work-list">
          {result.items.map((work) => {
            const classes = ratingClassEntries(work.rating)
            const credits = workCredits(work)
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
                    <span>反馈编号 Work {work.workId}</span>
                    {work.rating.state !== 'rated' ? <span>{publicStatusLabels[work.rating.state]}</span> : null}
                  </div>
                  <h2><Link href={canonicalContentUrl('works', work.workId)}>{work.title}</Link></h2>
                  {credits ? <p className="release-credit-line">{credits}</p> : null}
                  <p className="result-text">{ratingLead(work.rating)}</p>
                  <div className="release-warning-row" aria-label="评级依据与警示">
                    {classes.slice(0, 3).map(({ code, definition }) => (
                      <span className={`release-warning-chip warning-grade-${definition.grade}`} key={code}>
                        {definition.label}
                      </span>
                    ))}
                    {work.rating.uncertaintyKind ? <span className="release-warning-chip warning-data">具体雷点未确认</span> : null}
                    {work.rating.needsMoreResearch ? <span className="release-warning-chip warning-data">资料仍待补充</span> : null}
                    {work.rating.state === 'rated' && !classes.length && !work.rating.uncertaintyKind ? (
                      <span className="release-warning-chip warning-data">细分依据待补录</span>
                    ) : null}
                  </div>
                  <div className="release-work-footer">
                    <span>
                      {work.firstPublished ? `首发 ${work.firstPublished.slice(0, 10)}` : null}
                      {work.summary ? (work.firstPublished ? ' · 有来源摘要' : '有来源摘要') : null}
                      {!work.firstPublished && !work.summary ? '作品资料仍待补充' : null}
                    </span>
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
          <p>试试清除评级、类型或进度筛选，或者直接输入作品名与 Work ID。</p>
        </section>
      )}

      <nav className="collection-actions release-pagination" aria-label="作品分页">
        {page > 1 ? (
          <Link className="back-link" href={pageHref({ ...paginationInput, page: page - 1 })}>上一页</Link>
        ) : <span>上一页</span>}
        <span>第 {page} / {totalPages} 页</span>
        {page < totalPages ? (
          <Link className="back-link" href={pageHref({ ...paginationInput, page: page + 1 })}>下一页</Link>
        ) : <span>下一页</span>}
      </nav>
    </main>
  )
}

