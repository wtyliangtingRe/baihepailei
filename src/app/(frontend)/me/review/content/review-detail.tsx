import configPromise from '@payload-config'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { isAdmin, isEditor } from '@/access/roles'
import ReviewDecisionButtons from '../_components/ReviewDecisionButtons'

import { canonicalContentUrl } from '../../../_lib/content-identity'
import { saveContentReviewAction, type ContentCollection } from './review-actions'
import { isMergedDuplicateWork, mergedWorkReference, safeReviewReturnTo, type ReviewableContentDoc } from './review-utils'

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>
type ContentDoc = ReviewableContentDoc & {
  id: string | number
  title?: string
  name?: string
  slug?: string
  rank?: string
  type?: string
  mediaGroup?: string
  mediaType?: string
  format?: string
  ratingNotice?: string
  reviewOrigin?: string
  humanReviewNote?: string
  humanAssessment?: { grade?: string; status?: string; note?: string; evidenceStatus?: string } | null
  radarAssessment?: {
    suggestedGrade?: string
    confidencePercent?: number
    decisiveRuleCode?: string
    decisiveRuleReason?: string
    sourceSummary?: string
    assessedAt?: string
  } | null
  _status?: string
  catalogStatus?: string
  isLiteVisible?: boolean
  isFullVisible?: boolean
  updatedAt?: string
}

