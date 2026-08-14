import Link from 'next/link'

import { publicFeedbackChannels } from '@/lib/deploymentProfile'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

const feedbackTypes = [
  { title: '发现线索', text: '提供可能值得纳入发现队列的作品、版本、人物或外部身份线索。' },
  { title: '研究材料', text: '提供官方页面、原作位置、访谈、截图出处或其他可核验来源。' },
  { title: '规则与结论纠错', text: '指出规则解释或未来正式结论可能需要重新研究的具体理由。' },
  { title: '页面与链接问题', text: '报告失效链接、Work 身份错误或页面显示异常。' },
]

const newWorkDataTypes = [
  { title: '标题与别名', text: '提供显示标题、原始标题和常见译名；不知道的字段可以留空。' },
  { title: '作品分类', text: '提供作品大类、具体类型和形态；不确定时明确写“不确定”。' },
  { title: '日期与简介', text: '提供首次发行时间、故事前提、主要角色和基本设定。' },
  { title: '来源与外部身份', text: '提供作者、制作方、平台、外部数据库 ID、官方网站等可核验来源。' },
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
          <p className="eyebrow">{isNewWork ? '新作品发现线索' : '发现与纠错线索'}</p>
          <h1>{isNewWork ? '向新流程提议一个作品' : '把可核验线索交给新流程'}</h1>
          <p>这里接收的内容只是一条隔离的发现输入，不会直接写入正式 WorkLineage，也不会自动生成研究、评估或评级。后续必须由新的发现—研究—评估流程创建全新对象。</p>
        </div>
        <div className="collection-actions">
          <Link className="back-link" href="/browse">返回资料库</Link>
          {isNewWork ? <Link className="back-link" href="/feedback">改为提交一般线索</Link> : <Link className="back-link" href="/feedback?type=new_work">提交新作品线索</Link>}
        </div>
      </section>

      <section className="detail-card review-safety-note" role="status">
        <strong>旧站内账户表单已经退役</strong>
        <p>不保留旧账户、个人提交箱或 Payload 写入桥。当前只开放下方独立渠道；新的正式写入端会在 13 区块约束下单独实现和验证。</p>
      </section>

      {hasChannel ? (
        <section>
          <div className="collection-heading">
            <h2>提交发现线索</h2>
            <p className="muted">所有渠道都只进入待处理线索，不会覆盖正式数据，也不会把旧评级带回新库。</p>
          </div>
          <div className="feedback-channel-grid">
            {emailHref ? (
              <article className="detail-card feedback-channel-card">
                <p className="eyebrow">Email</p><h2>发送邮件</h2><p>适合少量文字、来源链接和需要继续沟通的材料。</p><a className="result-link" href={emailHref}>写一封线索邮件</a>
              </article>
            ) : null}
            {channels.externalForm ? (
              <article className="detail-card feedback-channel-card">
                <p className="eyebrow">External form</p><h2>独立材料表单</h2><p>适合结构化线索或图片材料；它与正式数据库物理隔离。</p><a className="result-link" href={channels.externalForm} rel="noreferrer" target="_blank">打开材料表单</a>
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
          <p>站务配置独立邮箱、外部表单或问题单后，这里才会出现入口。未配置时不会回退到旧数据库。</p>
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
        <h2>进入新流程前的最低要求</h2>
        <ul>
          <li>只写确定的信息；不知道就保留未知，不猜标题、身份或评级。</li>
          <li>尽量提供可追溯的官方页面、原作位置或可靠资料链接。</li>
          <li>发现、研究和评估可以并行，但任何线索都不能直接晋升为正式结论。</li>
          <li>是否与现有 Work 重复由新流程按精确身份与证据判断，不做模糊兼容。</li>
        </ul>
      </section>
    </main>
  )
}
