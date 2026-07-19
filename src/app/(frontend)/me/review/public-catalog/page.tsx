import configPromise from '@payload-config'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload, type Where } from 'payload'

export const dynamic = 'force-dynamic'

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>
type Role = 'owner' | 'admin' | 'editor'

type CandidateSource = {
  source?: string
  label?: string
  externalId?: string
  url?: string
  note?: string
}

type WorkDoc = {
  id: string | number
  title?: string
  slug?: string
  siteId?: string
  rank?: string
  mediaGroup?: string
  mediaType?: string
  format?: string
  reviewStatus?: string
  evidenceStrength?: string
  evidenceNote?: string
  candidateSources?: CandidateSource[]
  importBatch?: string
  ratingNotice?: string
  chosenBaseSource?: string
  reviewReasons?: string[] | string
  sourceConflictNotes?: string
  humanReviewNote?: string
  status?: string
  updatedAt?: string
}

type Filters = {
  q: string
  mode: 'priority' | 'all'
  rank: string
  media: string
  source: string
  reason: string
  ratingNotice: string
  evidenceStrength: string
  importBatch: string
  sort: string
  page: number
  perPage: 25 | 50
}

type LabeledOption = { value: string; label: string }

const allowedRoles: Role[] = ['owner', 'admin', 'editor']
const ranks = ['X', 'F', 'E', 'D', 'C', 'B', 'A', 'AA', 'unknown']
const mediaOptions: LabeledOption[] = [
  { value: 'anime', label: '动画' },
  { value: 'manga', label: '漫画' },
  { value: 'novel', label: '小说' },
  { value: 'game', label: '游戏' },
  { value: 'other', label: '其他' },
  { value: 'unknown', label: '未知' },
]
const sourceOptions = ['mangadex', 'steam', 'yurizukan', 'bangumi', 'wikidata', 'anilist', 'vndb', 'wikipedia', 'ndl', 'manual', 'other']
const reviewReasonOptions: LabeledOption[] = [
  { value: 'radar_seed_attached', label: '雷达种子命中' },
  { value: 'radar_v06_package_import', label: 'Radar v0.6 评估包' },
  { value: 'radar_publication_guard', label: 'Radar 发布保护' },
  { value: 'radar_guard_low_evidence_coverage', label: '证据覆盖不足' },
  { value: 'radar_guard_weak_or_conflicting_source', label: '来源弱或冲突' },
  { value: 'radar_guard_unclear_provisional_grade', label: '暂定等级不明确' },
  { value: 'source_conflict', label: '来源冲突' },
  { value: 'multi_source_or_variant', label: '多来源或变体' },
  { value: 'wikidata_candidate_review', label: 'Wikidata 候选待复核' },
  { value: 'wikidata_quarantine', label: 'Wikidata 隔离' },
  { value: 'manual_review', label: '人工复核' },
  { value: 'other', label: '其他' },
]
const ratingNoticeOptions: LabeledOption[] = [
  { value: 'ai_synthesized_pending_review', label: 'AI 综合，待复核' },
  { value: 'insufficient_information', label: '信息不足' },
  { value: 'manual_reviewed', label: '人工已确认' },
  { value: 'none', label: '无提示' },
  { value: 'other', label: '其他' },
]
const evidenceOptions: LabeledOption[] = [
  { value: 'unassessed', label: '未评估' },
  { value: 'weak', label: '弱' },
  { value: 'medium', label: '中' },
  { value: 'strong', label: '强' },
]
const sortOptions: LabeledOption[] = [
  { value: '-updatedAt', label: '最近更新优先' },
  { value: 'updatedAt', label: '最早更新优先' },
  { value: 'title', label: '标题顺序' },
  { value: 'rank', label: '分级顺序' },
]
const priorityReasons = [
  'radar_seed_attached',
  'source_conflict',
  'multi_source_or_variant',
  'radar_guard_low_evidence_coverage',
  'radar_guard_weak_or_conflicting_source',
  'radar_guard_unclear_provisional_grade',
]
const mediaGroupLabels = Object.fromEntries(mediaOptions.map((item) => [item.value, item.label])) as Record<string, string>
const formatLabels: Record<string, string> = {
  tv_anime: 'TV 动画', anime_movie: '动画电影', ova: 'OVA', ona: '网络动画',
  manga_series: '漫画连载', manga_oneshot: '漫画短篇', novel_series: '小说系列',
  light_novel_series: '轻小说系列', web_serial: 'Web 连载', visual_novel: '视觉小说',
  pc_game: 'PC 游戏', console_game: '主机游戏', mobile_game: '手机游戏',
  audio_drama: '广播剧 / 音声', live_action: '真人影视', webtoon_series: 'Webtoon 连载',
  doujin: '同人作品', anthology: '合集 / 选集', other: '其他', unknown: '未知形态',
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback
}

