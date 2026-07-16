'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import type { RecommendedWork } from '../_lib/recommendations'

type ListStatus = 'want' | 'watching' | 'seen' | 'favorite' | 'avoid' | 'needs_review'
type UserListDoc = { id: string; workSlug?: string; listStatus?: ListStatus }

const statusLabels: Record<ListStatus, string> = { want: '想看', watching: '在看', seen: '已看', favorite: '喜欢', avoid: '避雷', needs_review: '需要复核' }
const statusPriority: Record<ListStatus, number> = { favorite: 5, watching: 4, want: 3, needs_review: 2, seen: 1, avoid: 0 }

function userListsUrl() {
  const params = new URLSearchParams({ limit: '200', sort: '-updatedAt' })
  return `/api/user-lists?${params.toString()}`
}

function WorkMiniCard({ work, label }: { work: RecommendedWork; label?: string }) {
  return <Link className="personal-rec-card" href={work.item.url}><strong>{work.item.title}</strong><span>{work.score} 分{label ? ` · ${label}` : ''}</span></Link>
}

export default function PersonalRecommendationPanel({ recommendations }: { recommendations: RecommendedWork[] }) {
  const [lists, setLists] = useState<UserListDoc[]>([])
  const [state, setState] = useState<'loading' | 'idle' | 'login-required' | 'error'>('loading')

  useEffect(() => {
    let active = true
    fetch(userListsUrl(), { credentials: 'include' })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) { if (active) setState('login-required'); return null }
        if (!response.ok) throw new Error('fetch failed')
        return response.json()
      })
      .then((payload) => { if (active && payload) { setLists(Array.isArray(payload?.docs) ? payload.docs : []); setState('idle') } })
      .catch(() => { if (active) setState('error') })
    return () => { active = false }
  }, [])

  const data = useMemo(() => {
    const bySlug = new Map(lists.filter((item) => item.workSlug).map((item) => [item.workSlug as string, item]))
    const sets = Object.fromEntries((Object.keys(statusLabels) as ListStatus[]).map((status) => [status, new Set(lists.filter((item) => item.listStatus === status).map((item) => item.workSlug).filter(Boolean))])) as Record<ListStatus, Set<string | undefined>>
    const candidates = recommendations
      .filter((work) => !sets.avoid.has(work.item.slug) && !sets.seen.has(work.item.slug) && work.bucket !== 'not-recommended')
      .sort((a, b) => {
        const aStatus = bySlug.get(a.item.slug)?.listStatus
        const bStatus = bySlug.get(b.item.slug)?.listStatus
        return (bStatus ? statusPriority[bStatus] : 0) - (aStatus ? statusPriority[aStatus] : 0) || b.score - a.score
      })
      .slice(0, 8)
    return { bySlug, sets, candidates }
  }, [lists, recommendations])

  return (
    <section className="detail-card personal-recommendation-panel" aria-label="个性化推荐">
      <div className="personal-rec-head"><p className="eyebrow">个人列表</p><h2>结合你的列表</h2><p className="muted">登录后会排除避雷和已看，优先显示喜欢、在看、想看与需要复核的安全候选。</p></div>
      {state === 'loading' ? <p className="muted">正在读取个人列表……</p> : null}
      {state === 'login-required' ? <p className="muted">未登录时保留普通规则推荐。</p> : null}
      {state === 'error' ? <p className="muted">个人列表暂时不可用。</p> : null}
      {state === 'idle' ? <><div className="personal-rec-summary">{(Object.keys(statusLabels) as ListStatus[]).map((status) => <span key={status}>{statusLabels[status]} {data.sets[status].size}</span>)}</div><div className="personal-rec-list">{data.candidates.map((work) => { const status = data.bySlug.get(work.item.slug)?.listStatus; return <WorkMiniCard key={work.item.id} label={status ? statusLabels[status] : undefined} work={work} /> })}</div></> : null}
    </section>
  )
}
