'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'

import { logoutAccount } from '../_actions/account'

type AccountUser = {
  id: string
  email?: string
  displayName?: string
  role?: string
}

const roleLabels: Record<string, string> = {
  owner: '最高领袖',
  admin: '管理员',
  editor: '编辑',
  member: '注册用户',
}

const staffRoles = new Set(['owner', 'admin', 'editor'])

export default function AccountClient() {
  const [user, setUser] = useState<AccountUser | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [state, setState] = useState<'loading' | 'guest' | 'idle' | 'saving' | 'saved' | 'error'>('loading')

  useEffect(() => {
    let active = true
    fetch('/api/account/session', { cache: 'no-store', credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('account-fetch-failed')
        return response.json()
      })
      .then((payload) => {
        if (!active) return
        const nextUser = payload?.user || null
        setUser(nextUser)
        setDisplayName(nextUser?.displayName || '')
        setState(nextUser ? 'idle' : 'guest')
      })
      .catch(() => {
        if (active) setState('error')
      })
    return () => {
      active = false
    }
  }, [])

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return
    setState('saving')
    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: displayName.trim() }),
      })
      if (!response.ok) throw new Error('profile-save-failed')
      const payload = await response.json()
      setUser(payload?.doc || payload)
      setState('saved')
    } catch {
      setState('error')
    }
  }

  async function logout() {
    const result = await logoutAccount()
    if (result.ok) {
      window.location.assign('/')
      return
    }
    setState('error')
  }

  if (state === 'loading') return <section className="account-card detail-card"><p className="muted">正在读取账户……</p></section>
  if (state === 'guest') {
    return (
      <section className="account-card detail-card">
        <p className="eyebrow">用户账户</p>
        <h1>登录后使用社区功能</h1>
        <p className="muted">注册后可以发表评论、管理“我的列表”、接收站务消息、提交人工排雷材料，也可以提议收录新的作品。</p>
        <div className="account-actions">
          <Link className="result-link" href="/account/login">登录</Link>
          <Link className="back-link" href="/account/register">注册</Link>
        </div>
      </section>
    )
  }
  if (!user || state === 'error') return <section className="account-card detail-card"><p className="account-message account-message-error">账户功能暂时不可用，请稍后再试。</p></section>

  const isStaff = staffRoles.has(user.role || '')
  const mayManagePersonnel = user.role === 'owner' || user.role === 'admin'
  const mayUsePayload = user.role === 'owner' || user.role === 'admin'
  return (
    <div className="account-dashboard">
      <section className="account-card detail-card">
        <p className="eyebrow">我的账户</p>
        <h1>{user.displayName || user.email || '注册用户'}</h1>
        <dl className="account-meta">
          <div><dt>登录邮箱</dt><dd>{user.email || '-'}</dd></div>
          <div><dt>身份</dt><dd>{roleLabels[user.role || 'member'] || user.role}</dd></div>
        </dl>
        <form className="account-form" onSubmit={saveProfile}>
          <label>
            显示名
            <input maxLength={50} minLength={2} onChange={(event) => setDisplayName(event.target.value)} required value={displayName} />
          </label>
          <button disabled={state === 'saving'} type="submit">{state === 'saving' ? '保存中……' : '保存资料'}</button>
        </form>
        {state === 'saved' ? <p className="account-message">资料已保存。</p> : null}
        <div className="account-actions">
          <Link href="/account/forgot-password">通过邮件修改密码</Link>
          <button className="account-link-button" onClick={logout} type="button">退出登录</button>
        </div>
      </section>

      <section className="account-feature-grid" aria-label="账户功能">
        <Link className="detail-card account-feature" href="/me/messages"><strong>站务消息</strong><span>查看评论回复，以及建议被核查、采纳、驳回或要求补充材料的通知。</span></Link>
        <Link className="detail-card account-feature" href="/me/submissions"><strong>我的提交</strong><span>查看、修改待审核表单，并在站务要求补充材料时继续编辑原记录。</span></Link>
        <Link className="detail-card account-feature" href="/me/lists"><strong>我的列表</strong><span>想看、在看、已看、喜欢、避雷与待复核。</span></Link>
        <Link className="detail-card account-feature" href="/feedback"><strong>提交人工排雷</strong><span>补充规则、等级建议、来源链接与证据说明。</span></Link>
        <Link className="detail-card account-feature" href={isStaff ? '/me/studio' : '/feedback?type=new_work'}><strong>{isStaff ? '站内内容管理' : '提交新作品'}</strong><span>{isStaff ? '搜索、创建、编辑、隐藏和恢复正式或临时作品。' : '提交新作品申请；采纳前可在“我的提交”中继续修改。'}</span></Link>
        {isStaff ? <Link className="detail-card account-feature" href="/me/review/content"><strong>AI 评级人工复核</strong><span>快速复核已有受控 AI 评级、但尚无人工评级的作品。</span></Link> : null}
        {isStaff ? <Link className="detail-card account-feature" href="/me/review/feedback"><strong>用户反馈审核</strong><span>先开始核查，再在独立页面采纳、退回、归档或要求补充材料。</span></Link> : null}
        {mayManagePersonnel ? <Link className="detail-card account-feature" href="/me/personnel"><strong>人员与封停管理</strong><span>任命管理员或编辑，封停违规账户并查看锁定状态。</span></Link> : null}
        {mayUsePayload ? <Link className="detail-card account-feature" href="/admin"><strong>Payload 高级维护</strong><span>仅最高领袖和管理员使用；处理危险操作、底层关系与永久删除。</span></Link> : null}
      </section>
    </div>
  )
}
