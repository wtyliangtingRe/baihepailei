import configPromise from '@payload-config'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'

import FeedbackForm from '../../../_components/FeedbackForm'

export const dynamic = 'force-dynamic'

type Relation = string | number | { id?: string | number }
type SubmissionDoc = {
  id: string | number
  feedbackType?: string
  targetCollection?: string
  targetTitle?: string
  linkedWork?: Relation
  newWorkMetadata?: unknown
  proposedGrade?: string
  matchedRuleCodes?: Array<{ code?: string }>
  claim?: string
  evidenceSummary?: string
  evidenceLinks?: Array<{ label?: string; url?: string }>
  containsSpoilers?: boolean
  submitter?: Relation
  workflowStatus?: string
  reviewNote?: string
}

function relationID(value: Relation | undefined) {
  if (value && typeof value === 'object') return String(value.id || '')
  return value === undefined || value === null ? '' : String(value)
}

export default async function EditMemberSubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent(`/me/submissions/${id}`)}`)

  const userID = (auth.user as { id?: string | number }).id
  if (userID === undefined || userID === null) throw new Error('当前账户缺少有效用户 ID。')

  let submission: SubmissionDoc
  try {
    submission = await payload.findByID({
      collection: 'feedback-submissions',
      id,
      depth: 1,
      overrideAccess: true,
    }) as unknown as SubmissionDoc
  } catch {
    notFound()
  }

  if (relationID(submission.submitter) !== String(userID)) notFound()
  const status = String(submission.workflowStatus || 'pending')
  if (status !== 'pending' && status !== 'needs_information') {
    return (
      <main className="page feedback-page">
        <section className="detail-card feedback-guide">
          <p className="eyebrow">我的提交 · 反馈 #{submission.id}</p>
          <h1>这份提交当前不能修改</h1>
          <p>只有待审核或站务要求补充材料的记录可以编辑。核查中和已处理记录会继续保留在“我的提交”列表中。</p>
          <div className="feedback-actions"><Link href="/me/submissions">返回我的提交</Link></div>
        </section>
      </main>
    )
  }

  return (
    <main className="page feedback-page">
      <section className="page-heading collection-heading">
        <div>
          <p className="eyebrow">我的提交 · 编辑原记录</p>
          <h1>{status === 'needs_information' ? '补充站务要求的材料' : '修改尚未开始核查的提交'}</h1>
          <p>这里读取的是你最初填写的完整表单。保存后会更新同一条记录，不会清空字段，也不会建立重复申请。</p>
        </div>
        <div className="collection-actions"><Link className="back-link" href="/me/submissions">返回我的提交</Link></div>
      </section>

      <FeedbackForm
        initialCollection={submission.targetCollection || 'works'}
        initialSubmission={{
          id: String(submission.id),
          feedbackType: submission.feedbackType,
          targetTitle: submission.targetTitle,
          linkedWorkId: relationID(submission.linkedWork),
          newWorkMetadata: submission.newWorkMetadata,
          proposedGrade: submission.proposedGrade,
          matchedRuleCodes: (submission.matchedRuleCodes || []).map((item) => String(item.code || '')).filter(Boolean),
          claim: submission.claim,
          evidenceSummary: submission.evidenceSummary,
          evidenceLinks: submission.evidenceLinks,
          containsSpoilers: submission.containsSpoilers,
          workflowStatus: status,
          reviewNote: submission.reviewNote,
        }}
      />
    </main>
  )
}
