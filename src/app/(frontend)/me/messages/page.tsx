import configPromise from '@payload-config'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

export const dynamic = 'force-dynamic'

type Relation = string | number | { id?: string | number; title?: string }
type FeedbackDoc = {
  id: string | number
  feedbackType?: string
  targetTitle?: string
  workflowStatus?: string
  reviewNote?: string
  reviewedAt?: string
  updatedAt?: string
  linkedWork?: Relation
}
type CommentDoc = {
  id: string | number
  author?: Relation
  authorName?: string
  body?: string
  parentComment?: Relation
  targetCollection?: string
  targetSlug?: string
  targetTitle?: string
  moderationStatus?: string
  createdAt?: string
}
type MessageItem = {
  key: string
  kind: 'feedback' | 'comment'
  title: string
  body: string
  meta: string
  date: string
  href?: string
  actionLabel?: string
}

const feedbackStatus: Record<string, { title: string; meta: string }> = {
  triaging: { title: '站务已开始核查你的建议', meta: '核查中' },
  needs_information: { title: '站务需要你补充材料', meta: '需要补充材料' },
  accepted: { title: '你的建议已经被站务采纳', meta: '已采纳' },
  rejected: { title: '你的建议未被采纳', meta: '未采纳' },
  archived: { title: '这份建议已经归档', meta: '已归档' },
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

function publicCommentHref(comment: CommentDoc) {
  const collection = String(comment.targetCollection || '').trim()
  const slug = String(comment.targetSlug || '').trim()
  if (!collection || !slug) return undefined
  return `/${encodeURIComponent(collection)}/${encodeURIComponent(slug)}`
}

export default async function AccountMessagesPage() {
  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect(`/account/login?redirect=${encodeURIComponent('/me/messages')}`)

  const userID = (auth.user as { id?: string | number }).id
  if (userID === undefined || userID === null) throw new Error('当前账户缺少有效用户 ID。')

  const [feedbackResult, ownCommentResult] = await Promise.all([
    payload.find({
      collection: 'feedback-submissions',
      depth: 1,
      limit: 100,
      page: 1,
      pagination: false,
      overrideAccess: true,
      sort: '-updatedAt',
      where: { submitter: { equals: userID } },
    }),
    payload.find({
      collection: 'comments',
      depth: 0,
      limit: 200,
      page: 1,
      pagination: false,
      overrideAccess: true,
      sort: '-createdAt',
      where: { author: { equals: userID } },
    }),
  ])

  const feedbacks = feedbackResult.docs as unknown as FeedbackDoc[]
  const ownComments = ownCommentResult.docs as unknown as CommentDoc[]
  const rootIDs = ownComments.filter((comment) => !relationID(comment.parentComment)).map((comment) => comment.id)
  const replyResult = rootIDs.length
    ? await payload.find({
        collection: 'comments',
        depth: 0,
        limit: 200,
        page: 1,
        pagination: false,
        overrideAccess: true,
        sort: '-createdAt',
        where: {
          and: [
            { parentComment: { in: rootIDs } },
            { author: { not_equals: userID } },
            { moderationStatus: { in: ['approved', 'pending'] } },
          ],
        },
      })
    : { docs: [] }
  const replies = replyResult.docs as unknown as CommentDoc[]

  const messages: MessageItem[] = []
  for (const feedback of feedbacks) {
    const status = feedbackStatus[String(feedback.workflowStatus || '')]
    if (!status) continue
    const workID = relationID(feedback.linkedWork)
    const needsMore = feedback.workflowStatus === 'needs_information'
    messages.push({
      key: `feedback:${feedback.id}:${feedback.workflowStatus}`,
      kind: 'feedback',
      title: `${status.title}：${feedback.targetTitle || '未命名提交'}`,
      body: String(feedback.reviewNote || (needsMore ? '请根据站务说明补充可核验来源、版本或具体情节位置。' : '站务没有填写额外说明。')),
      meta: `反馈 #${feedback.id} · ${status.meta}`,
      date: String(feedback.reviewedAt || feedback.updatedAt || ''),
      ...(workID ? { href: `/works/${encodeURIComponent(workID)}`, actionLabel: '查看关联作品' } : needsMore ? { href: feedback.feedbackType === 'new_work' ? '/feedback?type=new_work' : '/feedback', actionLabel: '补充并重新提交' } : {}),
    })
  }

  for (const reply of replies) {
    messages.push({
      key: `comment:${reply.id}`,
      kind: 'comment',
      title: `${reply.authorName || '一位用户'}回复了你在《${reply.targetTitle || '站内内容'}》下的评论`,
      body: String(reply.body || '回复内容为空。'),
      meta: `评论回复 #${reply.id}`,
      date: String(reply.createdAt || ''),
      href: publicCommentHref(reply),
      actionLabel: '前往评论区',
    })
  }

  messages.sort((left, right) => right.date.localeCompare(left.date))

  return (
    <main className="page account-page">
      <section className="account-card detail-card">
        <p className="eyebrow">账户 · 站务消息</p>
        <h1>消息与提醒</h1>
        <p className="muted">这里汇总评论回复，以及站务对你提交的排雷材料、新作品建议和纠错作出的处理。消息直接从现有审核记录生成，不会影响正式作品数据。</p>
        <div className="account-actions"><Link href="/account">返回账户</Link><Link href="/feedback">提交人工排雷</Link><Link href="/feedback?type=new_work">提交新作品</Link></div>
      </section>

      <section className="review-list" aria-label="站务消息列表">
        {messages.map((message) => (
          <article className="review-row" key={message.key}>
            <header className="review-row-header">
              <div className="review-row-title"><h2>{message.title}</h2><small>{message.meta} · {formatDate(message.date)}</small></div>
              <span className="review-row-chip">{message.kind === 'comment' ? '评论回复' : '站务处理'}</span>
            </header>
            <p>{message.body}</p>
            {message.href ? <div className="review-row-actions"><Link className="review-link" href={message.href}>{message.actionLabel || '查看'}</Link></div> : null}
          </article>
        ))}
        {messages.length === 0 ? <section className="review-empty"><h2>暂时没有新消息</h2><p>评论被回复，或站务处理你的提交后，会出现在这里。</p></section> : null}
      </section>
    </main>
  )
}
