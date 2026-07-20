'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type Role = 'owner' | 'admin' | 'editor' | 'member'
type AccountStatus = 'active' | 'suspended'

type PersonnelUser = {
  id: string
  accountStatus: AccountStatus
  displayName?: string
  email?: string
  role: Role
  suspendedAt?: string
  suspensionReason?: string
}

type SessionUser = {
  id: string
  role?: Role
}

const roleLabels: Record<Role, string> = {
  owner: '最高领袖',
  admin: '管理员',
  editor: '编辑',
  member: '注册用户',
}

const assignableByOwner: Role[] = ['admin', 'editor', 'member']
const assignableByAdmin: Role[] = ['editor', 'member']

function normalizeUser(value: unknown): PersonnelUser {
  const user = value as Partial<PersonnelUser> & { id?: string | number }
  return {
    id: String(user.id || ''),
    accountStatus: user.accountStatus === 'suspended' ? 'suspended' : 'active',
    displayName: String(user.displayName || ''),
    email: String(user.email || ''),
    role: (user.role || 'member') as Role,
    suspendedAt: String(user.suspendedAt || ''),
    suspensionReason: String(user.suspensionReason || ''),
  }
}

async function errorMessage(response: Response) {
  try {
    const payload = await response.json()
    return String(payload?.errors?.[0]?.message || payload?.message || '操作失败。')
  } catch {
    return '操作失败。'
  }
}

function formatTime(value?: string) {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return value
  }
}

