import Link from 'next/link'

import { publicFeedbackChannels, publicMediaMode } from '@/lib/deploymentProfile'

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

const newWorkDataTypes = [
  { title: '标题与别名', text: '填写显示标题、原始标题，以及中文、日文、英文和其他常见译名。' },
  { title: '作品分类', text: '选择作品大类、具体类型和形态；不确定的项目可以保留为未知。' },
  { title: '日期与简介', text: '提供首次发行时间、日期精度、故事前提、主要角色和基本设定。' },
  { title: '来源与外部身份', text: '记录作者、制作方、平台、外部数据库 ID、官方网站和其他可核验来源。' },
]

export default async function FeedbackPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const channels = publicFeedbackChannels()
  const mediaMode = publicMediaMode()
  const targetTitle = first(params.title)
  const targetWorkID = first(params.workId)
  const requestedType = first(params.type)
  const isNewWork = requestedType === 'new_work'
  const emailSubject = encodeURIComponent(targetTitle ? `Baihepailei 反馈：${targetTitle}` : 'Baihepailei 条目反馈')
  const emailBody = encodeURIComponent([
    targetTitle ? `相关条目：${targetTitle}` : '',
    targetWorkID ? `站内作品 ID：${targetWorkID}` : '',
    '',
    '希望核实的结论：',
    '',
    '证据来源：',
  ].filter((line, index, values) => line || (index > 0 && values[index - 1])).join('\n'))
  const emailHref = channels.email ? `mailto:${channels.email}?subject=${emailSubject}&body=${emailBody}` : ''
  const displayedTypes = isNewWork ? newWorkDataTypes : feedbackTypes

  return (
    <main className="page feedback-page">
      <section className="page-heading collection-heading">
        <div>
          <p className="eyebrow">{isNewWork ? '新作品申请' : '反馈与纠错'}</p>
          <h1>{isNewWork ? '向资料库提议一个新作品' : '把新的人工排雷材料交给网站'}</h1>
          <p>{isNewWork ? '你可以提交一条简短线索，也可以像编辑建档一样尽量完整地填写作品资料。所有内容先进入审核队列；评级、AI Radar、审核状态和发布状态由站内流程决定。' : '用户提交只会进入待审核队列，不会直接覆盖正式评级。编辑核验来源后才能采纳。'}</p>
        </div>
        <div className="collection-actions">
          <Link className="back-link" href="/browse">返回资料库</Link>
          <Link className="back-link" href="/account">我的账户</Link>
          {isNewWork ? <Link className="back-link" href="/feedback">改为提交排雷材料</Link> : <Link className="back-link" href="/feedback?type=new_work">提交新作品</Link>}
        </div>
      </section>

      <FeedbackForm
        initialCollection={first(params.collection) || 'works'}
        initialTitle={first(params.title)}
        initialWorkId={targetWorkID}
        initialType={requestedType}
      />

      <section className="detail-card feedback-guide">
        <h2>图片与流量策略</h2>
        {mediaMode === 'enhanced' ? (
          <p>当前是增强媒体版本，可以显示随包分发的封面和材料图片。站内账号表单仍以文字和链接为主；如需上传图片，请使用下方已配置的外部材料表单。</p>
        ) : (
          <p>当前是低流量正式版：不显示作品封面，也不接收图片附件。请提交文字、章节位置和可核验链接；这不会影响人工核验的完整性。</p>
        )}
      </section>

      {(emailHref || channels.externalForm || channels.issueTracker) ? (
        <section>
          <div className="collection-heading">
            <h2>不登录也能反馈</h2>
            <p className="muted">这些渠道适合作为账号表单的备用入口；所有内容进入人工核验，不会直接改变正式评级。</p>
          </div>
          <div className="feedback-channel-grid">
            {emailHref ? (
              <article className="detail-card feedback-channel-card">
                <p className="eyebrow">Email</p><h2>发送邮件</h2><p>适合少量文字、来源链接和需要继续沟通的材料。低流量正式版建议只附链接，不直接附大图。</p><a className="result-link" href={emailHref}>写一封反馈邮件</a>
              </article>
            ) : null}
            {channels.externalForm ? (
              <article className="detail-card feedback-channel-card">
                <p className="eyebrow">External form</p><h2>外部材料表单</h2><p>可由 Google Forms、Tally 等服务承接匿名反馈；增强分发版可在这里配置图片上传。</p><a className="result-link" href={channels.externalForm} rel="noreferrer" target="_blank">打开材料表单</a>
              </article>
            ) : null}
            {channels.issueTracker ? (
              <article className="detail-card feedback-channel-card">
                <p className="eyebrow">Issue tracker</p><h2>公开问题单</h2><p>适合页面错误、失效链接和可公开讨论的资料问题；涉及剧透或隐私时不要使用。</p><a className="result-link" href={channels.issueTracker} rel="noreferrer" target="_blank">提交公开问题</a>
              </article>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="feedback-grid" aria-label={isNewWork ? '可提交的新作品资料' : '反馈类型'}>
        {displayedTypes.map((item) => (
          <article className="detail-card feedback-type-card" key={item.title}>
            <h2>{item.title}</h2>
            <p>{item.text}</p>
          </article>
        ))}
      </section>

      <section className="detail-card feedback-guide">
        <h2>{isNewWork ? '什么样的新作品申请更容易建档？' : '什么样的材料更容易被采纳？'}</h2>
        <ul>
          {isNewWork ? <li>填写你确定的字段即可；掌握完整资料时，可以尽量补齐标题、类型、日期、简介、别名和外部身份。</li> : <li>明确到人物、章节、路线、版本或结局。</li>}
          <li>提供可追溯的官方页面、原作位置或可靠资料链接。</li>
          <li>{isNewWork ? '说明是否可能与现有条目重复；编辑会在建档前再次检查。' : '说明建议对应的 S–X 规则代码，以及是否存在相反证据。'}</li>
          <li>{isNewWork ? '不要替 AI 填写评级或规则结论；这些字段不会出现在新作品申请里。' : '涉及剧透时勾选剧透提示，避免审核时误公开。'}</li>
        </ul>
      </section>
    </main>
  )
}
