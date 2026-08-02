import configPromise from '@payload-config'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { isEditor } from '@/access/roles'

import { canonicalContentUrl } from '../../../_lib/content-identity'

export const dynamic = 'force-dynamic'

type RadarRecord = {
  id: string | number
  publicationKey: string
  workIdSnapshot: string
  title: string
  publicState: string
  researchStatus: string
  pageNotice: string
  recordStatus: string
}

type HumanReview = {
  status?: string
  reviewerIdentity?: string
  reviewedAt?: string
  decision?: string
  proposedCoreGrade?: string
  proposedProfileChanges?: Array<{ value?: string }>
  reasoning?: string
  additionalEvidenceRefs?: Array<{ value?: string }>
  moderationState?: string
  blocksAnalysis?: boolean
  blocksPublication?: boolean
}

type RadarRating = {
  id: string | number
  publicationKey: string
  coreGrade?: string
  bestGrade?: string
  likelyGrade?: string
  worstGrade?: string
  confidence?: string
  reasoningSummary?: string
  humanReview?: HumanReview
  recordStatus?: string
}

const grades = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X']
const reviewStates = ['unreviewed', 'reviewed', 'disputed']
const recordStates = ['current', 'withdrawn']

function text(value: FormDataEntryValue | null, max = 5000) {
  return String(value || '').trim().slice(0, max)
}

function checked(value: FormDataEntryValue | null) {
  return String(value || '') === 'on'
}

function choice(value: FormDataEntryValue | null, allowed: string[], fallback: string) {
  const normalized = text(value, 80)
  return allowed.includes(normalized) ? normalized : fallback
}