const collectionMeta: Record<ContentCollection, { label: string; titleField: 'title' | 'name' }> = {
  works: { label: '作品', titleField: 'title' },
  creators: { label: '创作者', titleField: 'name' },
  organizations: { label: '机构', titleField: 'name' },
}
const workRankOptions = ['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'trash', 'unknown']
const creatorRankOptions = ['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'unknown']
const organizationTypes = [
  'publisher', 'production_company', 'animation_studio', 'game_company', 'distributor',
  'circle', 'brand', 'platform', 'committee', 'other',
]

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function itemTitle(collection: ContentCollection, doc: ContentDoc) {
  return String(doc[collectionMeta[collection].titleField] || '未命名条目')
}

function reviewStatusLabel(value?: string) {
  if (value === 'reviewed') return '已复核'
  if (value === 'disputed') return '有争议'
  if (value === 'deprecated') return '已合并 / 已废弃'
  return '待复核'
}

function optionLabel(value: string) {
  if (value === 'AA') return 'S（兼容 AA）'
  if (value === 'unknown') return '未知'
  if (value === 'trash') return '垃圾'
  return value
}

export async function ContentReviewDetail({ collection, id, searchParams }: {
  collection: ContentCollection
  id: string
  searchParams: PageSearchParams
}) {
  const rawSearch = await searchParams
  const returnTo = safeReviewReturnTo(first(rawSearch.returnTo) || `/me/review/content?collection=${collection}`)
  const started = first(rawSearch.started)
  const reviewed = first(rawSearch.reviewed)
  const reviewError = first(rawSearch.reviewError)
  const targetID = first(rawSearch.targetId)
  const targetTitle = first(rawSearch.targetTitle)
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent(`/me/review/content/${collection}/${id}`)}`)
  if (!isEditor(auth.user)) {
    return <main className="page review-workbench"><section className="review-empty"><h1>权限不足</h1><p>该页面只开放给最高领袖、管理员和编辑。</p></section></main>
  }

  let doc: ContentDoc
  try {
    doc = await payload.findByID({ collection: collection as never, id, depth: 1, draft: false, overrideAccess: true }) as unknown as ContentDoc
  } catch {
    notFound()
  }

  const title = itemTitle(collection, doc)
  const frontUrl = canonicalContentUrl(collection, doc.id)
  const previewUrl = `${frontUrl}?preview=1`
  const merged = collection === 'works' && isMergedDuplicateWork(doc) ? mergedWorkReference(doc) : null
  const mayUsePayload = isAdmin(auth.user)
  const actions = [
    { value: 'save', label: '只保存审核记录' },
    { value: 'approve', label: '通过并移入已处理', className: 'review-button review-button-primary', confirm: '确认已经读完材料并通过这条内容吗？通过不会自动发布草稿。' },
    { value: 'reject', label: '驳回并标记争议', className: 'review-button review-button-danger', confirm: '确认驳回并标记为有争议吗？请先写明理由。' },
  ]

  if (merged) {
    return (
      <main className="page review-workbench review-editor-page">
        <section className="review-hero"><div className="review-hero-copy"><p className="eyebrow">内容审核 · {collectionMeta[collection].label}</p><h1>{title}</h1><p className="muted">旧条目已经合并，不能继续审核。</p></div></section>
        <section className="review-merged-warning"><strong>请改为审核规范作品：{merged.title || `作品 #${merged.id}`}</strong><div className="review-content-actions"><Link className="review-button review-button-primary" href={`/me/review/content/works/${merged.id}?returnTo=${encodeURIComponent(returnTo)}`}>打开规范作品审核页</Link><Link className="review-link" href={returnTo}>返回队列</Link></div></section>
      </main>
    )
  }

  return (
    <main className="page review-workbench review-editor-page">
      <section className="review-hero">
        <div className="review-hero-copy">
          <p className="eyebrow">内容审核 · {collectionMeta[collection].label}</p>
          <h1>{title}</h1>
          <p className="muted">条目 ID：{doc.id} · {reviewStatusLabel(doc.reviewStatus)}</p>
          <div className="review-safety-note">这是独立审核页，不是正式内容编辑器。这里只保存审核所需的名称、人工等级或机构类型和审核记录；发布、来源关系与复杂资料仍留在作品本身的内容管理流程。</div>
        </div>
      </section>

      {started ? <div className="review-action-message review-action-message-success" role="status">已经进入审查。请先阅读 AI 建议、当前资料和前台预览，再使用页面底部按钮。</div> : null}
      {reviewed ? <div className="review-action-message review-action-message-success" role="status">审核操作已经保存：{reviewed === 'approve' ? '通过并移入已处理' : reviewed === 'reject' ? '驳回并标记争议' : '只保存审核记录'}。</div> : null}
      {reviewError ? <div className="review-action-message review-action-message-error" role="alert">{reviewError === 'note_required' ? '驳回时必须先填写人工复核记录。' : reviewError === 'save_failed' ? '保存失败，请查看服务器日志后重试。' : reviewError === 'merged_duplicate' ? <>该作品已经合并。{targetID ? <Link href={`/me/review/content/works/${targetID}?returnTo=${encodeURIComponent(returnTo)}`}>{targetTitle || `打开规范作品 #${targetID}`}</Link> : null}</> : '审核字段或处理动作无效。'}</div> : null}

      <section className="review-row">
        <h2>当前资料与审核预览</h2>
        <dl className="feedback-review-facts">
          <div><dt>名称</dt><dd>{title}</dd></div>
          <div><dt>复核状态</dt><dd>{reviewStatusLabel(doc.reviewStatus)}</dd></div>
          {collection !== 'organizations' ? <div><dt>当前等级</dt><dd>{doc.rank || 'unknown'}</dd></div> : <div><dt>机构类型</dt><dd>{doc.type || 'other'}</dd></div>}
          {collection === 'works' ? <div><dt>作品类型</dt><dd>{doc.mediaGroup || 'unknown'} / {doc.mediaType || 'unknown'} / {doc.format || 'unknown'}</dd></div> : null}
          {collection === 'works' ? <div><dt>人工轨道</dt><dd>{doc.humanAssessment?.grade || '尚无'} · {doc.humanAssessment?.status || 'pending'}</dd></div> : null}
          {collection === 'works' ? <div><dt>发布与可见性</dt><dd>{doc._status || 'draft'} · {doc.catalogStatus || 'active'} · {doc.isLiteVisible || doc.isFullVisible ? '至少一个前台版本可见' : '当前隐藏'}</dd></div> : null}
        </dl>

        {collection === 'works' ? (
          <aside className="review-ai-suggestion">
            <strong>{doc.radarAssessment?.suggestedGrade ? `AI 建议：${doc.radarAssessment.suggestedGrade} 级` : '尚无 AI 建议'}</strong>
            {typeof doc.radarAssessment?.confidencePercent === 'number' ? <span>置信度 {doc.radarAssessment.confidencePercent}%</span> : null}
            {doc.radarAssessment?.decisiveRuleCode ? <span>决定性规则 {doc.radarAssessment.decisiveRuleCode}</span> : null}
            {doc.radarAssessment?.decisiveRuleReason ? <p>{doc.radarAssessment.decisiveRuleReason}</p> : null}
            {doc.radarAssessment?.sourceSummary ? <p>{doc.radarAssessment.sourceSummary}</p> : null}
            {!doc.radarAssessment?.suggestedGrade ? <small>人工新建或尚未评估的作品保持占位；下一次 unassessed AI 管线会将其纳入分析。</small> : <small>机器建议独立展示，不会自动覆盖人工轨道。</small>}
          </aside>
        ) : null}

        <details className="review-editor-section">
          <summary><strong>展开站内前台预览</strong></summary>
          <p className="muted">预览放在审核页中，并使用工作人员实时预览参数叠加数据库最新值，避免在队列和编辑器之间来回跳转。</p>
          <iframe loading="lazy" src={previewUrl} style={{ width: '100%', minHeight: '720px', border: '1px solid #303030', borderRadius: '16px', background: '#111' }} title={`${title}前台预览`} />
          <div className="review-row-actions"><Link className="review-link" href={previewUrl}>在新页面打开实时预览</Link></div>
        </details>
      </section>

      <form action={saveContentReviewAction} className="review-editor-form">
        <input name="collection" type="hidden" value={collection} />
        <input name="id" type="hidden" value={String(doc.id)} />
        <input name="returnTo" type="hidden" value={returnTo} />
        <section className="review-editor-section">
          <header><h2>审核记录</h2><p>修改名称和人工结论后，先在这里记录核验依据。通过与驳回不会自动改变作品发布状态。</p></header>
          <div className="review-editor-grid">
            <label className="review-editor-field review-editor-field-wide"><span>名称</span><input defaultValue={title} maxLength={300} name="title" required /></label>
            {collection !== 'organizations' ? (
              <label className="review-editor-field"><span>人工采用等级</span><select defaultValue={doc.rank || 'unknown'} name="rank">{(collection === 'works' ? workRankOptions : creatorRankOptions).map((rank) => <option key={rank} value={rank}>{optionLabel(rank)}</option>)}</select></label>
            ) : (
              <label className="review-editor-field"><span>机构类型</span><select defaultValue={doc.type || 'other'} name="type">{organizationTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            )}
            <label className="review-editor-field review-editor-field-wide"><span>人工复核记录</span><textarea defaultValue={doc.humanReviewNote || ''} maxLength={4000} name="note" placeholder="记录阅读过的来源、为什么通过或驳回，以及仍待确认的问题。驳回时必填。" /></label>
          </div>
        </section>
        <div className="review-editor-submit">
          <ReviewDecisionButtons actions={actions} />
          <Link className="review-link" href={returnTo}>返回审核队列</Link>
          {mayUsePayload ? <Link className="review-link" href={`/admin/collections/${collection}/${doc.id}`}>Payload 高级维护</Link> : null}
        </div>
      </form>
    </main>
  )
}
