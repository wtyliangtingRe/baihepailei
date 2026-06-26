import Link from 'next/link'

import type { DetailItem } from '../_lib/detail-index'
import type { SearchItem } from '../_lib/search-index'

type FeedbackItem = Pick<DetailItem | SearchItem, 'collection' | 'title' | 'typeLabel' | 'url'>

const issueBaseUrl = 'https://github.com/wtyliangtingRe/baihepailei/issues/new'

export function feedbackIssueUrl(item?: FeedbackItem) {
  const title = item ? `反馈：${item.title}` : '反馈：资料库内容问题'
  const body = item
    ? [
        `条目：${item.title}`,
        `类型：${item.typeLabel || item.collection}`,
        `链接：${item.url}`,
        '',
        '反馈类型：',
        '- [ ] 信息错误',
        '- [ ] 补充证据',
        '- [ ] 链接失效',
        '- [ ] 页面显示问题',
        '- [ ] 其他',
        '',
        '具体说明：',
        '',
        '可参考材料或链接：',
      ].join('\n')
    : [
        '反馈类型：',
        '- [ ] 信息错误',
        '- [ ] 补充证据',
        '- [ ] 链接失效',
        '- [ ] 页面显示问题',
        '- [ ] 其他',
        '',
        '相关条目或页面链接：',
        '',
        '具体说明：',
        '',
        '可参考材料或链接：',
      ].join('\n')

  const params = new URLSearchParams({
    title,
    body,
  })

  return `${issueBaseUrl}?${params.toString()}`
}

export default function FeedbackPrompt({ item }: { item?: FeedbackItem }) {
  return (
    <section className="page feedback-prompt-shell" aria-label="反馈与纠错">
      <div className="detail-card feedback-prompt">
        <div>
          <p className="eyebrow">反馈与纠错</p>
          <h2>发现问题或想补充证据？</h2>
          <p className="muted">可以提交条目错误、补充证据、报告失效链接或反馈页面显示问题。</p>
        </div>
        <div className="feedback-actions">
          <a className="result-link" href={feedbackIssueUrl(item)} rel="noreferrer" target="_blank">
            提交反馈
          </a>
          <Link className="back-link" href="/feedback">
            查看反馈说明
          </Link>
        </div>
      </div>
    </section>
  )
}
