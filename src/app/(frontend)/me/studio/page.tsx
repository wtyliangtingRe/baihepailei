import configPromise from '@payload-config'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload, type Where } from 'payload'

import { isEditor } from '@/access/roles'

import { canonicalContentUrl } from '../../_lib/content-identity'

export const dynamic = 'force-dynamic'

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>
type StudioWork = {
  id: string | number
  title?: string
  originalTitle?: string
  slug?: string
  rank?: string
  reviewStatus?: string
  _status?: string
  catalogStatus?: string
  mediaGroup?: string
  mediaType?: string
  format?: string
  humanReviewNote?: string
  updatedAt?: string
}

type StudioStatus = 'active' | 'temporary' | 'archived' | 'all'
type StudioFilters = {
  q: string
  rank: string
  status: StudioStatus
  page: number
  perPage: number
}

const rankOptions = ['all', 'S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'trash', 'unknown']
const statusOptions: StudioStatus[] = ['active', 'temporary', 'archived', 'all']

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function canEdit(user: unknown) {
  return isEditor(user)
}

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback
}

function filtersFrom(params: Record<string, string | string[] | undefined>): StudioFilters {
  const rank = first(params.rank)
  const status = first(params.status) as StudioStatus
  const requestedPerPage = positiveInteger(first(params.perPage), 50)
  return {
    q: first(params.q).trim().slice(0, 160),
    rank: rankOptions.includes(rank) ? rank : 'all',
    status: statusOptions.includes(status) ? status : 'all',
    page: positiveInteger(first(params.page), 1),
    perPage: [20, 50, 100].includes(requestedPerPage) ? requestedPerPage : 50,
  }
}

function studioHref(filters: StudioFilters, overrides: Partial<StudioFilters> = {}) {
  const next = { ...filters, ...overrides }
  const params = new URLSearchParams()
  if (next.q) params.set('q', next.q)
  if (next.rank !== 'all') params.set('rank', next.rank)
  if (next.status !== 'all') params.set('status', next.status)
  if (next.perPage !== 50) params.set('perPage', String(next.perPage))
  if (next.page > 1) params.set('page', String(next.page))
  const query = params.toString()
  return query ? `/me/studio?${query}` : '/me/studio'
}

function safeStudioReturnTo(value: FormDataEntryValue | null, fallback = '/me/studio') {
  const requested = String(value || '')
  return requested === '/me/studio' || requested.startsWith('/me/studio?') ? requested : fallback
}

function whereFor(filters: StudioFilters): Where {
  const and: Where[] = []
  if (filters.q) {
    const or: Where[] = [
      { title: { like: filters.q } },
      { originalTitle: { like: filters.q } },
      { slug: { like: filters.q } },
      { siteId: { like: filters.q } },
      { searchText: { like: filters.q } },
    ]
    if (/^\d+$/u.test(filters.q)) or.push({ id: { equals: filters.q } })
    and.push({ or })
  }
  if (filters.rank !== 'all') and.push({ rank: { equals: filters.rank } })
  if (filters.status !== 'all') and.push({ catalogStatus: { equals: filters.status } })
  return and.length ? { and } : {}
}

function text(value: FormDataEntryValue | null, max = 4000) {
  return String(value || '').trim().slice(0, max)
}

function appendAuditNote(existing: unknown, action: string, reason: string, actorID: string | number | undefined) {
  const previous = String(existing || '').trim()
  const entry = `[${new Date().toISOString()}] ${action}; actor=${actorID || 'unknown'}; reason=${reason}`
  return previous ? `${previous}\n${entry}`.slice(-4000) : entry
}

function withMessage(returnTo: string, key: string, value: string) {
  return `${returnTo}${returnTo.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`
}

