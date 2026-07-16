'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type FormEvent } from 'react'

import type { DetailItem } from '../_lib/detail-index'

type ListStatus = 'want' | 'watching' | 'seen' | 'favorite' | 'avoid' | 'needs_review'
type UserListDoc = { id: string; listStatus?: ListStatus; note?: string }

const statusOptions: Array<{ label: string; value: ListStatus; help: string }> = [
  { label: '想看', value: 'want', help: '加入待看清单。' },
  { label: '在看', value: 'watching', help: '正在阅读或观看。' },
  { label: '已看', value: 'seen', help: '已经完整看过。' },
  { label: '喜欢', value: 'favorite', help: '收藏为喜欢的作品。' },
  { label: '避雷', value: 'avoid', help: '不想再看到或推荐。' },
  { label: '需要复核', value: 'needs_review', help: '之后继续查材料。' },
]

function listUrl(item: DetailItem) {
  const params = new URLSearchParams({ limit: '1', 'where[workSlug][equals]': item.slug })
  return `/api/user-lists?${params.toString()}`
}

export default function WorkListControl({ item }: { item: DetailItem }) {
  const [record, setRecord] = useState<UserListDoc | null>(null)
  const [listStatus, setListStatus] = useState<ListStatus>('want')
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'removed' | 'login-required' | 'error'>('idle')
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
    try {
      const response = await fetch(record ? `/api/user-lists/${record.id}` : '/api/user-lists', {
        method: record ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workSlug: item.slug, workTitle: item.title, listStatus, note: note.trim() }),
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

  async function removeFromList() {
    if (!record) return
    setState('saving')
    try {
      const response = await fetch(`/api/user-lists/${record.id}`, { method: 'DELETE', credentials: 'include' })
      if (!response.ok) throw new Error('list-delete-failed')
      setRecord(null)
      setNote('')
      setListStatus('want')
      setState('removed')
    } catch {
      setState('error')
    }
  }

  const loginURL = `/account/login?redirect=${encodeURIComponent(item.url)}`
  return (
    <section className="work-list-control" aria-label="我的作品列表">
      <div className="work-list-head">
        <p className="eyebrow">我的列表</p>
        <h2>保存这个作品</h2>
        <p className="muted">列表和私人备注只对你自己可见。</p>
      </div>
      <form className="work-list-form" onSubmit={saveList}>
        <div className="work-list-options" role="radiogroup" aria-label="列表状态">
          {statusOptions.map((option) => (
            <label className="work-list-option" data-active={listStatus === option.value ? 'true' : 'false'} key={option.value}>
              <input checked={listStatus === option.value} name="listStatus" onChange={() => setListStatus(option.value)} type="radio" value={option.value} />
              <span>{option.label}</span><small>{option.help}</small>
            </label>
          ))}
        </div>
        <label className="work-list-note" htmlFor={`work-list-note-${item.slug}`}>
          私人备注
          <textarea id={`work-list-note-${item.slug}`} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="记录观看进度、推荐理由或需要复核的材料。" value={note} />
        </label>
        <div className="work-list-actions">
          <button disabled={state === 'saving'} type="submit">{state === 'saving' ? '保存中……' : record ? '更新列表' : '加入我的列表'}</button>
          {record ? <button className="work-list-remove" onClick={removeFromList} type="button">移出列表</button> : null}
          <span>{note.trim().length}/500</span>
        </div>
        {state === 'saved' ? <p className="work-list-message">已保存到你的列表。</p> : null}
        {state === 'removed' ? <p className="work-list-message">已从列表移除。</p> : null}
        {state === 'login-required' ? <p className="work-list-message">请先<Link href={loginURL}>登录或注册</Link>后使用个人列表。</p> : null}
        {state === 'error' ? <p className="work-list-message work-list-message-error">个人列表暂时不可用，请稍后再试。</p> : null}
      </form>
    </section>
  )
}
