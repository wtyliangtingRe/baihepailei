import Link from 'next/link'

import { publicFeedbackChannels } from '@/lib/deploymentProfile'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

const feedbackTypes = [
  { title: '作品资料补充', text: '补充作者、主创、制作机构、发行日期、别名或作品简介。' },
  { title: '排雷材料', text: '提供官方页面、原作位置、访谈、截图出处或其他可核验来源。' },
  { title: '评级与警示纠错', text: '指出等级、具体警示或规则解释可能有误，并说明理由。' },
  { title: '页面与链接问题', text: '报告失效链接、作品对应错误或页面显示异常。' },
]

const newWorkDataTypes = [
  { title: '标题与别名', text: '提供显示标题、原始标题和常见译名；不知道的字段可以留空。' },
  { title: '作品分类', text: '提供作品大类、具体类型和形态；不确定时明确写“不确定”。' },
  { title: '日期与简介', text: '提供首次发行时间、故事前提、主要角色和基本设定。' },
  { title: '作者与制作方', text: '提供作者、主创、制作机构、出版社、平台与官方网站等可核验来源。' },
]

export default async function FeedbackPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const channels = publicFeedbackChannels()
  const targetTitle = first(params.title)
  const targetWorkID = first(params.workId)
  const isNewWork = first(params.type) === 'new_work'
  const emailSubject = encodeURIComponent(targetTitle ? `Baihepailei 线索：${targetTitle}` : 'Baihepailei 发现线索')
  const emailBody = encodeURIComponent([
    targetTitle ? `相关条目：${targetTitle}` : '',
    targetWorkID ? `正式 Work ID：${targetWorkID}` : '',
    '',
    '发现线索或希望核实的问题：',
    '',
    '可核验来源：',
  ].filter((line, index, values) => line || (index > 0 && values[index - 1])).join('\n'))
  const emailHref = channels.email ? `mailto:${channels.email}?subject=${emailSubject}&body=${emailBody}` : ''
  const displayedTypes = isNewWork ? newWorkDataTypes : feedbackTypes
  const hasChannel = Boolean(emailHref || channels.externalForm || channels.issueTracker)

  return (
    <main className="page feedback-page">
      <section className="page-heading collection-heading">
        <div>
          <p className="eyebrow">{isNewWork ? '推荐收录新作品' : '作品资料补充与纠错'}</p>
          <h1>{isNewWork ? '告诉我们还缺哪部作品' : '把可核验资料补到正确作品'}</h1>
          <p>
            如果从作品页进入，这里会自动带上反馈编号 Work ID，方便准确定位。
            线索会先核实再进入公开资料，不会因为一次提交自动改变评级。
          </p>
        </div>
        <div className="collection-actions">
          <Link className="back-link" href="/works">返回作品资料库</Link>
          {isNewWork ? <Link className="back-link" href="/feedback">改为提交一般线索</Link> : <Link className="back-link" href="/feedback?type=new_work">提交新作品线索</Link>}
        </div>
      </section>

      <section className="detail-card review-safety-note" role="status">
        <strong>{targetWorkID ? `正在反馈 Work ${targetWorkID}` : '最好附上作品名或 Work ID'}</strong>
        <p>
          {targetTitle ? `当前作品：${targetTitle}。` : ''}
          请同时提供能核验的来源；不知道的字段可以直接留空。
        </p>
      </section>

      {hasChannel ? (
        <section>
          <div className="collection-heading">
            <h2>提交发现线索</h2>
            <p className="muted">提交内容会先进入待核实队列，确认作品对应与来源后再更新公开页面。</p>
          </div>
          <div className="feedback-channel-grid">
            {emailHref ? (
              <article className="detail-card feedback-channel-card">
                <p className="eyebrow">Email</p><h2>发送邮件</h2><p>适合少量文字、来源链接和需要继续沟通的材料。</p><a className="result-link" href={emailHref}>写一封线索邮件</a>
              </article>
            ) : null}
            {channels.externalForm ? (
              <article className="detail-card feedback-channel-card">
                <p className="eyebrow">External form</p><h2>材料表单</h2><p>适合结构化资料、较多链接或图片材料。</p><a className="result-link" href={channels.externalForm} rel="noreferrer" target="_blank">打开材料表单</a>
              </article>
            ) : null}
            {channels.issueTracker ? (
              <article className="detail-card feedback-channel-card">
                <p className="eyebrow">Issue tracker</p><h2>公开问题单</h2><p>适合页面错误、失效链接和可公开讨论的资料问题；涉及剧透或隐私时不要使用。</p><a className="result-link" href={channels.issueTracker} rel="noreferrer" target="_blank">提交公开问题</a>
              </article>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="detail-card">
          <h2>提交渠道尚未配置</h2>
          <p>站务配置独立邮箱、外部表单或问题单后，这里才会出现可用入口。</p>
        </section>
      )}

      <section className="feedback-grid" aria-label={isNewWork ? '建议提供的新作品线索' : '可提交的线索类型'}>
        {displayedTypes.map((item) => (
          <article className="detail-card feedback-type-card" key={item.title}>
            <h2>{item.title}</h2>
            <p>{item.text}</p>
          </article>
        ))}
      </section>

      <section className="detail-card feedback-guide">
        <h2>怎样提交最容易核实</h2>
        <ul>
          <li>附上作品名或页面中的 Work ID，避免反馈落到同名作品。</li>
          <li>只写确定的信息；不知道就保留未知，不猜作者、剧情或评级。</li>
          <li>尽量提供可追溯的官方页面、原作位置或可靠资料链接。</li>
          <li>涉及结局、NTR、男性关系等内容时，请尽量说明发生位置与版本。</li>
          <li>同名、改编版和不同路线请明确区分；无法确认时直接注明“不确定”。</li>
        </ul>
      </section>
    </main>
  )
}