async function hideWorkAction(formData: FormData) {
  'use server'
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user || !canEdit(auth.user)) throw new Error('没有隐藏作品的权限。')

  const id = text(formData.get('id'), 40)
  const reason = text(formData.get('reason'), 800)
  const confirmation = text(formData.get('confirmation'), 20)
  const returnTo = safeStudioReturnTo(formData.get('returnTo'))
  if (!id || reason.length < 4 || confirmation !== '隐藏') redirect(withMessage(returnTo, 'studioError', 'hide_confirmation'))

  try {
    const current = await payload.findByID({ collection: 'works', id, depth: 0, draft: false, overrideAccess: true }) as unknown as StudioWork
    await payload.update({
      collection: 'works', id, depth: 0, draft: false, overrideAccess: true,
      context: { firstPartyStudio: true, softHide: true, auditActorID: (auth.user as { id?: string | number }).id },
      data: {
        catalogStatus: 'archived', _status: 'draft', reviewStatus: 'deprecated', isLiteVisible: false, isFullVisible: false,
        humanReviewNote: appendAuditNote(current.humanReviewNote, 'soft-hidden', reason, (auth.user as { id?: string | number }).id),
      },
    })
  } catch (error) {
    console.warn('First-party studio soft hide failed', { id, error })
    redirect(withMessage(returnTo, 'studioError', 'archive_schema'))
  }

  revalidatePath('/me/studio')
  revalidatePath('/works')
  revalidatePath(canonicalContentUrl('works', id))
  redirect(withMessage(returnTo, 'hidden', id))
}

async function restoreWorkAction(formData: FormData) {
  'use server'
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user || !canEdit(auth.user)) throw new Error('没有恢复作品的权限。')

  const id = text(formData.get('id'), 40)
  const returnTo = safeStudioReturnTo(formData.get('returnTo'), '/me/studio?status=archived')
  if (!id) redirect('/me/studio?status=archived&studioError=invalid_action')

  try {
    const current = await payload.findByID({ collection: 'works', id, depth: 0, draft: false, overrideAccess: true }) as unknown as StudioWork
    await payload.update({
      collection: 'works', id, depth: 0, draft: false, overrideAccess: true,
      context: { firstPartyStudio: true, lifecycleStageUpdate: true, restoreSoftHidden: true, auditActorID: (auth.user as { id?: string | number }).id },
      data: {
        catalogStatus: 'temporary', _status: 'published', reviewStatus: 'pending', isLiteVisible: true, isFullVisible: true,
        humanReviewNote: appendAuditNote(current.humanReviewNote, 'restored-as-temporary', '从回收站恢复为公开临时作品，等待重新核验', (auth.user as { id?: string | number }).id),
      },
    })
  } catch (error) {
    console.warn('First-party studio restore failed', { id, error })
    redirect(withMessage(returnTo, 'studioError', 'restore_failed'))
  }

  revalidatePath('/me/studio')
  revalidatePath('/works')
  revalidatePath(canonicalContentUrl('works', id))
  redirect(withMessage(returnTo, 'restored', id))
}

function label(value?: string) {
  if (value === 'AA') return 'S'
  if (value === 'trash') return '垃圾'
  if (!value || value === 'unknown') return '未知'
  if (value === 'active') return '正式作品'
  if (value === 'temporary') return '临时作品'
  if (value === 'archived') return '回收站'
  return value
}

function formatDate(value?: string) {
  if (!value) return '未记录'
  try {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return value
  }
}

async function findStudioPage(payload: Awaited<ReturnType<typeof getPayload>>, filters: StudioFilters) {
  return payload.find({
    collection: 'works', depth: 0, draft: false, limit: filters.perPage, page: filters.page,
    pagination: true, overrideAccess: true, sort: '-updatedAt', where: whereFor(filters),
  })
}

async function countByStatus(payload: Awaited<ReturnType<typeof getPayload>>, status: Exclude<StudioStatus, 'all'>) {
  return payload.find({ collection: 'works', depth: 0, draft: false, limit: 1, page: 1, pagination: true, overrideAccess: true, where: { catalogStatus: { equals: status } } })
}