async function requireEditor() {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent('/me/studio')}`)
  if (!isEditor(auth.user)) throw new Error('没有编辑 Radar 记录的权限。')
  return { payload, user: auth.user as { id?: string | number; email?: string } }
}

async function updateRecordAction(formData: FormData) {
  'use server'
  const { payload } = await requireEditor()
  const id = text(formData.get('id'), 80)
  if (!id) throw new Error('缺少 Radar 记录 ID。')

  const recordStatus = choice(formData.get('recordStatus'), recordStates, 'current')

  await payload.update({
    collection: 'radar-public-records',
    id,
    depth: 0,
    overrideAccess: true,
    data: { recordStatus },
  })

  revalidatePath('/radar')
  revalidatePath(`/radar/${id}`)
  redirect(`/me/studio/radar/${id}?saved=record`)
}

async function updateRatingAction(formData: FormData) {
  'use server'
  const { payload, user } = await requireEditor()
  const recordId = text(formData.get('recordId'), 80)
  const ratingId = text(formData.get('ratingId'), 80)
  if (!recordId || !ratingId) throw new Error('缺少 Radar 评级 ID。')

  const current = await payload.findByID({
    collection: 'radar-public-ratings',
    id: ratingId,
    depth: 0,
    overrideAccess: true,
  }) as unknown as RadarRating

  const recordStatus = choice(formData.get('recordStatus'), recordStates, current.recordStatus || 'current')
  const reviewStatus = choice(formData.get('reviewStatus'), reviewStates, current.humanReview?.status || 'unreviewed')
  const proposedCoreGradeValue = text(formData.get('proposedCoreGrade'), 20)
  const proposedCoreGrade = grades.includes(proposedCoreGradeValue) ? proposedCoreGradeValue : undefined
  const decision = text(formData.get('decision'), 1000)
  const reasoning = text(formData.get('reviewReasoning'), 5000)
  const previousReview = current.humanReview || {}
  const reviewedAt = reviewStatus === 'reviewed'
    ? previousReview.reviewedAt || new Date().toISOString()
    : previousReview.reviewedAt

  await payload.update({
    collection: 'radar-public-ratings',
    id: ratingId,
    depth: 0,
    overrideAccess: true,
    data: {
      recordStatus,
      humanReview: {
        ...previousReview,
        status: reviewStatus,
        reviewerIdentity: reviewStatus === 'unreviewed'
          ? previousReview.reviewerIdentity
          : String(user.email || user.id || 'staff'),
        reviewedAt,
        decision,
        proposedCoreGrade,
        reasoning,
        blocksAnalysis: checked(formData.get('blocksAnalysis')),
        blocksPublication: checked(formData.get('blocksPublication')),
      },
    },
  })

  revalidatePath('/radar')
  revalidatePath(`/radar/${recordId}`)
  redirect(`/me/studio/radar/${recordId}?saved=rating`)
}

function option(value: string, label: string) {
  return <option key={value} value={value}>{label}</option>
}

export default async function RadarStudioEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const { payload } = await requireEditor()
  const rawSearchParams = await searchParams

  let record: RadarRecord
  try {
    record = await payload.findByID({
      collection: 'radar-public-records',
      id,
      depth: 0,
      overrideAccess: true,
    }) as unknown as RadarRecord
  } catch {
    notFound()
  }

  const ratingResult = await payload.find({
    collection: 'radar-public-ratings',
    depth: 0,
    limit: 1,
    page: 1,
    pagination: true,
    overrideAccess: true,
    where: { publicationKey: { equals: record.publicationKey } },
  })
  const rating = ratingResult.docs[0] as unknown as RadarRating | undefined
  const saved = Array.isArray(rawSearchParams.saved) ? rawSearchParams.saved[0] : rawSearchParams.saved

  return (
    <main className="page review-workbench studio-page radar-studio-page">
      <section className="review-hero">
        <div className="review-hero-copy">
          <p className="eyebrow">站内内容管理</p>
          <h1>编辑 Radar：{record.title}</h1>
          <p className="muted">这里直接编辑撤回状态与人工复核层。由 Release 哈希绑定的研究事实、证据、机器等级和机器推理保持只读；需要修正原始投影时应生成新的受控 Release。</p>
          <div className="review-safety-note">所有保存仍通过 Payload 集合权限与审计钩子；本页不提供永久删除，也不会改写 Release 绑定的机器原始字段。</div>
        </div>
      </section>

      {saved ? (
        <div className="review-action-message review-action-message-success" role="status">
          {saved === 'rating' ? '评级与人工复核字段已保存。' : '公开研究记录已保存。'}
        </div>
      ) : null}

      <div className="review-row-actions">
        <Link className="review-link" href={`/radar/${record.id}`}>查看公开详情</Link>
        <Link className="review-link" href={canonicalContentUrl('works', record.workIdSnapshot)}>查看作品页</Link>
        <Link className="review-link" href={`/admin/collections/radar-public-records/${record.id}`}>Payload 完整编辑研究记录</Link>
        {rating ? <Link className="review-link" href={`/admin/collections/radar-public-ratings/${rating.id}`}>Payload 完整编辑评级</Link> : null}
        <Link className="review-link" href="/radar">返回 Radar 列表</Link>
      </div>

      <section className="detail-card">
        <h2>公开研究状态</h2>
        <div className="radar-metric-grid">
          <div><span>公开资料状态（只读）</span><strong>{record.publicState}</strong></div>
          <div><span>研究状态（只读）</span><strong>{record.researchStatus}</strong></div>
        </div>
        <p className="radar-page-notice">{record.pageNotice}</p>
        <form action={updateRecordAction} className="radar-editor-form">
          <input name="id" type="hidden" value={String(record.id)} />
          <label>
            <span>记录状态</span>
            <select defaultValue={record.recordStatus} name="recordStatus">
              {option('current', '当前')}
              {option('withdrawn', '已撤回')}
            </select>
          </label>
          <div className="review-row-actions">
            <button className="review-button review-button-primary" type="submit">保存记录状态</button>
          </div>
        </form>
      </section>

      {rating ? (
        <section className="detail-card">
          <h2>公开机器评级与人工复核</h2>
          <form action={updateRatingAction} className="radar-editor-form">
            <input name="recordId" type="hidden" value={String(record.id)} />
            <input name="ratingId" type="hidden" value={String(rating.id)} />
            <div className="radar-metric-grid">
              <div><span>机器核心等级（只读）</span><strong>{rating.coreGrade || '未记录'}</strong></div>
              <div><span>最好 / 可能 / 最坏（只读）</span><strong>{rating.bestGrade || '?'} / {rating.likelyGrade || '?'} / {rating.worstGrade || '?'}</strong></div>
              <div><span>机器置信度（只读）</span><strong>{rating.confidence || '未记录'}</strong></div>
            </div>
            <p className="radar-reasoning-summary">{rating.reasoningSummary}</p>

            <label>
              <span>评级记录状态</span>
              <select defaultValue={rating.recordStatus || 'current'} name="recordStatus">
                {option('current', '当前')}
                {option('withdrawn', '已撤回')}
              </select>
            </label>

            <div className="radar-editor-grid">
              <label>
                <span>人工复核状态</span>
                <select defaultValue={rating.humanReview?.status || 'unreviewed'} name="reviewStatus">
                  {option('unreviewed', '未复核')}
                  {option('reviewed', '已复核')}
                  {option('disputed', '有争议')}
                </select>
              </label>
              <label>
                <span>建议核心等级</span>
                <select defaultValue={rating.humanReview?.proposedCoreGrade || ''} name="proposedCoreGrade">
                  <option value="">无建议</option>
                  {grades.map((grade) => option(grade, `${grade} 级`))}
                </select>
              </label>
            </div>

            <label>
              <span>复核决定</span>
              <input defaultValue={rating.humanReview?.decision || ''} maxLength={1000} name="decision" />
            </label>
            <label>
              <span>内部复核理由</span>
              <textarea defaultValue={rating.humanReview?.reasoning || ''} maxLength={5000} name="reviewReasoning" rows={7} />
            </label>

            <div className="radar-checkbox-grid">
              <label><input defaultChecked={Boolean(rating.humanReview?.blocksAnalysis)} name="blocksAnalysis" type="checkbox" />阻塞后续分析</label>
              <label><input defaultChecked={Boolean(rating.humanReview?.blocksPublication)} name="blocksPublication" type="checkbox" />阻塞公开发布</label>
            </div>

            <div className="review-row-actions">
              <button className="review-button review-button-primary" type="submit">保存评级与复核</button>
            </div>
          </form>
        </section>
      ) : (
        <section className="detail-card">
          <h2>缺少对应评级</h2>
          <p>这条公开研究记录没有对应的 Radar 公开评级。请先通过受控 Release 管线创建评级记录，不在网页中临时补造。</p>
        </section>
      )}
    </main>
  )
}
