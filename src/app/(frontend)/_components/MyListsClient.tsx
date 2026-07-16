'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type ListStatus = 'want' | 'watching' | 'seen' | 'favorite' | 'avoid' | 'needs_review'
type UserListDoc = { id: string; workSlug?: string; workTitle?: string; listStatus?: ListStatus; note?: string }

const groups: Array<{ key: ListStatus; title: string; description: string }> = [
  { key: 'want', title: '想看', description: '之后想阅读、观看或补资料的作品。' },
  { key: 'watching', title: '在看', description: '正在阅读、观看或游玩的作品。' },
  { key: 'seen', title: '已看', description: '已经完整看过的作品。' },
  { key: 'favorite', title: '喜欢', description: '特别喜欢、想长期收藏的作品。' },
  { key: 'avoid', title: '避雷', description: '不想再看到或推荐的作品。' },
  { key: 'needs_review', title: '需要复核', description: '暂时拿不准，之后继续查材料。' },
]

function groupLists(items: UserListDoc[]) {
  return groups.reduce<Record<ListStatus, UserListDoc[]>>((acc, group) => {
    acc[group.key] = items.filter((item) => item.listStatus === group.key)
    return acc
  }, { want: [], watching: [], seen: [], favorite: [], avoid: [], needs_review: [] })
}

export default function MyListsClient() {
  const [items, setItems] = useState<UserListDoc[]>([])
  const [state, setState] = useState<'loading' | 'idle' | 'login-required' | 'error'>('loading')

  useEffect(() => {
    let active = true
    fetch('/api/user-lists?limit=500&sort=-updatedAt', { credentials: 'include' })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          if (active) setState('login-required')
          return null
        }
        if (!response.ok) throw new Error('fetch-failed')
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

  async function removeItem(id: string) {
    const response = await fetch(`/api/user-lists/${id}`, { method: 'DELETE', credentials: 'include' })
    if (response.ok) setItems((current) => current.filter((item) => item.id !== id))
  }

  if (state === 'loading') return <section className="detail-card"><p className="muted">正在读取你的列表……</p></section>
  if (state === 'login-required') return <section className="detail-card"><p className="muted">请先<Link href="/account/login?redirect=/me/lists">登录或注册</Link>后查看个人列表。</p></section>
  if (state === 'error') return <section className="detail-card"><p className="muted">个人列表暂时不可用，请稍后再试。</p></section>

  return (
    <div className="my-lists-content">
      <section className="my-lists-summary detail-card">
        {groups.map((group) => <span key={group.key}>{group.title} {grouped[group.key].length}</span>)}
      </section>
      {groups.map((group) => (
        <section className="my-list-group" key={group.key}>
          <div className="collection-heading"><div><p className="eyebrow">{grouped[group.key].length} 个作品</p><h2>{group.title}</h2><p className="muted">{group.description}</p></div></div>
          {grouped[group.key].length ? (
            <div className="my-list-grid">
              {grouped[group.key].map((item) => (
                <article className="my-list-item" key={item.id}>
                  <Link href={item.workSlug ? `/works/${encodeURIComponent(item.workSlug)}` : '/works'}>
                    <strong>{item.workTitle || item.workSlug || '未命名作品'}</strong>
                    {item.note ? <p>{item.note}</p> : null}
                  </Link>
                  <button onClick={() => removeItem(item.id)} type="button">移出列表</button>
                </article>
              ))}
            </div>
          ) : <p className="muted">暂无条目。</p>}
        </section>
      ))}
    </div>
  )
}