function selectValue(value: string, options: string[]) {
  const normalized = value.trim()
  return options.includes(normalized) ? normalized : 'all'
}

function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const perPage = positiveInteger(first(params.perPage), 25) === 50 ? 50 : 25
  const requestedSort = first(params.sort)
  return {
    q: first(params.q).trim().slice(0, 160),
    mode: first(params.mode) === 'all' ? 'all' : 'priority',
    rank: selectValue(first(params.rank), ranks),
    media: selectValue(first(params.media), mediaOptions.map((item) => item.value)),
    source: selectValue(first(params.source), sourceOptions),
    reason: selectValue(first(params.reason), reviewReasonOptions.map((item) => item.value)),
    ratingNotice: selectValue(first(params.ratingNotice), ratingNoticeOptions.map((item) => item.value)),
    evidenceStrength: selectValue(first(params.evidenceStrength), evidenceOptions.map((item) => item.value)),
    importBatch: first(params.importBatch).trim().slice(0, 120),
    sort: sortOptions.some((item) => item.value === requestedSort) ? requestedSort : '-updatedAt',
    page: positiveInteger(first(params.page), 1),
    perPage,
  }
}

function roleOf(user: unknown): Role | undefined {
  if (!user || typeof user !== 'object') return undefined
  return (user as { role?: Role }).role
}

function canReview(user: unknown) {
  const role = roleOf(user)
  return Boolean(role && allowedRoles.includes(role))
}

function reviewReasons(value: WorkDoc['reviewReasons']) {
  if (Array.isArray(value)) return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))]
  if (typeof value === 'string') return [...new Set(value.split(/[;|,]/u).map((item) => item.trim()).filter(Boolean))]
  return []
}

function label(options: LabeledOption[], value?: string) {
  if (!value) return '未填写'
  return options.find((item) => item.value === value)?.label || value
}

function rankLabel(rank?: string) {
  if (!rank || rank === 'unknown') return '未分级'
  return rank === 'AA' ? 'S级' : `${rank}级`
}

function reviewStatusLabel(value?: string) {
  if (value === 'reviewed') return '已复核'
  if (value === 'disputed') return '有争议'
  if (value === 'deprecated') return '已废弃'
  return '待复核'
}

function publicationLabel(value?: string) {
  if (value === 'published') return '已发布'
  if (value === 'review') return '待发布审核'
  if (value === 'archived') return '已归档'
  return '草稿'
}

function workTypeLabel(doc: WorkDoc) {
  const format = formatLabels[doc.format || 'unknown']
  if (format && format !== '未知形态') return format
  return mediaGroupLabels[doc.mediaGroup || 'unknown'] || doc.mediaType || '未知类型'
}