export default async function ContentStudioPage({ searchParams }: { searchParams: PageSearchParams }) {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent('/me/studio')}`)

  if (!canEdit(auth.user)) {
    return (
      <main className="page review-workbench studio-page">
        <section className="review-hero"><div className="review-hero-copy"><p className="eyebrow">资料库共建</p><h1>提交新作品申请</h1><p className="muted">普通用户填写的新作品仍是待审核申请，不会直接进入 Works。站务采纳并核验资料后，才会创建公开的临时作品。</p></div></section>
        <section className="detail-card"><h2>发现资料库里没有的作品？</h2><p>申请会进入用户提交审核；采纳前不会公开，也不会覆盖现有条目。</p><Link className="review-button review-button-primary" href="/feedback?type=new_work">新建作品申请</Link></section>
      </main>
    )
  }

  const raw = await searchParams
  const filters = filtersFrom(raw)
  const currentHref = studioHref(filters)
  const [result, formalCount, temporaryCount, archivedCount] = await Promise.all([
    findStudioPage(payload, filters),
    countByStatus(payload, 'active'),
    countByStatus(payload, 'temporary'),
    countByStatus(payload, 'archived'),
  ])

  const docs = result.docs as unknown as StudioWork[]
  const totalPages = Math.max(1, result.totalPages || 1)
  const currentPage = Math.min(result.page || filters.page, totalPages)
  const studioError = first(raw.studioError)
  const hidden = first(raw.hidden)
  const restored = first(raw.restored)
  const createdWork = first(raw.createdWork)
  const errorMessage = studioError === 'hide_confirmation'
    ? '隐藏作品需要填写至少 4 个字的理由，并在确认框输入“隐藏”。'
    : studioError === 'archive_schema'
      ? '当前数据库的作品阶段字段尚未完成迁移；作品没有被隐藏。'
      : studioError === 'restore_failed'
        ? '恢复作品失败，原记录没有被改写。请查看开发服务器日志。'
        : studioError
          ? '操作无效或保存失败，原记录没有被改写。'
          : ''

  return (
    <main className="page review-workbench studio-page">
      <section className="review-hero">
        <div className="review-hero-copy"><p className="eyebrow">站内内容管理</p><h1>编辑作品事实与阶段</h1><p className="muted">Works 不再使用面向工作人员的草稿状态。正式作品和临时作品都保持发布；只有回收站会隐藏。AI 评级字段由受控管线维护。</p><div className="review-safety-note">普通用户的新作品在反馈阶段仍是申请草稿；站务采纳后才进入 Works，并以公开的临时作品开始。隐藏作品是可恢复的软删除，不会永久删除记录。</div></div>
        <div className="review-stat-grid"><div className="review-stat"><span>正式作品</span><strong>{formalCount.totalDocs.toLocaleString('zh-CN')}</strong></div><div className="review-stat"><span>临时作品</span><strong>{temporaryCount.totalDocs.toLocaleString('zh-CN')}</strong></div><div className="review-stat"><span>回收站</span><strong>{archivedCount.totalDocs.toLocaleString('zh-CN')}</strong></div></div>
      </section>

      {errorMessage ? <div className="review-action-message review-action-message-error" role="alert">{errorMessage}</div> : null}
      {createdWork ? <div className="review-action-message review-action-message-success" role="status">临时作品 #{createdWork} 已创建并公开。<Link href={`/me/studio/works/${createdWork}?returnTo=${encodeURIComponent(currentHref)}`}>打开并继续编辑</Link></div> : null}
      {hidden ? <div className="review-action-message review-action-message-success" role="status">作品 #{hidden} 已移入回收站，没有永久删除。</div> : null}
      {restored ? <div className="review-action-message review-action-message-success" role="status">作品 #{restored} 已恢复为公开临时作品。</div> : null}

      <div className="review-row-actions"><Link className="review-button review-button-primary" href={`/me/studio/works/new?returnTo=${encodeURIComponent(currentHref)}`}>工作人员新建临时作品</Link><Link className="review-link" href="/me/studio/entities/creators">编辑创作者</Link><Link className="review-link" href="/me/studio/entities/organizations">编辑机构</Link><Link className="review-link" href="/me/review/content">AI 评级人工复核</Link><Link className="review-link" href="/me/review/feedback">用户提交审核</Link></div>

      <nav className="review-queue-tabs" aria-label="内容管理范围">
        <Link aria-current={filters.status === 'active' ? 'page' : undefined} href={studioHref(filters, { status: 'active', page: 1 })}><span>正式作品</span><strong>{formalCount.totalDocs.toLocaleString('zh-CN')}</strong></Link>
        <Link aria-current={filters.status === 'temporary' ? 'page' : undefined} href={studioHref(filters, { status: 'temporary', page: 1 })}><span>临时作品</span><strong>{temporaryCount.totalDocs.toLocaleString('zh-CN')}</strong></Link>
        <Link aria-current={filters.status === 'archived' ? 'page' : undefined} href={studioHref(filters, { status: 'archived', page: 1 })}><span>回收站</span><strong>{archivedCount.totalDocs.toLocaleString('zh-CN')}</strong></Link>
        <Link aria-current={filters.status === 'all' ? 'page' : undefined} href={studioHref(filters, { status: 'all', page: 1 })}><span>全部记录</span><strong>{(formalCount.totalDocs + temporaryCount.totalDocs + archivedCount.totalDocs).toLocaleString('zh-CN')}</strong></Link>
      </nav>

      <form action="/me/studio" className="review-filter-panel">
        <input name="status" type="hidden" value={filters.status} />
        <label><span>搜索作品</span><input defaultValue={filters.q} name="q" placeholder="标题、原名、别名、Slug、ID 或搜索补充文本" type="search" /></label>
        <label><span>目录分级</span><select defaultValue={filters.rank} name="rank">{rankOptions.map((rank) => <option key={rank} value={rank}>{rank === 'all' ? '全部分级' : label(rank)}</option>)}</select></label>
        <label><span>每页数量</span><select defaultValue={filters.perPage} name="perPage"><option value="20">20 条</option><option value="50">50 条</option><option value="100">100 条</option></select></label>
        <div className="review-filter-actions"><button className="review-button" type="submit">搜索数据库</button><Link className="review-link" href={studioHref(filters, { q: '', rank: 'all', page: 1 })}>清除筛选</Link></div>
      </form>

      <Pagination currentPage={currentPage} filters={filters} totalPages={totalPages} />
      <section className="review-list">
        {docs.map((work) => {
          const archived = work.catalogStatus === 'archived'
          return (
            <article className={`review-row review-content-row${archived ? ' review-merged-row' : ''}`} key={work.id}>
              <header className="review-row-header"><div className="review-row-title"><h2>{work.title || `作品 #${work.id}`}</h2><small>作品 ID：{work.id} · 最近更新：{formatDate(work.updatedAt)}</small></div><div className="review-chip-list"><span>{label(work.rank)}级</span><span>{work.reviewStatus || 'pending'}</span><span>{label(work.catalogStatus || 'active')}</span>{!archived ? <span>已发布</span> : null}</div></header>
              {work.originalTitle ? <p className="muted">原名：{work.originalTitle}</p> : null}
              <p className="muted">{work.mediaGroup || 'unknown'} / {work.mediaType || 'unknown'} / {work.format || 'unknown'}</p>
              <div className="review-content-actions">{!archived ? <Link className="review-button review-button-primary" href={`/me/studio/works/${work.id}?returnTo=${encodeURIComponent(currentHref)}`}>编辑完整条目</Link> : null}<Link className="review-link" href={canonicalContentUrl('works', work.id)}>查看前台</Link></div>
              {!archived ? (
                <details className="review-safety-note"><summary>隐藏 / 移入回收站</summary><form action={hideWorkAction} className="review-content-form"><input name="id" type="hidden" value={String(work.id)} /><input name="returnTo" type="hidden" value={currentHref} /><label className="review-content-note"><span>隐藏理由</span><textarea maxLength={800} name="reason" placeholder="例如：重复条目、误建条目、版权或身份信息待核查。" required /></label><label><span>确认</span><input name="confirmation" placeholder="输入：隐藏" required /></label><button className="review-button review-button-danger" type="submit">移入回收站</button></form></details>
              ) : (
                <form action={restoreWorkAction} className="review-content-actions"><input name="id" type="hidden" value={String(work.id)} /><input name="returnTo" type="hidden" value={currentHref} /><button className="review-button review-button-primary" type="submit">恢复为临时作品</button></form>
              )}
            </article>
          )
        })}
        {docs.length === 0 ? <section className="review-empty"><h2>没有匹配作品</h2><p>可以换一个译名、数据库 ID，或切换正式作品、临时作品与回收站。</p></section> : null}
      </section>
      <Pagination currentPage={currentPage} filters={filters} totalPages={totalPages} />
    </main>
  )
}

function Pagination({ filters, currentPage, totalPages }: { filters: StudioFilters; currentPage: number; totalPages: number }) {
  if (totalPages <= 1) return null
  return <nav className="review-pagination" aria-label="内容管理分页">{currentPage > 1 ? <Link href={studioHref(filters, { page: currentPage - 1 })}>上一页</Link> : null}<span aria-current="page">第 {currentPage} / {totalPages} 页</span>{currentPage < totalPages ? <Link href={studioHref(filters, { page: currentPage + 1 })}>下一页</Link> : null}</nav>
}
