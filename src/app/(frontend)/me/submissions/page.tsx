import configPromise from '@payload-config'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { canonicalContentUrl } from '../../_lib/content-identity'

export const dynamic = 'force-dynamic'

type Relation = string | number | { id?: string | number; title?: string }
type SubmissionDoc = {
  id: string | number
  feedbackType?: string
  targetTitle?: string
  workflowStatus?: string
  reviewNote?: string
  linkedWork?: Relation
  createdAt?: string
  updatedAt?: string
}

const statusLabels: Record<string, string> = {
  pending: '待审核',
  triaging: '核查中',
  needs_information: '需要补充材料',
  accepted: '已采纳',
  rejected: '未采纳',
  archived: '已归档',
}

const typeLabels: Record<string, string> = {
  radar_evidence: '人工排雷 / 新证据',
  rating_correction: '分级或规则纠错',
  new_work: '新增作品建议',
  content_correction: '资料错误',
  broken_link: '链接失效',
  display_problem: '页面问题',
  other: '其他',
}

function relationID(value: Relation | undefined) {
  if (value && typeof value === 'object') return String(value.id || '')
  return value === undefined || value === null ? '' : String(value)
}

function formatDate(value?: string) {
  if (!value) return '时间未记录'
  try {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return value
  }
}

export default async function MemberSubmissionsPage() {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent('/me/submissions')}`)

  const userID = (auth.user as { id?: string | number }).id
  if (userID === undefined || userID === null) throw new Error('当前账户缺少有效用户 ID。')

  const result = await payload.find({
    collection: 'feedback-submissions',
    depth: 1,
    limit: 100,
    page: 1,
    pagination: false,
    overrideAccess: true,
    sort: '-updatedAt',
    where: { submitter: { equals: userID } },
  })
  const submissions = result.docs as unknown as SubmissionDoc[]

  return (
    <main className="page account-page">
      <section className="account-card detail-card">
        <p className="eyebrow">账户 · 我的提交</p>
        <h1>提交记录与补充材料</h1>
        <p className="muted">待审核的表单可以随时修改；站务要求补充材料时，直接编辑原记录并重新提交，不需要从空表单开始。核查中和已处理记录保留在列表里供你查看。</p>
        <div className="account-actions">
          <Link href="/account">返回账户</Link>
          <Link href="/feedback">提交人工排雷</Link>
          <Link href="/feedback?type=new_work">提交新作品</Link>
        </div>
      </section>

      <section className="review-list" aria-label="我的提交列表">
        {submissions.map((submission) => {
          const status = String(submission.workflowStatus || 'pending')
          const editable = status === 'pending' || status === 'needs_information'
          const workID = relationID(submission.linkedWork)
          return (
            <article className="review-row" key={submission.id}>
              <header className="review-row-header">
                <div className="review-row-title">
                  <h2>{submission.targetTitle || '未命名提交'}</h2>
                  <small>反馈 #{submission.id} · {typeLabels[submission.feedbackType || 'other'] || submission.feedbackType} · 更新于 {formatDate(submission.updatedAt || submission.createdAt)}</small>
                </div>
                <span className={`review-row-chip${status === 'needs_information' ? ' review-row-chip-warning' : ''}`}>{statusLabels[status] || status}</span>
              </header>
              {submission.reviewNote ? <div className="review-safety-note"><strong>站务说明</strong><p>{submission.reviewNote}</p></div> : null}
              <div className="review-row-actions">
                {editable ? <Link className="review-button review-button-primary" href={`/me/submissions/${submission.id}`}>{status === 'needs_information' ? '补充材料并重新提交' : '修改提交'}</Link> : null}
                {workID ? <Link className="review-link" href={canonicalContentUrl('works', workID)}>查看关联作品</Link> : null}
              </div>
            </article>
          )
        })}
        {submissions.length === 0 ? <section className="review-empty"><h2>还没有提交记录</h2><p>提交排雷材料或新作品建议后，会保存在这里。</p></section> : null}
      </section>
    </main>
  )
}