function buildWhere(filters: Filters): Where {
  const and: Where[] = [{ reviewStatus: { equals: 'pending' } }]

  if (filters.mode === 'priority') {
    and.push({
      or: [
        { reviewReasons: { in: priorityReasons } },
        { ratingNotice: { equals: 'insufficient_information' } },
        { rank: { equals: 'unknown' } },
        { evidenceStrength: { equals: 'weak' } },
      ],
    })
  }

  if (filters.q) {
    and.push({
      or: [
        { title: { like: filters.q } },
        { slug: { like: filters.q } },
        { siteId: { like: filters.q } },
        { evidenceNote: { like: filters.q } },
        { sourceConflictNotes: { like: filters.q } },
      ],
    })
  }

  if (filters.rank !== 'all') and.push({ rank: { equals: filters.rank } })
  if (filters.media !== 'all') and.push({ mediaGroup: { equals: filters.media } })
  if (filters.source !== 'all') and.push({ 'candidateSources.source': { equals: filters.source } })
  if (filters.reason !== 'all') and.push({ reviewReasons: { contains: filters.reason } })
  if (filters.ratingNotice !== 'all') and.push({ ratingNotice: { equals: filters.ratingNotice } })
  if (filters.evidenceStrength !== 'all') and.push({ evidenceStrength: { equals: filters.evidenceStrength } })
  if (filters.importBatch) and.push({ importBatch: { like: filters.importBatch } })

  return { and }
}

