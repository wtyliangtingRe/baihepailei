'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type FormEvent } from 'react'

import type { DetailItem } from '../_lib/detail-index'

type CommentDoc = {
  id: string
  author?: string | number | { id?: string | number }
  authorName?: string
  body?: string
  createdAt?: string
}

type AccountUser = {
  id?: string
  role?: string
}

const commentModeratorRoles = new Set(['owner', 'admin', 'editor', 'reviewer'])

function commentsUrl(item: DetailItem) {
  const params = new URLSearchParams()
  params.set('depth', '0')
  params.set('limit', '20')
  params.set('sort', '-createdAt')
  params.set('where[targetCollection][equals]', item.collection)
  params.set('where[targetSlug][equals]', item.slug)
  return `/api/comments?${params.toString()}`
}

function relationID(value: CommentDoc['author']) {
  if (value && typeof value === 'object') return String(value.id || '')
  return value === undefined || value === null ? '' : String(value)
}

function formatDate(value?: string) {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value))
  } catch {
    return ''
  }
}

export default function CommentBlock({ item }: { item: DetailItem }) {
  const [comments, setComments] = useState<CommentDoc[]>([])
  const [user, setUser] = useState<AccountUser | null>(null)
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'submitting' | 'submitted' | 'login-required' | 'error'>('idle')
  const [deletingID, setDeletingID] = useState('')
  const apiUrl = useMemo(() => commentsUrl(item), [item.collection, item.slug])

  useEffect(() => {
    let active = true
    setStatus((current) => current === 'submitted' ? current : 'loading')
    Promise.all([
      fetch(apiUrl, { credentials: 'include' }).then((response) => response.json()),
      fetch('/api/account/session', { cache: 'no-store', credentials: 'include' })
        .then((response) => response.ok ? response.json() : { user: null })
        .catch(() => ({ user: null })),
    ])
      .then(([payload, session]) => {
        if (!active) return
        setComments(Array.isArray(payload?.docs) ? payload.docs : [])
        setUser(session?.user || null)
        setStatus((current) => current === 'submitted' ? current : 'idle')
      })
      .catch(() => {
        if (active) setStatus('error')
      })
    return () => {
      active = false
    }
  }, [apiUrl])

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = body.trim()
    if (text.length < 2) return
    setStatus('submitting')

    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetCollection: item.collection,
          targetSlug: item.slug,
          targetTitle: item.title,
          body: text,
        }),
      })
      if (response.status === 401 || response.status === 403) {
        setStatus('login-required')
        return
      }
      if (!response.ok) throw new Error('comment-submit-failed')
      const payload = await response.json()
      const doc = (payload?.doc || payload) as CommentDoc
      if (doc?.id) {
        setComments((current) => [doc, ...current.filter((item) => String(item.id) !== String(doc.id))])
      }
      setBody('')
      setStatus('submitted')
    } catch {
      setStatus('error')
    }
  }

  async function deleteComment(comment: CommentDoc) {
    if (!window.confirm('确定删除这条评论吗？删除后无法在网页中恢复。')) return
    setDeletingID(String(comment.id))
    try {
      const response = await fetch(`/api/comments/${encodeURIComponent(comment.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) throw new Error('comment-delete-failed')
      setComments((current) => current.filter((item) => String(item.id) !== String(comment.id)))
      setStatus('idle')
    } catch {
      setStatus('error')
    } finally {
      setDeletingID('')
    }
  }

  function mayDelete(comment: CommentDoc) {
    if (!user?.id) return false
    if (commentModeratorRoles.has(user.role || '')) return true
    return relationID(comment.author) === String(user.id)
  }

  const redirect = `/account/login?redirect=${encodeURIComponent(item.url)}`
  return (
    <section className="page comment-block-shell" aria-label="评论区">
      <div className="detail-card comment-block">
        <div>
          <p className="eyebrow">评论区</p>
          <h2>读者评论</h2>
          <p className="muted">注册用户可以提交短评和阅读感想，评论提交后立即公开。作者可以删除自己的评论，编辑及以上可以删除不当内容。</p>
        </div>

        <div className="comment-list" aria-live="polite">
          {status === 'loading' ? <p className="muted">正在加载评论……</p> : null}
          {comments.length === 0 && status !== 'loading' ? <p className="muted">暂无评论。</p> : null}
          {comments.map((comment) => (
            <article className="comment-item" key={comment.id}>
              <header>
                <strong>{comment.authorName || '注册用户'}</strong>
                {comment.createdAt ? <time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time> : null}
                {mayDelete(comment) ? (
                  <button
                    className="comment-delete"
                    disabled={deletingID === String(comment.id)}
                    onClick={() => deleteComment(comment)}
                    type="button"
                  >
                    {deletingID === String(comment.id) ? '删除中……' : '删除'}
                  </button>
                ) : null}
              </header>
              <p>{comment.body}</p>
            </article>
          ))}
        </div>

        <form className="comment-compose-placeholder" onSubmit={submitComment}>
          <label htmlFor={`comment-${item.collection}-${item.slug}`}>发表评论</label>
          <textarea id={`comment-${item.collection}-${item.slug}`} maxLength={1200} minLength={2} onChange={(event) => setBody(event.target.value)} placeholder="友善交流；如果要提交排雷证据，请使用页面上的人工材料入口。" value={body} />
          <div className="comment-compose-actions">
            <button disabled={status === 'submitting' || body.trim().length < 2} type="submit">{status === 'submitting' ? '提交中……' : '提交评论'}</button>
            <span>{body.trim().length}/1200</span>
          </div>
          {status === 'submitted' ? <p className="comment-message">评论已发布。</p> : null}
          {status === 'login-required' ? <p className="comment-message">请先<Link href={redirect}>登录或注册</Link>后发表评论。</p> : null}
          {status === 'error' ? <p className="comment-message comment-message-error">评论功能暂时不可用，请稍后再试。</p> : null}
        </form>
      </div>
    </section>
  )
}
