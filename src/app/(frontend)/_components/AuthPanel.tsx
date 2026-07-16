'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'

import { loginAccount } from '../_actions/account'

type AuthMode = 'login' | 'register' | 'forgot-password' | 'reset-password' | 'verify'

type AuthPanelProps = {
  mode: AuthMode
  redirectTo?: string
  token?: string
}

function safeRedirect(value?: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/account'
  return value
}

async function responseMessage(response: Response) {
  try {
    const payload = await response.json()
    const firstError = Array.isArray(payload?.errors) ? payload.errors[0] : null
    const fieldError = Array.isArray(firstError?.data?.errors) ? firstError.data.errors[0] : null
    const detail = String(fieldError?.message || firstError?.message || payload?.message || '')
    if (/invalid:\s*email/iu.test(detail)) {
      return '邮箱格式无效，或该邮箱已经注册。请换一个尚未注册的邮箱重试。'
    }
    return detail
  } catch {
    return ''
  }
}

export default function AuthPanel({ mode, redirectTo, token = '' }: AuthPanelProps) {
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (mode !== 'verify' || !token) return
    let active = true
    setState('submitting')
    fetch(`/api/users/verify/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(async (response) => {
        if (!active) return
        if (!response.ok) throw new Error(await responseMessage(response) || '验证链接无效或已经过期。')
        setState('success')
        setMessage('邮箱验证完成，现在可以登录。')
      })
      .catch((error) => {
        if (!active) return
        setState('error')
        setMessage(error instanceof Error ? error.message : '验证失败，请重新申请验证邮件。')
      })
    return () => {
      active = false
    }
  }, [mode, token])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState('submitting')
    setMessage('')

    try {
      if ((mode === 'register' || mode === 'reset-password') && password.length < 12) {
        throw new Error('密码至少需要 12 个字符。')
      }
      if ((mode === 'register' || mode === 'reset-password') && password !== confirmPassword) {
        throw new Error('两次输入的密码不一致。')
      }
      if (mode === 'register' && !accepted) throw new Error('请先确认遵守社区规则。')

      if (mode === 'login') {
        const result = await loginAccount({
          email: email.trim().toLowerCase(),
          password,
        })
        if (!result.ok) throw new Error(result.message || '登录失败，请稍后重试。')

        const sessionResponse = await fetch('/api/users/me', {
          cache: 'no-store',
          credentials: 'include',
        })
        const session = sessionResponse.ok ? await sessionResponse.json() : null
        if (!session?.user) {
          throw new Error('登录凭据已通过，但浏览器没有建立会话。请清除本站 Cookie、重启开发服务器后重试。')
        }

        setState('success')
        window.location.assign(safeRedirect(redirectTo))
        return
      }

      let endpoint = '/api/users'
      let body: Record<string, unknown> = {
        email: email.trim().toLowerCase(),
        displayName: displayName.trim(),
        password,
        termsAcceptedAt: new Date().toISOString(),
      }

      if (mode === 'forgot-password') {
        endpoint = '/api/users/forgot-password'
        body = { email: email.trim().toLowerCase() }
      } else if (mode === 'reset-password') {
        endpoint = '/api/users/reset-password'
        body = { token, password }
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const detail = await responseMessage(response)
        throw new Error(detail || '操作没有完成，请检查填写内容后重试。')
      }

      setState('success')
      if (mode === 'register') {
        setMessage('账户已创建。如果部署启用了邮箱验证，请先查收验证邮件；本地关闭验证时可以直接登录。')
        setPassword('')
        setConfirmPassword('')
      } else if (mode === 'forgot-password') {
        setMessage('如果该邮箱已注册，密码重设邮件已经发送。')
      } else if (mode === 'reset-password') {
        setMessage('密码已经重设，可以使用新密码登录。')
      }
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : '操作失败，请稍后重试。')
    }
  }

  if (mode === 'verify') {
    return (
      <section className="account-card detail-card" aria-live="polite">
        <p className="eyebrow">邮箱验证</p>
        <h1>{state === 'submitting' ? '正在验证……' : state === 'success' ? '验证完成' : '验证账户'}</h1>
        <p className={state === 'error' ? 'account-message account-message-error' : 'account-message'}>
          {!token ? '验证链接缺少 token。' : message || '请稍候。'}
        </p>
        <Link className="result-link" href="/account/login">前往登录</Link>
      </section>
    )
  }

  const titles: Record<Exclude<AuthMode, 'verify'>, string> = {
    login: '登录账户',
    register: '注册账户',
    'forgot-password': '找回密码',
    'reset-password': '设置新密码',
  }

  return (
    <section className="account-card detail-card">
      <p className="eyebrow">用户账户</p>
      <h1>{titles[mode]}</h1>
      <form className="account-form" onSubmit={submit}>
        {mode === 'register' ? (
          <label>
            显示名
            <input autoComplete="nickname" maxLength={50} minLength={2} onChange={(event) => setDisplayName(event.target.value)} required value={displayName} />
          </label>
        ) : null}

        {mode !== 'reset-password' ? (
          <label>
            邮箱
            <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </label>
        ) : null}

        {mode === 'login' || mode === 'register' || mode === 'reset-password' ? (
          <label>
            密码
            <input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? undefined : 12} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </label>
        ) : null}

        {mode === 'register' || mode === 'reset-password' ? (
          <label>
            再次输入密码
            <input autoComplete="new-password" minLength={12} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} />
          </label>
        ) : null}

        {mode === 'register' ? (
          <label className="account-check">
            <input checked={accepted} onChange={(event) => setAccepted(event.target.checked)} required type="checkbox" />
            <span>我会友善交流，并理解评论和人工排雷材料需要经过审核。</span>
          </label>
        ) : null}

        <button disabled={state === 'submitting'} type="submit">
          {state === 'submitting' ? '处理中……' : titles[mode]}
        </button>
      </form>

      {message ? <p className={state === 'error' ? 'account-message account-message-error' : 'account-message'}>{message}</p> : null}

      <nav className="account-links" aria-label="账户操作">
        {mode !== 'login' ? <Link href="/account/login">已有账户，去登录</Link> : null}
        {mode !== 'register' ? <Link href="/account/register">注册新账户</Link> : null}
        {mode !== 'forgot-password' ? <Link href="/account/forgot-password">忘记密码</Link> : null}
      </nav>
    </section>
  )
}
