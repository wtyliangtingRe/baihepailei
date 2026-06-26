'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'

import type { DetailItem } from '../_lib/detail-index'

type ListStatus = 'want' | 'seen' | 'avoid' | 'needs_review'

type UserListDoc = {
  id: string
  listStatus?: ListStatus
  note?: string
}

const statusOptions: Array<{ label: string; value: ListStatus; help: string }> = [
  { label: '想看', value: 'want', help: '先加入待看清单，后续再判断。' },
  { label: '已看', value: 'seen', help: '已经看过，可以作为推荐参考。' },
  { label: '避雷', value: 'avoid', help: '不想再看到，后续推荐会避开。' },
  { label: '需要复核', value: 'needs_review', help: '暂时拿不准，需要之后再查材料。' },
]

function listUrl(item: DetailItem) {
  const params = new URLSearchParams()
  params.set('limit', '1')
  params.set('where[workSlug][equals]', item.slug)
  return `/api/user-lists?${params.toString()}`
}

export default function WorkListControl({ item }: { item: DetailItem }) {
  const [record, setRecord] = useState<UserListDoc | null>(null)
  const [listStatus, setListStatus] = useState<ListStatus>('want')
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'login-required' | 'error'>('idle')

  const apiUrl = useMemo(() => listUrl(item), [item.slug])

  useEffect(() => {
    if (item.collection !== 'works') return
    let active = true
    setState('loading')

    fetch(apiUrl, { credentials: 'include' })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          if (active) setState('login-required')
          return null
        }
        if (!response.ok) throw new Error('list-fetch-failed')
        return response.json()
      })
      .then((payload) => {
        if (!active || !payload) return
        const doc = Array.isArray(payload?.docs) ? payload.docs[0] : null
        if (doc) {
          setRecord(doc)
          setListStatus(doc.listStatus || 'want')
          setNote(doc.note || '')
        }
        setState('idle')
      })
      .catch(() => {
        if (active) setState('error')
      })

    return () => {
      active = false
    }
  }, [apiUrl, item.collection])

  if (item.collection !== 'works') return null

  async function saveList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState('saving')

    const body = JSON.stringify({
      workSlug: item.slug,
      workTitle: item.title,
      listStatus,
      note: note.trim(),
    })

    try {
      const response = await fetch(record ? `/api/user-lists/${record.id}` : '/api/user-lists', {
        method: record ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      })

      if (response.status === 401 || response.status === 403) {
        setState('login-required')
        return
      }

      if (!response.ok) throw new Error('list-save-failed')

      const payload = await response.json()
      const doc = payload?.doc || payload
      if (doc?.id) setRecord(doc)
      setState('saved')
    } catch {
      setState('error')
    }
  }

  return (
    <section className="detail-card work-list-control" aria-label="我的作品列表">
      <div className="work-list-head">
        <p className="eyebrow">我的列表</p>
        <h2>加入我的作品列表</h2>
        <p className="muted">把这个作品标记为想看、已看、避雷或需要复核。这个记录只用于你的个人列表。</p>
      </div>

      <form className="work-list-form" onSubmit={saveList}>
        <div className="work-list-options" role="radiogroup" aria-label="列表状态">
          {statusOptions.map((option) => (
            <label className="work-list-option" data-active={listStatus === option.value ? 'true' : 'false'} key={option.value}>
              <input checked={listStatus === option.value} name="listStatus" onChange={() => setListStatus(option.value)} type="radio" value={option.value} />
              <span>{option.label}</span>
              <small>{option.help}</small>
            </label>
          ))}
        </div>

        <label className="work-list-note" htmlFor={`work-list-note-${item.slug}`}>
          私人备注
          <textarea id={`work-list-note-${item.slug}`} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="可选：记录为什么想看、为什么避雷，或需要复核哪些材料。" value={note} />
        </label>

        <div className="work-list-actions">
          <button disabled={state === 'saving'} type="submit">
            {state === 'saving' ? '保存中……' : record ? '更新我的列表' : '加入我的列表'}
          </button>
          <span>{note.trim().length}/500</span>
        </div>

        {state === 'saved' ? <p className="work-list-message">已保存到你的作品列表。</p> : null}
        {state === 'login-required' ? <p className="work-list-message">需要先登录后台账户，才能使用个人列表。</p> : null}
        {state === 'error' ? <p className="work-list-message work-list-message-error">个人列表暂时不可用，请稍后再试。</p> : null}
      </form>
    </section>
  )
}
