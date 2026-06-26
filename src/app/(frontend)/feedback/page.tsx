import Link from 'next/link'

import FeedbackPrompt from '../_components/FeedbackPrompt'

const feedbackTypes = [
  {
    title: '信息错误',
    text: '标题、分级、创作者、机构、说明文字等内容有误。',
  },
  {
    title: '补充证据',
    text: '想补充官方页面、截图说明、平台页面、访谈或其他可核验材料。',
  },
  {
    title: '链接失效',
    text: '来源链接、条目链接、图片或页面跳转出现问题。',
  },
  {
    title: '页面显示问题',
    text: '前台布局、搜索、筛选、详情页互链或移动端显示异常。',
  },
]

export default function FeedbackPage() {
  return (
    <main className="page feedback-page">
      <section className="page-heading collection-heading">
        <p className="eyebrow">反馈与纠错</p>
        <h1>反馈与纠错</h1>
        <p>如果发现资料错误、证据不足、链接失效或页面显示异常，可以通过这里提交反馈。</p>
        <div className="collection-actions">
          <Link className="back-link" href="/browse">返回资料库</Link>
          <Link className="back-link" href="/search">搜索条目</Link>
        </div>
      </section>

      <FeedbackPrompt />

      <section className="feedback-grid" aria-label="反馈类型">
        {feedbackTypes.map((item) => (
          <article className="detail-card feedback-type-card" key={item.title}>
            <h2>{item.title}</h2>
            <p>{item.text}</p>
          </article>
        ))}
      </section>

      <section className="detail-card feedback-guide">
        <h2>建议附带的信息</h2>
        <ul>
          <li>相关条目名称或页面链接。</li>
          <li>你认为需要修正或补充的具体位置。</li>
          <li>可核验的来源链接、截图说明或其他材料。</li>
          <li>如果是页面显示问题，请说明浏览器、设备和复现步骤。</li>
        </ul>
      </section>
    </main>
  )
}
