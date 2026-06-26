'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type ListStatus = 'want' | 'seen' | 'avoid' | 'needs_review'

type UserListDoc = {
  id: string
  workSlug?: string
  workTitle?: string
  listStatus?: ListStatus
  note?: string
  updatedAt?: string
}

const statusLabels: Record<ListStatus, string> = {
  want: '想看',
  seen: '已看',
  avoid: '避雷',
  needs_review: '需要复核',
}

const groups: Array<{ key: ListStatus; title: string; description: string }> = [
  { key: 'want', title: '想看', description: '之后可能想阅读或补资料的作品。' },
  { key: 'seen', title: '已看', description: '已经看过，可作为后续推荐参考。' },
  { key: 'avoid', title: '避雷', description: '不想再看到或需要避开的作品。' },
  { key: 'needs_review', title: '需要复核', description: '暂时拿不准，需要之后再查材料。' },
]

function listsUrl() {
  const params = new URLSearchParams()
  params.set('limit', '200')
  params.set('sort', '-updatedAt')
  return `/api/user-lists?${params.toString()}`
}

function groupLists(items: UserListDoc[]) {
  return groups.reduce<Record<ListStatus, UserListDoc[]>>((acc, group) => {
    acc[group.key] = items.filter((item) => item.listStatus === group.key)
    return acc
  }, { want: [], seen: [], avoid: [], needs_review: [] })
}

function WorkListItem({ item }: { item: UserListDoc }) {
  const href = item.workSlug ? `/works/${encodeURIComponent(item.workSlug)}` : '/works'
  return (
    <Link className="my-list-item" href={href}>
      <span>{item.listStatus ? statusLabels[item.listStatus] : '未分类'}</span>
      <strong>{item.workTitle || item.workSlug || '未命名作品'}</strong>
      {item.note ? <p>{item.note}</p> : null}
    </Link>
  )
}

export default function MyListsClient() {
  const [items, setItems] = useState<UserListDoc[]>([])
  const [state, setState] = useState<'loading' | 'idle' | 'login-required' | 'error'>('loading')

  useEffect(() => {
    let active = true
    fetch(listsUrl(), { credentials: 'include' })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          if (active) setState('login-required')
          return null
        }
        if (!response.ok) throw new Error('fetch failed')
        return response.json()
      })
      .then((payload) => {
        if (!active || !payload) return
        setItems(Array.isArray(payload?.docs) ? payload.docs : [])
        setState('idle')
      })
      .catch(() => {
        if (active) setState('error')
      })

    return () => {
      active = false
    }
  }, [])

  const grouped = useMemo(() => groupLists(items), [items])

  if (state === 'loading') return <section className="detail-card"><p className="muted">正在读取你的列表……</p></section>
  if (state === 'login-required') return <section className="detail-card"><p className="muted">需要先登录后台账户，才能查看个人列表。</p></section>
  if (state === 'error') return <section className="detail-card"><p className="muted">个人列表暂时不可用，请稍后再试。</p></section>

  return (
    <div className="my-lists-content">
      <section className="my-lists-summary detail-card">
        <span>想看 {grouped.want.length}</span>
        <span>已看 {grouped.seen.length}</span>
        <span>避雷 {grouped.avoid.length}</span>
        <span>待复核 {grouped.needs_review.length}</span>
      </section>

      {groups.map((group) => (
        <section className="my-list-group" key={group.key}>
          <div className="collection-heading">
            <div>
              <p className="eyebrow">{grouped[group.key].length} 个作品</p>
              <h2>{group.title}</h2>
              <p className="muted">{group.description}</p>
            </div>
          </div>
          {grouped[group.key].length ? (
            <div className="my-list-grid">
              {grouped[group.key].map((item) => <WorkListItem item={item} key={item.id} />)}
            </div>
          ) : (
            <p className="muted">暂无条目。</p>
          )}
        </section>
      ))}
    </div>
  )
}
