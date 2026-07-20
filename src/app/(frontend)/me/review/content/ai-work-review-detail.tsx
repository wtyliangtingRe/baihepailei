import configPromise from '@payload-config'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { isAdmin, isEditor } from '@/access/roles'
import ReviewDecisionButtons from '../_components/ReviewDecisionButtons'

import { canonicalContentUrl } from '../../../_lib/content-identity'
import { saveContentReviewAction } from './review-actions'
import { isMergedDuplicateWork, mergedWorkReference, safeReviewReturnTo } from './review-utils'

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>

type WorkDoc = {
  id: string | number
  title?: string
  rank?: string
  reviewStatus?: string
  ratingNotice?: string
  humanReviewNote?: string
  catalogStatus?: string
  _status?: string
  isLiteVisible?: boolean
  isFullVisible?: boolean
  mediaGroup?: string
  mediaType?: string
  format?: string
  humanAssessment?: { grade?: string; status?: string; note?: string } | null
  radarAssessment?: {
    suggestedGrade?: string
    confidencePercent?: number
    decisiveRuleCode?: string
    decisiveRuleReason?: string
    sourceSummary?: string
    assessedAt?: string
  } | null
  searchText?: string
  evidenceNote?: string
  sourceConflictNotes?: string
}

const rankOptions = ['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'trash', 'unknown']

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function optionLabel(value: string) {
  if (value === 'AA') return 'S（兼容 AA）'
  if (value === 'unknown') return '未知'
  if (value === 'trash') return '垃圾'
  return value
}

export async function AIWorkReviewDetail({ id, searchParams }: { id: string; searchParams: PageSearchParams }) {
  const raw = await searchParams
  const returnTo = safeReviewReturnTo(first(raw.returnTo) || '/me/review/content')
  const started = first(raw.started)
  const reviewed = first(raw.reviewed)
  const reviewError = first(raw.reviewError)
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent(`/me/review/content/works/${id}`)}`)
  if (!isEditor(auth.user)) {
    return <main className="page review-workbench"><section className="review-empty"><h1>权限不足</h1><p>该页面只开放给最高领袖、管理员和编辑。</p></section></main>
  }

  let work: WorkDoc
  try {
    work = await payload.findByID({ collection: 'works', id, depth: 1, draft: false, overrideAccess: true }) as unknown as WorkDoc
  } catch {
    notFound()
  }

  const merged = isMergedDuplicateWork(work) ? mergedWorkReference(work) : null
  if (merged) {
    return (
      <main className="page review-workbench review-editor-page">
        <section className="review-hero"><div className="review-hero-copy"><p className="eyebrow">AI 评级人工复核</p><h1>旧条目已经合并</h1><p className="muted">请改为复核规范作品。</p></div></section>
        <section className="review-merged-warning"><strong>{merged.title || `作品 #${merged.id}`}</strong><div className="review-content-actions"><Link className="review-button review-button-primary" href={`/me/review/content/works/${merged.id}?returnTo=${encodeURIComponent(returnTo)}`}>打开规范作品</Link></div></section>
      </main>
    )
  }

  const controlledAI = Boolean(work.radarAssessment?.assessedAt)
  const frontUrl = `${canonicalContentUrl('works', work.id)}?preview=1`
  const defaultRank = work.humanAssessment?.grade || work.radarAssessment?.suggestedGrade || work.rank || 'unknown'
  const actions = [
    { value: 'save', label: '只保存人工复核记录' },
    { value: 'approve', label: '确认人工评级并通过', className: 'review-button review-button-primary', confirm: '确认已经读完 AI 依据与作品材料，并记录这份人工评级吗？作品会继续保持发布。' },
    { value: 'reject', label: '驳回 AI 建议并标记争议', className: 'review-button review-button-danger', confirm: '确认驳回当前 AI 建议并标记争议吗？请先写明理由。' },
  ]

  return (
    <main className="page review-workbench review-editor-page">
      <section className="review-hero">
        <div className="review-hero-copy">
          <p className="eyebrow">AI 评级人工复核</p>
          <h1>{work.title || `作品 #${work.id}`}</h1>
          <p className="muted">作品 ID：{work.id} · AI 已评级 · {work.humanAssessment?.status === 'reviewed' ? '人工已复核' : '等待人工复核'}</p>
          <div className="review-safety-note">这是“已有受控 AI 评级、尚无人工评级”的快速复核页。作品始终保持发布；这里不会修改作品事实资料、临时/正式阶段或 AI 原始记录。</div>
        </div>
      </section>

      {!controlledAI ? <div className="review-action-message review-action-message-error" role="alert">这条作品没有带评估时间的受控 AI 评级，不属于本通道。</div> : null}
      {started ? <div className="review-action-message review-action-message-success" role="status">已经进入人工复核。请先阅读 AI 建议、来源和前台预览，再在页面底部作出决定。</div> : null}
      {reviewed ? <div className="review-action-message review-action-message-success" role="status">人工复核操作已保存。</div> : null}
      {reviewError ? <div className="review-action-message review-action-message-error" role="alert">{reviewError === 'note_required' ? '驳回 AI 建议时必须填写人工复核说明。' : reviewError === 'not_ai_review_candidate' ? '该作品不属于 AI 评级人工复核通道。' : '保存失败，请查看服务器日志后重试。'}</div> : null}

      <section className="review-row">
        <h2>AI 建议与当前状态</h2>
        <dl className="feedback-review-facts">
          <div><dt>AI 建议等级</dt><dd>{work.radarAssessment?.suggestedGrade || '尚无'}</dd></div>
          <div><dt>AI 评估时间</dt><dd>{work.radarAssessment?.assessedAt || '尚无'}</dd></div>
          <div><dt>置信度</dt><dd>{typeof work.radarAssessment?.confidencePercent === 'number' ? `${work.radarAssessment.confidencePercent}%` : '尚未计算'}</dd></div>
          <div><dt>决定性规则</dt><dd>{work.radarAssessment?.decisiveRuleCode || '尚无'}</dd></div>
          <div><dt>作品阶段</dt><dd>{work.catalogStatus === 'temporary' ? '临时作品' : work.catalogStatus === 'archived' ? '已归档' : '正式作品'}</dd></div>
          <div><dt>发布状态</dt><dd>{work._status || 'published'} · {work.isLiteVisible === false && work.isFullVisible === false ? '前台隐藏' : '前台可见'}</dd></div>
        </dl>
        {work.radarAssessment?.decisiveRuleReason ? <p><strong>规则说明：</strong>{work.radarAssessment.decisiveRuleReason}</p> : null}
        {work.radarAssessment?.sourceSummary ? <p><strong>AI 来源摘要：</strong>{work.radarAssessment.sourceSummary}</p> : null}

        <details className="review-editor-section">
          <summary><strong>展开作品前台实时预览</strong></summary>
          <iframe loading="lazy" src={frontUrl} style={{ width: '100%', minHeight: '720px', border: '1px solid #303030', borderRadius: '16px', background: '#111' }} title={`${work.title || '作品'}前台预览`} />
          <div className="review-row-actions"><Link className="review-link" href={frontUrl}>在新页面打开预览</Link></div>
        </details>
      </section>

      <form action={saveContentReviewAction} className="review-editor-form">
        <input name="collection" type="hidden" value="works" />
        <input name="id" type="hidden" value={String(work.id)} />
        <input name="returnTo" type="hidden" value={returnTo} />
        <input name="title" type="hidden" value={work.title || `作品 #${work.id}`} />
        <section className="review-editor-section">
          <header><h2>人工复核结论</h2><p>默认带入 AI 建议等级，但必须由复核者主动确认或修改。驳回时说明必填。</p></header>
          <div className="review-editor-grid">
            <label className="review-editor-field"><span>人工采用等级</span><select defaultValue={defaultRank} name="rank">{rankOptions.map((rank) => <option key={rank} value={rank}>{optionLabel(rank)}</option>)}</select></label>
            <label className="review-editor-field review-editor-field-wide"><span>人工复核说明</span><textarea defaultValue={work.humanAssessment?.note || work.humanReviewNote || ''} maxLength={4000} name="note" placeholder="记录核对过的来源、是否同意 AI 建议，以及仍有争议的地方。" /></label>
          </div>
        </section>
        <div className="review-editor-submit">
          <ReviewDecisionButtons actions={controlledAI ? actions : actions.slice(0, 1)} />
          <Link className="review-link" href={returnTo}>返回 AI 评级复核队列</Link>
          {isAdmin(auth.user) ? <Link className="review-link" href={`/admin/collections/works/${work.id}`}>Payload 高级维护</Link> : null}
        </div>
      </form>
    </main>
  )
}
