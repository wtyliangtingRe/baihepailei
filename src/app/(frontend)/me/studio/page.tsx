import configPromise from '@payload-config'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload, type Where } from 'payload'

import { canonicalContentUrl } from '../../_lib/content-identity'

export const dynamic = 'force-dynamic'

type Role = 'owner' | 'admin' | 'editor' | 'reviewer' | 'trusted' | 'member'
type PageSearchParams = Promise<Record<string, string | string[] | undefined>>
type StudioWork = {
  id: string | number
  title?: string
  originalTitle?: string
  slug?: string
  rank?: string
  reviewStatus?: string
  status?: string
  mediaGroup?: string
  mediaType?: string
  format?: string
  humanReviewNote?: string
  updatedAt?: string
}

type StudioFilters = {
  q: string
  rank: string
  status: string
  page: number
  perPage: number
}

const staffRoles = new Set<Role>(['owner', 'admin', 'editor', 'reviewer'])
const rankOptions = ['all', 'S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'trash', 'unknown']
const statusOptions = ['active', 'archived', 'all']
const activePublicationStatuses = ['draft', 'published']

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function roleOf(user: unknown): Role | undefined {
  if (!user || typeof user !== 'object') return undefined
  return (user as { role?: Role }).role
}

function canEdit(user: unknown) {
  const role = roleOf(user)
  return Boolean(role && staffRoles.has(role))
}

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback
}

function filtersFrom(params: Record<string, string | string[] | undefined>): StudioFilters {
  const rank = first(params.rank)
  const status = first(params.status)
  const requestedPerPage = positiveInteger(first(params.perPage), 50)
  return {
    q: first(params.q).trim().slice(0, 160),
    rank: rankOptions.includes(rank) ? rank : 'all',
    status: statusOptions.includes(status) ? status : 'active',
    page: positiveInteger(first(params.page), 1),
    perPage: [20, 50, 100].includes(requestedPerPage) ? requestedPerPage : 50,
  }
}

function studioHref(filters: StudioFilters, overrides: Partial<StudioFilters> = {}) {
  const next = { ...filters, ...overrides }
  const params = new URLSearchParams()
  if (next.q) params.set('q', next.q)
  if (next.rank !== 'all') params.set('rank', next.rank)
  if (next.status !== 'active') params.set('status', next.status)
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

  // Works has both Payload drafts and a historical business field named `status`.
  // With `draft: true`, Payload resolves this filter through `_works_v.version_status`,
  // whose enum is not guaranteed to contain the business value `archived`.
  // The studio therefore reads canonical records with `draft: false` and only sends
  // `archived` to the main Works table when the archive view is explicitly requested.
  if (filters.status === 'active') and.push({ status: { in: activePublicationStatuses } })
  if (filters.status === 'archived') and.push({ status: { equals: 'archived' } })
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
      collection: 'works',
      id,
      depth: 0,
      draft: false,
      overrideAccess: true,
      context: { firstPartyStudio: true, softHide: true },
      data: {
        status: 'archived',
        reviewStatus: 'deprecated',
        isLiteVisible: false,
        isFullVisible: false,
        humanReviewNote: appendAuditNote(current.humanReviewNote, 'soft-hidden', reason, (auth.user as { id?: string | number }).id),
      },
    })
  } catch (error) {
    console.error('First-party studio soft hide failed', { id, error })
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
      collection: 'works',
      id,
      depth: 0,
      draft: false,
      overrideAccess: true,
      context: { firstPartyStudio: true, restoreSoftHidden: true },
      data: {
        status: 'draft',
        reviewStatus: 'pending',
        isLiteVisible: false,
        isFullVisible: false,
        humanReviewNote: appendAuditNote(current.humanReviewNote, 'restored-to-draft', '从回收站恢复，需重新复核后发布', (auth.user as { id?: string | number }).id),
      },
    })
  } catch (error) {
    console.error('First-party studio restore failed', { id, error })
    redirect(withMessage(returnTo, 'studioError', 'restore_failed'))
  }

  revalidatePath('/me/studio')
  revalidatePath('/works')
  redirect(withMessage(returnTo, 'restored', id))
}

function label(value?: string) {
  if (value === 'AA') return 'S'
  if (value === 'trash') return '垃圾'
  if (!value || value === 'unknown') return '未知'
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
    collection: 'works',
    depth: 0,
    draft: false,
    limit: filters.perPage,
    page: filters.page,
    pagination: true,
    overrideAccess: true,
    sort: '-updatedAt',
    where: whereFor(filters),
  })
}

async function countByStatus(payload: Awaited<ReturnType<typeof getPayload>>, status: 'active' | 'archived') {
  const where: Where = status === 'active'
    ? { status: { in: activePublicationStatuses } }
    : { status: { equals: 'archived' } }
  return payload.find({
    collection: 'works',
    depth: 0,
    draft: false,
    limit: 1,
    page: 1,
    pagination: true,
    overrideAccess: true,
    where,
  })
}

