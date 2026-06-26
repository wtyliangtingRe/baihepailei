'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import type { RecommendedWork } from '../_lib/recommendations'

type ListStatus = 'want' | 'seen' | 'avoid' | 'needs_review'

type UserListDoc = {
  id: string
  workSlug?: string
  listStatus?: ListStatus
}

const statusLabels: Record<ListStatus, string> = {
  want: '想看',
  seen: '已看',
  avoid: '避雷',
  needs_review: '需要复核',
}

function userListsUrl() {
  const params = new URLSearchParams()
  params.set('limit', '200')
  params.set('sort', '-updatedAt')
  return `/api/user-lists?${params.toString()}`
}

function WorkMiniCard({ work, label }: { work: RecommendedWork; label?: string }) {
  return (
    <Link className="personal-rec-card" href={work.item.url}>
      <strong>{work.item.title}</strong>
      <span>{work.score} 分{label ? ` · ${label}` : ''}</span>
    </Link>
  )
}

export default function PersonalRecommendationPanel({ recommendations }: { recommendations: RecommendedWork[] }) {
  const [lists, setLists] = useState<UserListDoc[]>([])
  const [state, setState] = useState<'loading' | 'idle' | 'login-required' | 'error'>('loading')

  useEffect(() => {
    let active = true
    fetch(userListsUrl(), { credentials: 'include' })
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
        setLists(Array.isArray(payload?.docs) ? payload.docs : [])
        setState('idle')
      })
      .catch(() => {
        if (active) setState('error')
      })

    return () => {
      active = false
    }
  }, [])

  const data = useMemo(() => {
    const bySlug = new Map(lists.filter((item) => item.workSlug).map((item) => [item.workSlug as string, item]))
    const avoid = new Set(lists.filter((item) => item.listStatus === 'avoid').map((item) => item.workSlug).filter(Boolean))
    const seen = new Set(lists.filter((item) => item.listStatus === 'seen').map((item) => item.workSlug).filter(Boolean))
    const want = new Set(lists.filter((item) => item.listStatus === 'want').map((item) => item.workSlug).filter(Boolean))
    const review = new Set(lists.filter((item) => item.listStatus === 'needs_review').map((item) => item.workSlug).filter(Boolean))
    const candidates = recommendations.filter((work) => !avoid.has(work.item.slug) && !seen.has(work.item.slug)).slice(0, 8)
    return { avoid, seen, want, review, bySlug, candidates }
  }, [lists, recommendations])

  return (
    <section className="detail-card personal-recommendation-panel" aria-label="个性化推荐">
      <div className="personal-rec-head">
        <p className="eyebrow">个人列表</p>
        <h2>结合你的列表</h2>
        <p className="muted">登录后会排除你标记为避雷或已看的作品，并优先提示想看、需要复核的条目。</p>
      </div>

      {state === 'loading' ? <p className="muted">正在读取个人列表……</p> : null}
      {state === 'login-required' ? <p className="muted">未登录时保留普通规则推荐。</p> : null}
      {state === 'error' ? <p className="muted">个人列表暂时不可用。</p> : null}

      {state === 'idle' ? (
        <>
          <div className="personal-rec-summary">
            <span>想看 {data.want.size}</span>
            <span>已看 {data.seen.size}</span>
            <span>避雷 {data.avoid.size}</span>
            <span>待复核 {data.review.size}</span>
          </div>
          <div className="personal-rec-list">
            {data.candidates.map((work) => {
              const status = data.bySlug.get(work.item.slug)?.listStatus
              return <WorkMiniCard key={work.item.id} label={status ? statusLabels[status] : undefined} work={work} />
            })}
          </div>
        </>
      ) : null}
    </section>
  )
}
