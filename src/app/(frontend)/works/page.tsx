import Link from 'next/link'
import { redirect } from 'next/navigation'

import {
  getPublicWorkList,
  PUBLIC_GRADES,
  PUBLIC_RATING_STATES,
  type PublicGrade,
  type PublicRatingState,
  type PublicWorkRecord,
} from '@/lib/publicRelease'

import { canonicalContentUrl } from '../_lib/content-identity'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const statusLabels: Record<PublicRatingState, string> = {
  rated: '已有评级',
  research_record_only: '仅资料记录',
  conflict: '评级冲突',
  blocked: '身份 / 数据阻断',
  research_required: '待专项研究',
  not_assessed: '尚未评估',
}

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
  page: number
  perPage: number
}): string {
  const params = new URLSearchParams()
  if (input.q) params.set('q', input.q)
  if (input.grade) params.set('grade', input.grade)
  if (input.status) params.set('status', input.status)
  if (input.page > 1) params.set('page', String(input.page))
  if (input.perPage !== 30) params.set('perPage', String(input.perPage))
  const query = params.toString()
  return query ? `/works?${query}` : '/works'
}

function identityLabel(state: PublicWorkRecord['identity']['state']): string {
  if (state === 'exact') return '精确身份'
  if (state === 'repair_required') return '身份待修复'
  return '部分身份'
}

function ratingDescription(work: PublicWorkRecord): string {
  if (work.rating.state !== 'rated') return statusLabels[work.rating.state]
  if (work.rating.class === 'D-UNCLEAR') return '证据不足型 D · 当前资料尚不能建立明确百合关系'
  if (
    work.rating.bestGrade &&
    work.rating.worstGrade &&
    work.rating.bestGrade !== work.rating.worstGrade
  ) {
    return `当前核心 ${work.rating.grade} · 作者结论范围 ${work.rating.bestGrade}–${work.rating.worstGrade}`
  }
  return work.rating.needsMoreResearch ? '已有评级 · 仍需补证' : '已有稳定评级'
}

export default async function WorksPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const q = first(params.q).trim().slice(0, 200)
  const gradeRaw = first(params.grade).toUpperCase()
  const grade = PUBLIC_GRADES.includes(gradeRaw as PublicGrade) ? gradeRaw : ''
  const statusRaw = first(params.status)
  const status = PUBLIC_RATING_STATES.includes(statusRaw as PublicRatingState) ? statusRaw : ''
  const requestedPerPage = positiveInteger(first(params.perPage), 30)
  const perPage = [30, 60, 100].includes(requestedPerPage) ? requestedPerPage : 30
  const page = Math.min(positiveInteger(first(params.page), 1), 10_000)
  const result = getPublicWorkList({
    query: q,
    grade,
    status,
    limit: perPage,
    offset: (page - 1) * perPage,
  })
  const totalPages = Math.max(1, Math.ceil(result.total / perPage))

  if (result.total > 0 && page > totalPages) {
    redirect(pageHref({ q, grade, status, page: totalPages, perPage }))
  }

  return (
    <main className="page collection-page release-works-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">首发公开快照</p>
        <h1>作品与评级</h1>
        <p>
          搜索当前 {result.total.toLocaleString('zh-CN')} 条匹配记录。默认先展示已评级作品；
          也可以单独查看仅资料、冲突、阻断和尚未评估的作品。
        </p>
        <form action="/works" className="works-filter-panel release-filter-panel">
          <div className="works-filter-grid release-filter-grid">
            <label>
              <span>作品名、Work ID 或外部 ID</span>
              <input defaultValue={q} name="q" placeholder="输入标题、Work 4974、站点 ID…" type="search" />
            </label>
            <label>
              <span>评级</span>
              <select defaultValue={grade} name="grade">
                <option value="">全部等级</option>
                {PUBLIC_GRADES.map((value) => <option key={value} value={value}>{value} 级</option>)}
              </select>
            </label>
            <label>
              <span>数据状态</span>
              <select defaultValue={status} name="status">
                <option value="">全部状态</option>
                {PUBLIC_RATING_STATES.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
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
          {result.items.map((work) => (
            <article className="release-work-card" key={work.workId}>
              <div className="release-work-rating">
                {work.rating.grade ? (
                  <span className={`rating-chip grade-${work.rating.grade}`}>{work.rating.grade}</span>
                ) : (
                  <span className={`status-symbol status-${work.rating.state}`}>—</span>
                )}
              </div>
              <div className="release-work-body">
                <div className="result-card-header">
                  <p>Work {work.workId}</p>
                  <span>{identityLabel(work.identity.state)}</span>
                  {work.audited ? <span>已审计</span> : <span>目录记录</span>}
                </div>
                <h2><Link href={canonicalContentUrl('works', work.workId)}>{work.title}</Link></h2>
                <p className="result-text">{ratingDescription(work)}</p>
                <div className="release-work-footer">
                  <span>{work.identity.provider} · {work.identity.siteId}</span>
                  <Link className="result-link" href={canonicalContentUrl('works', work.workId)}>查看记录</Link>
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="empty-state small">
          <h2>没有匹配记录</h2>
          <p>试试清除评级或状态筛选，或者直接输入精确 Work ID。</p>
        </section>
      )}

      <nav className="collection-actions release-pagination" aria-label="作品分页">
        {page > 1 ? (
          <Link className="back-link" href={pageHref({ q, grade, status, page: page - 1, perPage })}>上一页</Link>
        ) : <span>上一页</span>}
        <span>第 {page} / {totalPages} 页</span>
        {page < totalPages ? (
          <Link className="back-link" href={pageHref({ q, grade, status, page: page + 1, perPage })}>下一页</Link>
        ) : <span>下一页</span>}
      </nav>
    </main>
  )
}