export default function PersonnelClient() {
  const [actor, setActor] = useState<SessionUser | null>(null)
  const [users, setUsers] = useState<PersonnelUser[]>([])
  const [draftRoles, setDraftRoles] = useState<Record<string, Role>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | AccountStatus>('all')
  const [busyID, setBusyID] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [messageIsError, setMessageIsError] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const sessionResponse = await fetch('/api/account/session', { cache: 'no-store', credentials: 'include' })
        const session = sessionResponse.ok ? await sessionResponse.json() : null
        const nextActor = session?.user as SessionUser | null
        if (!nextActor || !['owner', 'admin'].includes(nextActor.role || '')) {
          if (active) setState('forbidden')
          return
        }

        const all: PersonnelUser[] = []
        let page = 1
        let totalPages = 1
        do {
          const response = await fetch(`/api/users?depth=0&limit=100&sort=email&page=${page}`, {
            cache: 'no-store',
            credentials: 'include',
          })
          if (!response.ok) throw new Error(await errorMessage(response))
          const payload = await response.json()
          all.push(...(Array.isArray(payload?.docs) ? payload.docs.map(normalizeUser) : []))
          totalPages = Number(payload?.totalPages || 1)
          page += 1
        } while (page <= totalPages)

        if (!active) return
        setActor(nextActor)
        setUsers(all)
        setDraftRoles(Object.fromEntries(all.map((user) => [user.id, user.role])))
        setReasons(Object.fromEntries(all.map((user) => [user.id, user.suspensionReason || ''])))
        setState('ready')
      } catch (error) {
        if (!active) return
        setMessage(error instanceof Error ? error.message : '无法读取用户列表。')
        setMessageIsError(true)
        setState('error')
      }
    }
    load()
    return () => {
      active = false
    }
  }, [])

  const visibleUsers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-CN')
    return users.filter((user) => {
      if (statusFilter !== 'all' && user.accountStatus !== statusFilter) return false
      if (!needle) return true
      return `${user.email || ''} ${user.displayName || ''} ${roleLabels[user.role]}`.toLocaleLowerCase('zh-CN').includes(needle)
    })
  }, [query, statusFilter, users])

  function mayManageRole(target: PersonnelUser) {
    if (!actor || actor.id === target.id || target.role === 'owner') return false
    if (actor.role === 'owner') return true
    return actor.role === 'admin' && target.role !== 'admin'
  }

  function mayManageStatus(target: PersonnelUser) {
    if (!actor || actor.id === target.id || target.role === 'owner') return false
    if (actor.role === 'owner') return true
    return actor.role === 'admin' && target.role !== 'admin'
  }

  function roleOptions(target: PersonnelUser) {
    const base = actor?.role === 'owner' ? assignableByOwner : assignableByAdmin
    return base.includes(target.role) ? base : [target.role, ...base]
  }

  async function updateUser(target: PersonnelUser, data: Record<string, unknown>, successMessage: string) {
    setBusyID(target.id)
    setMessage('')
    setMessageIsError(false)
    try {
      const response = await fetch(`/api/personnel/users/${encodeURIComponent(target.id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) throw new Error(await errorMessage(response))
      const payload = await response.json()
      const updated = normalizeUser(payload?.doc || payload)
      setUsers((current) => current.map((user) => user.id === target.id ? updated : user))
      setDraftRoles((current) => ({ ...current, [target.id]: updated.role }))
      setReasons((current) => ({ ...current, [target.id]: updated.suspensionReason || '' }))
      setMessage(successMessage)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。')
      setMessageIsError(true)
    } finally {
      setBusyID('')
    }
  }

  async function suspendUser(target: PersonnelUser) {
    const reason = (reasons[target.id] || '').trim()
    if (!reason || !window.confirm(`确定封停 ${target.email || target.id} 吗？其现有登录会话会立即失效。`)) return
    await updateUser(
      target,
      { accountStatus: 'suspended', suspensionReason: reason },
      `已封停 ${target.email || target.id}，其现有会话已失效。`,
    )
  }

  async function reactivateUser(target: PersonnelUser) {
    if (!window.confirm(`确定解除 ${target.email || target.id} 的封停吗？`)) return
    await updateUser(target, { accountStatus: 'active' }, `已解除 ${target.email || target.id} 的封停。`)
  }

  if (state === 'loading') return <section className="detail-card personnel-state"><p className="muted">正在读取人员与权限……</p></section>
  if (state === 'forbidden') {
    return <section className="detail-card personnel-state"><p className="eyebrow">人员与封停管理</p><h1>权限不足</h1><p>该页面只开放给最高领袖和管理员。</p><Link href="/account">返回账户</Link></section>
  }
  if (state === 'error') return <section className="detail-card personnel-state"><p className="account-message account-message-error">{message || '人员管理功能暂时不可用。'}</p></section>

  const suspendedCount = users.filter((user) => user.accountStatus === 'suspended').length
  return (
    <div className="personnel-dashboard">
      <section className="page-heading collection-heading">
        <div>
          <p className="eyebrow">站内权限</p>
          <h1>人员任命与账号封停</h1>
          <p>最高领袖可以任命管理员和编辑；管理员可以任命编辑。两者都可以封停其权限范围内的普通账户。</p>
        </div>
        <Link className="back-link" href="/account">返回我的账户</Link>
      </section>

      <section className="personnel-stats" aria-label="用户统计">
        <div className="detail-card"><span>全部账户</span><strong>{users.length}</strong></div>
        <div className="detail-card"><span>已封停</span><strong>{suspendedCount}</strong></div>
        <div className="detail-card"><span>当前身份</span><strong>{actor?.role === 'owner' ? '最高领袖' : '管理员'}</strong></div>
      </section>

      <section className="detail-card personnel-filters">
        <label>搜索账户<input onChange={(event) => setQuery(event.target.value)} placeholder="邮箱、显示名或身份" value={query} /></label>
        <label>账户状态<select onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} value={statusFilter}><option value="all">全部</option><option value="active">正常</option><option value="suspended">已封停</option></select></label>
      </section>

      {message ? <p className={messageIsError ? 'account-message account-message-error' : 'account-message'} role="status">{message}</p> : null}
      <section className="personnel-list" aria-live="polite">
        {visibleUsers.map((target) => {
          const roleManageable = mayManageRole(target)
          const statusManageable = mayManageStatus(target)
          const busy = busyID === target.id
          return (
            <article className="detail-card personnel-card" key={target.id}>
              <header>
                <div><strong>{target.displayName || '未设置显示名'}</strong><span>{target.email || '无邮箱'} · ID {target.id}</span></div>
                <span className={`personnel-status personnel-status-${target.accountStatus}`}>{target.accountStatus === 'suspended' ? '已封停' : '正常'}</span>
              </header>

              <div className="personnel-role-row">
                <label>站内身份<select disabled={!roleManageable || busy} onChange={(event) => setDraftRoles((current) => ({ ...current, [target.id]: event.target.value as Role }))} value={draftRoles[target.id] || target.role}>{roleOptions(target).map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
                <button disabled={!roleManageable || busy || draftRoles[target.id] === target.role} onClick={() => updateUser(target, { role: draftRoles[target.id] }, `已更新 ${target.email || target.id} 的身份。`)} type="button">保存任命</button>
              </div>

              {target.accountStatus === 'suspended' ? (
                <div className="personnel-suspension">
                  <p><strong>封停原因：</strong>{target.suspensionReason || '未填写'}</p>
                  {target.suspendedAt ? <small>封停时间：{formatTime(target.suspendedAt)}</small> : null}
                  <button disabled={!statusManageable || busy} onClick={() => reactivateUser(target)} type="button">解除封停</button>
                </div>
              ) : (
                <div className="personnel-suspension">
                  <label>封停原因<textarea disabled={!statusManageable || busy} maxLength={500} onChange={(event) => setReasons((current) => ({ ...current, [target.id]: event.target.value }))} placeholder="请记录可供内部追溯的原因" value={reasons[target.id] || ''} /></label>
                  <button className="personnel-danger" disabled={!statusManageable || busy || !(reasons[target.id] || '').trim()} onClick={() => suspendUser(target)} type="button">封停账号</button>
                </div>
              )}
              {!roleManageable && !statusManageable ? <small className="muted">当前身份不能修改此账户；自己的账户也不能在这里封停或改职。</small> : null}
            </article>
          )
        })}
        {visibleUsers.length === 0 ? <div className="detail-card personnel-state"><p className="muted">没有符合条件的账户。</p></div> : null}
      </section>
    </div>
  )
}