function queryHref(filters: Filters, page: number) {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.mode !== 'priority') params.set('mode', filters.mode)
  if (filters.rank !== 'all') params.set('rank', filters.rank)
  if (filters.media !== 'all') params.set('media', filters.media)
  if (filters.source !== 'all') params.set('source', filters.source)
  if (filters.reason !== 'all') params.set('reason', filters.reason)
  if (filters.ratingNotice !== 'all') params.set('ratingNotice', filters.ratingNotice)
  if (filters.evidenceStrength !== 'all') params.set('evidenceStrength', filters.evidenceStrength)
  if (filters.importBatch) params.set('importBatch', filters.importBatch)
  if (filters.sort !== '-updatedAt') params.set('sort', filters.sort)
  if (filters.perPage !== 25) params.set('perPage', String(filters.perPage))
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/me/review/public-catalog?${query}` : '/me/review/public-catalog'
}

function pageNumbers(current: number, total: number) {
  const values = new Set([1, total, current - 1, current, current + 1])
  return [...values].filter((value) => value >= 1 && value <= total).sort((a, b) => a - b)
}

function countRows(docs: WorkDoc[], getValues: (doc: WorkDoc) => string[]) {
  const counts = new Map<string, number>()
  for (const doc of docs) {
    const values = getValues(doc)
    for (const value of values.length ? values : ['未填写']) counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

async function updateReviewAction(formData: FormData) {
  'use server'

  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user || !canReview(auth.user)) throw new Error('没有审核权限。')

  const id = String(formData.get('id') || '').trim()
  const decision = String(formData.get('decision') || '').trim()
  const note = String(formData.get('note') || '').trim().slice(0, 4000)
  if (!id || !['reviewed', 'disputed'].includes(decision)) throw new Error('审核参数无效。')
  if (decision === 'disputed' && !note) throw new Error('标记争议时必须填写原因。')

  const current = await payload.findByID({ collection: 'works', id, depth: 0, overrideAccess: true }) as unknown as WorkDoc
  const nextReasons = [...new Set([...reviewReasons(current.reviewReasons), 'manual_review'])]
  const actorID = (auth.user as { id?: string | number }).id
  const data: Record<string, unknown> = {
    reviewStatus: decision,
    reviewReasons: nextReasons,
    humanReviewNote: note,
    humanReviewedAt: new Date().toISOString(),
    humanReviewedBy: actorID,
  }

  if (decision === 'reviewed') data.ratingNotice = 'manual_reviewed'

  await payload.update({
    collection: 'works',
    id,
    depth: 0,
    overrideAccess: true,
    data: data as never,
  })

  revalidatePath('/me/review/public-catalog')
}

function FilterSelect({ labelText, name, value, options }: { labelText: string; name: string; value: string; options: LabeledOption[] }) {
  return (
    <label>
      <span>{labelText}</span>
      <select defaultValue={value} name={name}>
        <option value="all">全部</option>
        {options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </label>
  )
}

function Pagination({ filters, currentPage, totalPages }: { filters: Filters; currentPage: number; totalPages: number }) {
  if (totalPages <= 1) return null
  return (
    <nav className="review-pagination" aria-label="审核队列分页">
      {currentPage > 1 ? <Link href={queryHref(filters, currentPage - 1)}>上一页</Link> : null}
      {pageNumbers(currentPage, totalPages).map((page) => (
        page === currentPage
          ? <span aria-current="page" key={page}>{page}</span>
          : <Link href={queryHref(filters, page)} key={page}>{page}</Link>
      ))}
      {currentPage < totalPages ? <Link href={queryHref(filters, currentPage + 1)}>下一页</Link> : null}
    </nav>
  )
}

export default async function ReviewWorkbenchPage({ searchParams }: { searchParams: PageSearchParams }) {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent('/me/review/public-catalog')}`)

  if (!canReview(auth.user)) {
    return (
      <main className="page review-workbench">
        <section className="review-empty"><p className="eyebrow">条目审核</p><h1>权限不足</h1><p>该页面只开放给最高领袖、管理员、编辑和审核人员。</p></section>
      </main>
    )
  }

  const filters = parseFilters(await searchParams)
  const where = buildWhere(filters)
  const [result, pending, aiPending, disputed, unknownRank, promote, humanReview, identityReview, fullAssessment, moreResearch] = await Promise.all([
    payload.find({ collection: 'works', depth: 0, limit: filters.perPage, page: filters.page, overrideAccess: true, pagination: true, sort: filters.sort, where }),
    payload.count({ collection: 'works', overrideAccess: true, where: { reviewStatus: { equals: 'pending' } } }),
    payload.count({ collection: 'works', overrideAccess: true, where: { and: [{ reviewStatus: { equals: 'pending' } }, { ratingNotice: { equals: 'ai_synthesized_pending_review' } }] } }),
    payload.count({ collection: 'works', overrideAccess: true, where: { reviewStatus: { equals: 'disputed' } } }),
    payload.count({ collection: 'works', overrideAccess: true, where: { and: [{ reviewStatus: { equals: 'pending' } }, { rank: { equals: 'unknown' } }] } }),
    payload.count({ collection: 'radar-research-records', overrideAccess: true, where: { recommendedNextAction: { equals: 'promote_for_reassessment' } } }),
    payload.count({ collection: 'radar-research-records', overrideAccess: true, where: { recommendedNextAction: { equals: 'human_review' } } }),
    payload.count({ collection: 'radar-research-records', overrideAccess: true, where: { recommendedNextAction: { equals: 'identity_review' } } }),
    payload.count({ collection: 'radar-research-records', overrideAccess: true, where: { recommendedNextQueue: { equals: 'full_assessment' } } }),
    payload.count({ collection: 'radar-research-records', overrideAccess: true, where: { recommendedNextQueue: { equals: 'more_research' } } }),
  ])

  const docs = result.docs as unknown as WorkDoc[]
  const reasonStats = countRows(docs, (doc) => reviewReasons(doc.reviewReasons).map((value) => label(reviewReasonOptions, value)))
  const typeStats = countRows(docs, (doc) => [workTypeLabel(doc)])
  const sourceStats = countRows(docs, (doc) => [...new Set([doc.chosenBaseSource, ...(doc.candidateSources || []).map((item) => item.source)].filter(Boolean))] as string[])
  const totalPages = Math.max(1, result.totalPages || 1)
  const currentPage = Math.min(result.page || filters.page, totalPages)
  const adminResearchURL = '/admin/collections/radar-research-records'

  return (
    <main className="page review-workbench">
      <section className="review-hero">
        <div className="review-hero-copy">
          <p className="eyebrow">条目审核工作台</p>
          <h1>先读懂，再逐条处理</h1>
          <p className="muted">把作品身份、媒介类型、来源、证据状态、分级提示和待核问题放在同一屏。默认优先显示冲突、证据弱、未知等级等高价值队列。</p>
          <div className="review-safety-note">这里的“通过”只确认当前条目经过人工复核：不会自动发布，不会批量处理，也不会把 25,048 条研究建议写进正式评级。</div>
        </div>
        <div className="review-stat-grid">
          <Stat label="当前筛选" value={result.totalDocs} />
          <Stat label="当前页" value={docs.length} />
        </div>
      </section>

      <section className="review-stat-grid" aria-label="作品审核概览">
        <Stat label="作品待复核" value={pending.totalDocs} />
        <Stat label="AI 综合待复核" value={aiPending.totalDocs} />
        <Stat label="未知分级待复核" value={unknownRank.totalDocs} />
        <Stat label="已标记争议" value={disputed.totalDocs} />
      </section>

      <section>
        <div className="collection-heading"><h2>研究档案优先队列</h2><p className="muted">这些是独立研究建议，不等于正式评级。进入条目编辑页前仍需人工判断。</p></div>
        <div className="review-research-grid">
          <QueueCard href={adminResearchURL} label="建议重新评估" value={promote.totalDocs} />
          <QueueCard href={adminResearchURL} label="需要人工复核" value={humanReview.totalDocs} />
          <QueueCard href={adminResearchURL} label="需要身份核对" value={identityReview.totalDocs} />
          <QueueCard href={adminResearchURL} label="完整评估队列" value={fullAssessment.totalDocs} />
          <QueueCard href={adminResearchURL} label="继续研究队列" value={moreResearch.totalDocs} />
        </div>
      </section>

      <form action="/me/review/public-catalog" className="review-filter-panel">
        <label><span>关键词</span><input defaultValue={filters.q} name="q" placeholder="标题、Slug、导入追踪 ID、证据或冲突说明" type="search" /></label>
        <label><span>队列</span><select defaultValue={filters.mode} name="mode"><option value="priority">优先处理</option><option value="all">全部待复核</option></select></label>
        <FilterSelect labelText="作品大类" name="media" options={mediaOptions} value={filters.media} />
        <FilterSelect labelText="来源" name="source" options={sourceOptions.map((value) => ({ value, label: value }))} value={filters.source} />
        <FilterSelect labelText="复核原因" name="reason" options={reviewReasonOptions} value={filters.reason} />
        <FilterSelect labelText="分级提示" name="ratingNotice" options={ratingNoticeOptions} value={filters.ratingNotice} />
        <FilterSelect labelText="证据强度" name="evidenceStrength" options={evidenceOptions} value={filters.evidenceStrength} />
        <label><span>分级</span><select defaultValue={filters.rank} name="rank"><option value="all">全部</option>{ranks.map((rank) => <option key={rank} value={rank}>{rankLabel(rank)}</option>)}</select></label>
        <label><span>导入批次</span><input defaultValue={filters.importBatch} name="importBatch" placeholder="可输入部分批次名" /></label>
        <label><span>排序</span><select defaultValue={filters.sort} name="sort">{sortOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label><span>每页</span><select defaultValue={String(filters.perPage)} name="perPage"><option value="25">25 条</option><option value="50">50 条</option></select></label>
        <div className="review-filter-actions"><button className="review-button" type="submit">应用筛选</button><Link className="review-link" href="/me/review/public-catalog">重置</Link></div>
      </form>

      <section className="review-summary-grid" aria-label="当前页摘要">
        <Summary title="当前页复核原因" rows={reasonStats} />
        <Summary title="当前页作品形态" rows={typeStats} />
        <Summary title="当前页来源" rows={sourceStats} />
      </section>

      <Pagination currentPage={currentPage} filters={filters} totalPages={totalPages} />

      <section className="review-list">
        {docs.map((doc) => {
          const sources = [...new Set([doc.chosenBaseSource, ...(doc.candidateSources || []).map((item) => item.source)].filter(Boolean))] as string[]
          const reasons = reviewReasons(doc.reviewReasons)
          return (
            <article className="review-row" key={doc.id}>
              <header className="review-row-header">
                <div className="review-row-title"><h2><Link href={`/works/w-${doc.id}`}>{doc.title || '未命名作品'}</Link></h2><small>作品 ID：{doc.id}</small></div>
                <div className="review-chip-list"><span className="review-row-chip">{rankLabel(doc.rank)}</span><span className="review-row-chip">{workTypeLabel(doc)}</span><span className="review-row-chip">{reviewStatusLabel(doc.reviewStatus)}</span><span className="review-row-chip">{publicationLabel(doc.status)}</span></div>
              </header>

              <dl className="review-row-facts">
                <Fact labelText="页面提示" value={label(ratingNoticeOptions, doc.ratingNotice)} />
                <Fact labelText="证据强度" value={label(evidenceOptions, doc.evidenceStrength)} />
                <Fact labelText="来源" value={sources.join('、') || '未填写'} />
                <Fact labelText="复核原因" value={reasons.map((value) => label(reviewReasonOptions, value)).join('、') || '未填写'} />
                <Fact labelText="导入批次" value={doc.importBatch || '未填写'} />
                <Fact labelText="来源冲突" value={doc.sourceConflictNotes || '未记录冲突'} />
              </dl>

              {doc.evidenceNote || (doc.candidateSources || []).length ? (
                <details>
                  <summary>展开证据与来源详情</summary>
                  {doc.evidenceNote ? <pre>{doc.evidenceNote}</pre> : null}
                  {(doc.candidateSources || []).map((source, index) => (
                    <p key={`${source.source || 'source'}-${index}`}>{[source.source, source.label, source.externalId, source.note].filter(Boolean).join(' · ')} {source.url ? <a href={source.url} rel="noreferrer" target="_blank">打开来源</a> : null}</p>
                  ))}
                </details>
              ) : null}

              <div className="review-row-actions"><Link className="review-link" href={`/works/w-${doc.id}`}>查看前台条目</Link><Link className="review-link" href={`/admin/collections/works/${doc.id}`}>完整编辑</Link></div>

              <details>
                <summary>执行单条审核操作</summary>
                <form action={updateReviewAction} className="review-decision">
                  <input name="id" type="hidden" value={String(doc.id)} />
                  <label><span>人工复核记录</span><textarea defaultValue={doc.humanReviewNote || ''} maxLength={4000} name="note" placeholder="写明核对过的来源、仍有疑问的点，或争议原因。标记争议时必填。" /></label>
                  <p className="muted">通过会把复核状态改为“已复核”、页面提示改为“人工已确认”，但保持当前发布状态和当前分级不变。</p>
                  <div className="review-decision-actions"><button className="review-button review-button-primary" name="decision" type="submit" value="reviewed">通过当前条目</button><button className="review-button review-button-danger" name="decision" type="submit" value="disputed">标记为有争议</button></div>
                </form>
              </details>
            </article>
          )
        })}
        {docs.length === 0 ? <section className="review-empty"><h2>没有匹配条目</h2><p>可以切到“全部待复核”，或放宽来源、原因、证据和关键词筛选。</p></section> : null}
      </section>

      <Pagination currentPage={currentPage} filters={filters} totalPages={totalPages} />
    </main>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="review-stat"><span>{label}</span><strong>{value.toLocaleString('zh-CN')}</strong></div>
}

function QueueCard({ href, label, value }: { href: string; label: string; value: number }) {
  return <Link className="review-queue-card" href={href}><span>{label}</span><strong>{value.toLocaleString('zh-CN')}</strong></Link>
}

function Summary({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return <section className="review-summary"><h2>{title}</h2><div className="review-chip-list">{rows.slice(0, 12).map(([value, count]) => <span key={value}>{value} · {count}</span>)}</div></section>
}

function Fact({ labelText, value }: { labelText: string; value: string }) {
  return <div className="review-row-fact"><dt>{labelText}</dt><dd>{value}</dd></div>
}
