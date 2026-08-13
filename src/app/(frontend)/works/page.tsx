import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getFormalWorkLineageList } from '@/lib/work-lineage/runtimeRepository'

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

function pageHref(q: string, page: number, perPage: number): string {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (page > 1) params.set('page', String(page))
  if (perPage !== 30) params.set('perPage', String(perPage))
  const query = params.toString()
  return query ? `/works?${query}` : '/works'
}

function identityLabel(state: string): string {
  if (state === 'complete') return '精确外部身份已绑定'
  if (state === 'partial') return '仅正式作品身份'
  return '身份状态未知'
}

export default async function WorksPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const q = first(params.q).trim().slice(0, 200)
  const requestedPerPage = positiveInteger(first(params.perPage), 30)
  const perPage = [30, 60, 100].includes(requestedPerPage) ? requestedPerPage : 30
  const page = Math.min(positiveInteger(first(params.page), 1), 10_000)

  let result: Awaited<ReturnType<typeof getFormalWorkLineageList>> | null = null
  try {
    result = await getFormalWorkLineageList({
      query: q,
      limit: perPage,
      offset: (page - 1) * perPage,
    })
  } catch (error) {
    console.error('Formal WorkLineage list failed', error)
  }

  if (!result) {
    return (
      <main className="page collection-page">
        <section className="empty-state small">
          <h1>正式作品库暂时不可用</h1>
          <p>系统不会回退到旧数据库、旧搜索索引或历史评级。请在新数据库恢复后重试。</p>
        </section>
      </main>
    )
  }

  const totalPages = Math.max(1, Math.ceil(result.total / perPage))
  if (result.total > 0 && page > totalPages) {
    redirect(pageHref(q, totalPages, perPage))
  }

  return (
    <main className="page collection-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">正式导入</p>
        <h1>作品</h1>
        <p>这里仅展示新数据库中的正式 Frozen WorkLineage。历史评级、旧研究提示和参考包不会参与列表、搜索或排序。</p>
        <div className="collection-actions">
          <span>{result.total.toLocaleString('zh-CN')} 条正式作品</span>
          <span>第 {page} / {totalPages} 页</span>
        </div>
        <form action="/works" className="works-filter-panel">
          <div className="works-filter-grid">
            <label>
              <span>作品名或 Work ID</span>
              <input defaultValue={q} name="q" placeholder="精确 Work ID 或标题关键词" type="search" />
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
            <button className="result-link" type="submit">搜索正式作品</button>
            <Link className="back-link" href="/works">清除搜索</Link>
          </div>
        </form>
      </section>

      {result.items.length ? (
        <section className="results-list">
          {result.items.map((item) => (
            <article className="result-card" key={item.workId}>
              <div className="result-card-header">
                <p>Work {item.workId}</p>
                <span>{identityLabel(item.identityState)}</span>
              </div>
              <h2><Link href={canonicalContentUrl('works', item.workId)}>{item.canonicalTitle}</Link></h2>
              <p className="result-text">当前研究与评估状态：{item.currentConclusionState === 'unknown' ? '尚无新流程结论' : item.currentConclusionState}</p>
              <Link className="result-link" href={canonicalContentUrl('works', item.workId)}>查看正式记录</Link>
            </article>
          ))}
        </section>
      ) : (
        <section className="empty-state small">
          <h2>没有匹配的正式作品</h2>
          <p>搜索只读取新正式库中的规范标题与精确 Work ID，不使用旧别名或模糊身份推断。</p>
        </section>
      )}

      <nav className="collection-actions" aria-label="作品分页">
        {page > 1 ? <Link className="back-link" href={pageHref(q, page - 1, perPage)}>上一页</Link> : <span>上一页</span>}
        <span>第 {page} / {totalPages} 页</span>
        {page < totalPages ? <Link className="back-link" href={pageHref(q, page + 1, perPage)}>下一页</Link> : <span>下一页</span>}
      </nav>
    </main>
  )
}
