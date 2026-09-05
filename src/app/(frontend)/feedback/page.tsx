import Link from 'next/link'

import {
  DEFAULT_PUBLIC_FEEDBACK_ISSUE_URL,
  publicFeedbackChannels,
} from '@/lib/deploymentProfile'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined, maxLength = 160) {
  const candidate = Array.isArray(value) ? value[0] || '' : value || ''
  return candidate.trim().slice(0, maxLength)
}

function workID(value: string | string[] | undefined): string {
  const candidate = first(value, 24)
  return /^\d{1,12}$/.test(candidate) ? candidate : ''
}

function issueSubmissionHref(
  base: string,
  options: { isNewWork: boolean; targetTitle: string; targetWorkID: string },
): string {
  if (!base) return ''

  try {
    const url = new URL(base)
    if (url.protocol !== 'https:') return ''

    if (url.hostname === 'github.com' && /\/issues\/new\/?$/.test(url.pathname)) {
      if (!url.searchParams.has('template')) {
        url.searchParams.set(
          'template',
          options.isNewWork ? 'new-work.yml' : 'work-correction.yml',
        )
      }
      url.searchParams.set(
        'title',
        options.isNewWork
          ? `[新作品] ${options.targetTitle}`.trim()
          : `[作品纠错] ${options.targetTitle}${options.targetWorkID ? `（Work ${options.targetWorkID}）` : ''}`.trim(),
      )
      if (options.targetWorkID) url.searchParams.set('work_id', options.targetWorkID)
      if (options.targetTitle) url.searchParams.set('work_title', options.targetTitle)
    }

    return url.toString()
  } catch {
    return ''
  }
}

function anonymousSubmissionHref(base: string, workId: string, title: string, isNewWork: boolean): string {
  if (!base) return ''
  try {
    const url = new URL(base)
    if (url.protocol !== 'https:') return ''
    if (workId) url.searchParams.set('workId', workId)
    if (title) url.searchParams.set('title', title)
    if (isNewWork) url.searchParams.set('type', 'new_work')
    return url.toString()
  } catch { return '' }
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
  const targetWorkID = workID(params.workId)
  const isNewWork = first(params.type, 32) === 'new_work'
  const submissionKind = isNewWork ? '推荐收录新作品' : '作品资料补充与纠错'
  const emailSubject = encodeURIComponent(
    targetTitle ? `Baihepailei ${submissionKind}：${targetTitle}` : `Baihepailei ${submissionKind}`,
  )
  const emailBody = encodeURIComponent([
    `提交类型：${submissionKind}`,
    targetTitle ? `相关条目：${targetTitle}` : '',
    targetWorkID ? `正式 Work ID：${targetWorkID}` : '',
    '',
    '希望补充或纠正的内容：',
    '',
    '可核验来源：',
  ].filter(Boolean).join('\n'))
  const emailHref = channels.email ? `mailto:${channels.email}?subject=${emailSubject}&body=${emailBody}` : ''
  const issueHref = issueSubmissionHref(channels.issueTracker, {
    isNewWork,
    targetTitle,
    targetWorkID,
  })
  const anonymousHref = anonymousSubmissionHref(channels.externalForm, targetWorkID, targetTitle, isNewWork)
  const displayedTypes = isNewWork ? newWorkDataTypes : feedbackTypes
  const hasChannel = Boolean(issueHref || emailHref || channels.externalForm)
  const usesDefaultPrivateIssueTracker = channels.issueTracker === DEFAULT_PUBLIC_FEEDBACK_ISSUE_URL

  return (
    <main className="page feedback-page">
      <section className="page-heading collection-heading">
        <div>
          <p className="eyebrow">{submissionKind}</p>
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
            <h2>填写并提交线索</h2>
            <p className="muted">提交内容只进入待核实队列，确认作品对应与来源后才会更新公开页面。</p>
          </div>
          <div className="feedback-channel-grid">
            <article className="detail-card feedback-channel-card feedback-channel-primary">
              <p className="eyebrow">普通访客</p>
              <h2>匿名文字表单</h2>
              <p>无需登录，填写简短说明和最多三条来源链接。不接收图片或任何附件。</p>
              {anonymousHref ? (
                <a className="result-link" href={anonymousHref} rel="noreferrer" target="_blank">打开匿名投稿表 ↗</a>
              ) : <p className="muted">匿名入口暂未开放。</p>}
              <small>线索先进入独立待审区，核实后才会更新作品资料。</small>
            </article>
            {issueHref ? (
              <article className="detail-card feedback-channel-card">
                <p className="eyebrow">GitHub 贡献者</p>
                <h2>投稿与图片证据</h2>
                <p>
                  可附 PNG、JPG、JPEG 或 WebP 截图，并说明出处。需要登录 GitHub，但不用注册或绑定本站账号。
                  请每张尽量压缩到 2 MB 以内，且不超过 GitHub 的 10 MB 限制。
                </p>
                <a className="result-link" href={issueHref} rel="noreferrer" target="_blank">
                  {isNewWork ? '打开新作品提交表 ↗' : '打开作品补充与纠错表 ↗'}
                </a>
                <small>
                  {usesDefaultPrivateIssueTracker
                    ? '此入口目前供已有仓库访问权限的协作者使用，公开投稿入口尚未开放。'
                    : '公开投稿仓库中的文字和图片均可能被任何人查看，请勿上传私人或未获公开授权的材料。'}
                </small>
              </article>
            ) : null}
            {emailHref ? (
              <article className="detail-card feedback-channel-card">
                <p className="eyebrow">Email</p>
                <h2>发送邮件</h2>
                <p>适合少量文字、来源链接和需要继续沟通的材料。</p>
                <a className="result-link" href={emailHref}>写一封线索邮件</a>
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

      <section className="detail-card feedback-security-note" role="note">
        <h2>提交前请留意</h2>
        <p>
          所有线索均需人工核实，提交不会自动更改作品资料或评级。匿名表单仅收文字；
          GitHub 图片请注明作品版本和原作位置，不要附视频、压缩包或文档。
          请勿提交私人联系方式、未公开材料或无权公开的文件。
        </p>
      </section>

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
