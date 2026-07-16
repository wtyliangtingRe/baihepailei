import Link from 'next/link'

import FeedbackForm from '../_components/FeedbackForm'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

const feedbackTypes = [
  { title: '人工排雷', text: '补充男性亲密接触、路线污染、NTR、欺诈、作者言论等具体证据。' },
  { title: '规则与等级纠错', text: '指出当前等级、决定性规则或页面提示可能不准确。' },
  { title: '资料补充', text: '提供官方页面、原作章节、访谈、截图出处或其他可核验材料。' },
  { title: '页面与链接问题', text: '报告失效链接、条目身份错误或页面显示异常。' },
]

export default async function FeedbackPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  return (
    <main className="page feedback-page">
      <section className="page-heading collection-heading">
        <div>
          <p className="eyebrow">反馈与纠错</p>
          <h1>把新的人工排雷材料交给网站</h1>
          <p>用户提交只会进入待审核队列，不会直接覆盖正式评级。编辑核验来源后才能采纳。</p>
        </div>
        <div className="collection-actions">
          <Link className="back-link" href="/browse">返回资料库</Link>
          <Link className="back-link" href="/account">我的账户</Link>
        </div>
      </section>

      <FeedbackForm
        initialCollection={first(params.collection) || 'works'}
        initialPageUrl={first(params.page)}
        initialSlug={first(params.slug)}
        initialTitle={first(params.title)}
      />

      <section className="feedback-grid" aria-label="反馈类型">
        {feedbackTypes.map((item) => (
          <article className="detail-card feedback-type-card" key={item.title}>
            <h2>{item.title}</h2>
            <p>{item.text}</p>
          </article>
        ))}
      </section>

      <section className="detail-card feedback-guide">
        <h2>什么样的材料更容易被采纳？</h2>
        <ul>
          <li>明确到人物、章节、路线、版本或结局。</li>
          <li>提供可追溯的官方页面、原作位置或可靠资料链接。</li>
          <li>说明建议对应的 S–X 规则代码，以及是否存在相反证据。</li>
          <li>涉及剧透时勾选剧透提示，避免审核时误公开。</li>
        </ul>
      </section>
    </main>
  )
}
