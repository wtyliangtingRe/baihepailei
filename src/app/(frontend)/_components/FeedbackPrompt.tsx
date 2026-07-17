import Link from 'next/link'

import type { DetailItem } from '../_lib/detail-index'
import type { SearchItem } from '../_lib/search-index'

type FeedbackItem = Pick<DetailItem | SearchItem, 'collection' | 'recordId' | 'title'>

export function feedbackPageUrl(item?: FeedbackItem) {
  if (!item) return '/feedback'
  const params = new URLSearchParams({
    collection: item.collection,
    title: item.title,
  })
  if (item.collection === 'works' && item.recordId) params.set('workId', item.recordId)
  return `/feedback?${params.toString()}`
}

export default function FeedbackPrompt({ item }: { item?: FeedbackItem }) {
  return (
    <section className="page feedback-prompt-shell" aria-label="反馈与纠错">
      <div className="detail-card feedback-prompt">
        <div>
          <p className="eyebrow">反馈与纠错</p>
          <h2>发现新雷点或想补充证据？</h2>
          <p className="muted">注册用户可以提交建议等级、命中规则、来源链接和详细说明，材料会进入人工审核队列。</p>
        </div>
        <div className="feedback-actions">
          <Link className="result-link" href={feedbackPageUrl(item)}>提交人工材料</Link>
          <Link className="back-link" href="/feedback">查看提交说明</Link>
        </div>
      </div>
    </section>
  )
}
