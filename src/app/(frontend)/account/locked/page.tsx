import Link from 'next/link'

import { publicFeedbackChannels } from '@/lib/deploymentProfile'

export default function LockedAccountPage() {
  const channels = publicFeedbackChannels()
  const emailHref = channels.email
    ? `mailto:${channels.email}?subject=${encodeURIComponent('Baihepailei 账户封停申诉')}`
    : ''

  return (
    <main className="page account-page">
      <section className="account-card account-locked-card detail-card">
        <p className="eyebrow">账户状态</p>
        <h1>此账户已被封停</h1>
        <p>封停后无法登录、发表评论、管理个人列表或提交站内反馈。现有登录会话也会立即失效。</p>
        <p className="muted">如果你认为这是误判，请通过站点公开反馈渠道说明注册邮箱与申诉理由。请不要在公开内容中发送密码或登录验证码。</p>
        <div className="account-actions">
          {emailHref ? <a className="result-link" href={emailHref}>通过邮件申诉</a> : null}
          {channels.externalForm ? <a className="back-link" href={channels.externalForm} rel="noreferrer" target="_blank">打开外部反馈表单</a> : null}
          <Link className="back-link" href="/">返回首页</Link>
        </div>
      </section>
    </main>
  )
}