export default async function ContentStudioPage({ searchParams }: { searchParams: PageSearchParams }) {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent('/me/studio')}`)

  const role = roleOf(auth.user)
  if (!role || !staffRoles.has(role)) {
    return (
      <main className="page review-workbench studio-page">
        <section className="review-hero"><div className="review-hero-copy"><p className="eyebrow">资料库共建</p><h1>提交新作品申请</h1><p className="muted">普通用户不会直接修改正式资料库。你可以提交作品名称、别名、来源和收录理由，之后由编辑审核并建立草稿。</p></div></section>
        <section className="detail-card"><h2>发现资料库里没有的作品？</h2><p>新建申请会进入“用户反馈审核”，不会直接公开，也不会覆盖现有条目。</p><Link className="review-button review-button-primary" href="/feedback?type=new_work">新建作品申请</Link></section>
      </main>
    )
  }

  const raw = await searchParams
  const filters = filtersFrom(raw)
  const currentHref = studioHref(filters)
  let archiveSchemaReady = true
  let result
  let activeCount
  let archivedCount

  try {
    ;[result, activeCount] = await Promise.all([findStudioPage(payload, filters), countByStatus(payload, 'active')])
  } catch (error) {
    console.error('First-party studio canonical query failed', { filters, error })
    throw error
  }

  try {
    archivedCount = await countByStatus(payload, 'archived')
  } catch (error) {
    archiveSchemaReady = false
    console.error('First-party studio archive enum is not aligned yet', { error })
    archivedCount = { totalDocs: 0 }
    if (filters.status === 'archived') result = { ...result, docs: [], totalDocs: 0, totalPages: 1, page: 1 }
  }

  const docs = result.docs as unknown as StudioWork[]
  const totalPages = Math.max(1, result.totalPages || 1)
  const currentPage = Math.min(result.page || filters.page, totalPages)
  const studioError = first(raw.studioError)
  const hidden = first(raw.hidden)
  const restored = first(raw.restored)
  const errorMessage = studioError === 'hide_confirmation'
    ? '隐藏作品需要填写至少 4 个字的理由，并在确认框输入“隐藏”。'
    : studioError === 'archive_schema'
      ? '当前数据库的作品状态 enum 尚未完整支持回收站写入；作品没有被隐藏。请先完成只读诊断和 Payload migration。'
      : studioError === 'restore_failed'
        ? '恢复作品失败，原记录没有被改写。请查看开发服务器日志。'
        : studioError
          ? '操作无效或保存失败，原记录没有被改写。'
          : ''

  return (
    <main className="page review-workbench studio-page">
      <section className="review-hero">
        <div className="review-hero-copy"><p className="eyebrow">站内内容管理</p><h1>真正编辑网站内容</h1><p className="muted">这里直接读取 Payload 当前数据库，不是 AI 审核队列。工作人员可以搜索、创建、编辑、隐藏和恢复作品；所有写入通过 Payload，不执行 PostgreSQL 直写。</p><div className="review-safety-note">“隐藏作品”是可恢复的软删除：作品会归档并关闭公开可见性，不会永久删除记录。跨语言合并仍只开放给最高领袖和管理员，并走单组确认。</div></div>
        <div className="review-stat-grid"><div className="review-stat"><span>可编辑作品</span><strong>{activeCount.totalDocs.toLocaleString('zh-CN')}</strong></div><div className="review-stat"><span>回收站</span><strong>{archiveSchemaReady ? archivedCount.totalDocs.toLocaleString('zh-CN') : '待迁移'}</strong></div></div>
      </section>

      {!archiveSchemaReady ? <div className="review-action-message review-action-message-error" role="alert">回收站状态尚未与数据库版本 enum 对齐。编辑和新建功能仍可使用，但在诊断完成前不要测试隐藏或恢复。</div> : null}
      {errorMessage ? <div className="review-action-message review-action-message-error" role="alert">{errorMessage}</div> : null}
      {hidden ? <div className="review-action-message review-action-message-success" role="status">作品 #{hidden} 已移入回收站，没有永久删除。</div> : null}
      {restored ? <div className="review-action-message review-action-message-success" role="status">作品 #{restored} 已恢复为待复核草稿。</div> : null}

      <div className="review-row-actions"><Link className="review-button review-button-primary" href="/me/studio/works/new">工作人员新建作品草稿</Link><Link className="review-link" href="/me/review/content">AI / 内容审核台</Link><Link className="review-link" href="/me/review/feedback">用户反馈审核</Link></div>

      <nav className="review-queue-tabs" aria-label="内容管理范围">
        <Link aria-current={filters.status === 'active' ? 'page' : undefined} href={studioHref(filters, { status: 'active', page: 1 })}><span>可编辑作品</span><strong>{activeCount.totalDocs.toLocaleString('zh-CN')}</strong></Link>
        <Link aria-current={filters.status === 'archived' ? 'page' : undefined} href={studioHref(filters, { status: 'archived', page: 1 })}><span>回收站</span><strong>{archiveSchemaReady ? archivedCount.totalDocs.toLocaleString('zh-CN') : '待迁移'}</strong></Link>
        <Link aria-current={filters.status === 'all' ? 'page' : undefined} href={studioHref(filters, { status: 'all', page: 1 })}><span>全部记录</span><strong>{archiveSchemaReady ? (activeCount.totalDocs + archivedCount.totalDocs).toLocaleString('zh-CN') : activeCount.totalDocs.toLocaleString('zh-CN')}</strong></Link>
      </nav>

      <form action="/me/studio" className="review-filter-panel">
        <input name="status" type="hidden" value={filters.status} />
        <label><span>搜索作品</span><input defaultValue={filters.q} name="q" placeholder="标题、原名、别名、Slug、ID 或搜索补充文本" type="search" /></label>
        <label><span>正式分级</span><select defaultValue={filters.rank} name="rank">{rankOptions.map((rank) => <option key={rank} value={rank}>{rank === 'all' ? '全部分级' : label(rank)}</option>)}</select></label>
        <label><span>每页数量</span><select defaultValue={filters.perPage} name="perPage"><option value="20">20 条</option><option value="50">50 条</option><option value="100">100 条</option></select></label>
        <div className="review-filter-actions"><button className="review-button" type="submit">搜索数据库</button><Link className="review-link" href={studioHref(filters, { q: '', rank: 'all', page: 1 })}>清除筛选</Link></div>
      </form>

      <Pagination currentPage={currentPage} filters={filters} totalPages={totalPages} />
      <section className="review-list">
        {docs.map((work) => {
          const archived = work.status === 'archived'
          return (
            <article className={`review-row review-content-row${archived ? ' review-merged-row' : ''}`} key={work.id}>
              <header className="review-row-header"><div className="review-row-title"><h2>{work.title || `作品 #${work.id}`}</h2><small>作品 ID：{work.id} · 最近更新：{formatDate(work.updatedAt)}</small></div><div className="review-chip-list"><span>{label(work.rank)}级</span><span>{work.reviewStatus || 'pending'}</span><span>{work.status || 'draft'}</span></div></header>
              {work.originalTitle ? <p className="muted">原名：{work.originalTitle}</p> : null}
              <p className="muted">{work.mediaGroup || 'unknown'} / {work.mediaType || 'unknown'} / {work.format || 'unknown'}</p>
              <div className="review-content-actions">{!archived ? <Link className="review-button review-button-primary" href={`/me/studio/works/${work.id}?returnTo=${encodeURIComponent(currentHref)}`}>编辑完整条目</Link> : null}<Link className="review-link" href={canonicalContentUrl('works', work.id)}>查看前台</Link></div>
              {!archived ? (
                <details className="review-safety-note" open={false}><summary>隐藏 / 移入回收站</summary><form action={hideWorkAction} className="review-content-form"><input name="id" type="hidden" value={String(work.id)} /><input name="returnTo" type="hidden" value={currentHref} /><label className="review-content-note"><span>隐藏理由</span><textarea maxLength={800} name="reason" placeholder="例如：重复条目、误建条目、版权或身份信息待核查。" required /></label><label><span>确认</span><input name="confirmation" placeholder="输入：隐藏" required /></label><button className="review-button review-button-danger" disabled={!archiveSchemaReady} type="submit">移入回收站</button></form></details>
              ) : (
                <form action={restoreWorkAction} className="review-content-actions"><input name="id" type="hidden" value={String(work.id)} /><input name="returnTo" type="hidden" value={currentHref} /><button className="review-button review-button-primary" type="submit">恢复为待复核草稿</button></form>
              )}
            </article>
          )
        })}
        {docs.length === 0 ? <section className="review-empty"><h2>没有匹配作品</h2><p>{filters.status === 'archived' && !archiveSchemaReady ? '回收站需要先完成数据库 enum 对齐；当前没有执行任何写入。' : '可以换一个译名、数据库 ID，或切换可编辑作品与回收站。'}</p></section> : null}
      </section>
      <Pagination currentPage={currentPage} filters={filters} totalPages={totalPages} />
    </main>
  )
}

function Pagination({ filters, currentPage, totalPages }: { filters: StudioFilters; currentPage: number; totalPages: number }) {
  if (totalPages <= 1) return null
  return <nav className="review-pagination" aria-label="内容管理分页">{currentPage > 1 ? <Link href={studioHref(filters, { page: currentPage - 1 })}>上一页</Link> : null}<span aria-current="page">第 {currentPage} / {totalPages} 页</span>{currentPage < totalPages ? <Link href={studioHref(filters, { page: currentPage + 1 })}>下一页</Link> : null}</nav>
}
