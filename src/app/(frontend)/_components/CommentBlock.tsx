'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type FormEvent } from 'react'

import type { DetailItem } from '../_lib/detail-index'

type CommentRelation = string | number | { id?: string | number }

type CommentDoc = {
  id: string | number
  author?: CommentRelation
  authorName?: string
  body?: string
  parentComment?: CommentRelation
  replyToName?: string
  createdAt?: string
  moderationStatus?: string
  reportCount?: number
}

type AccountUser = {
  id?: string | number
  role?: string
}

const commentModeratorRoles = new Set(['owner', 'admin', 'editor'])

function commentsUrl(item: DetailItem) {
  const params = new URLSearchParams()
  params.set('depth', '0')
  params.set('limit', '100')
  params.set('sort', '-createdAt')
  params.set('where[targetCollection][equals]', item.collection)
  params.set('where[targetSlug][equals]', item.slug)
  return `/api/comments?${params.toString()}`
}

function relationID(value?: CommentRelation) {
  if (value && typeof value === 'object') return String(value.id || '')
  return value === undefined || value === null ? '' : String(value)
}

function formatDate(value?: string) {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return ''
  }
}

function byOldest(a: CommentDoc, b: CommentDoc) {
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
}

export default function CommentBlock({ item }: { item: DetailItem }) {
  const [comments, setComments] = useState<CommentDoc[]>([])
  const [user, setUser] = useState<AccountUser | null>(null)
  const [body, setBody] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [replyingTo, setReplyingTo] = useState<CommentDoc | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'submitting' | 'submitted' | 'login-required' | 'error'>('idle')
  const [deletingID, setDeletingID] = useState('')
  const [reportingID, setReportingID] = useState('')
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

  const { roots, repliesByRoot } = useMemo(() => {
    const byID = new Map(comments.map((comment) => [String(comment.id), comment]))
    const replyMap = new Map<string, CommentDoc[]>()
    const rootItems: CommentDoc[] = []

    for (const comment of comments) {
      const parentID = relationID(comment.parentComment)
      if (!parentID || !byID.has(parentID)) {
        rootItems.push(comment)
        continue
      }
      const values = replyMap.get(parentID) || []
      values.push(comment)
      replyMap.set(parentID, values)
    }
    for (const values of replyMap.values()) values.sort(byOldest)
    return { roots: rootItems, repliesByRoot: replyMap }
  }, [comments])

  async function postComment(text: string, parentComment?: CommentDoc) {
    const response = await fetch('/api/comments', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetCollection: item.collection,
        targetSlug: item.slug,
        targetTitle: item.title,
        parentComment: parentComment?.id,
        body: text,
      }),
    })
    if (response.status === 401 || response.status === 403) {
      setStatus('login-required')
      return null
    }
    if (!response.ok) throw new Error('comment-submit-failed')
    const payload = await response.json()
    return (payload?.doc || payload) as CommentDoc
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = body.trim()
    if (text.length < 2) return
    setStatus('submitting')

    try {
      const doc = await postComment(text)
      if (!doc) return
      if (doc.id) setComments((current) => [doc, ...current.filter((comment) => String(comment.id) !== String(doc.id))])
      setBody('')
      setStatus('submitted')
    } catch {
      setStatus('error')
    }
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = replyBody.trim()
    if (!replyingTo || text.length < 2) return
    setStatus('submitting')

    try {
      const doc = await postComment(text, replyingTo)
      if (!doc) return
      if (doc.id) setComments((current) => [...current.filter((comment) => String(comment.id) !== String(doc.id)), doc])
      setReplyBody('')
      setReplyingTo(null)
      setStatus('submitted')
    } catch {
      setStatus('error')
    }
  }

  async function deleteComment(comment: CommentDoc) {
    if (!window.confirm('确定删除这条评论吗？删除后无法在网页中恢复。')) return
    const commentID = String(comment.id)
    setDeletingID(commentID)
    try {
      const response = await fetch(`/api/comments/${encodeURIComponent(commentID)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) throw new Error('comment-delete-failed')
      setComments((current) => current.filter((item) => String(item.id) !== commentID && relationID(item.parentComment) !== commentID))
      if (replyingTo && (String(replyingTo.id) === commentID || relationID(replyingTo.parentComment) === commentID)) {
        setReplyingTo(null)
        setReplyBody('')
      }
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

  function startReply(comment: CommentDoc) {
    if (!user?.id) {
      setStatus('login-required')
      return
    }
    setReplyingTo(comment)
    setReplyBody('')
    setStatus('idle')
  }

  async function reportComment(comment: CommentDoc) {
    if (!user?.id) {
      setStatus('login-required')
      return
    }
    const commentID = String(comment.id)
    setReportingID(commentID)
    try {
      const response = await fetch(`/api/comments/${encodeURIComponent(commentID)}/report`, {
        method: 'POST',
        credentials: 'include',
      })
      if (response.status === 401 || response.status === 403) {
        setStatus('login-required')
        return
      }
      if (!response.ok) throw new Error('comment-report-failed')
      const payload = await response.json()
      if (payload?.autoHidden) {
        setComments((current) => current.filter((item) => String(item.id) !== commentID && relationID(item.parentComment) !== commentID))
      } else {
        setComments((current) => current.map((item) => String(item.id) === commentID ? { ...item, reportCount: payload.reportCount } : item))
      }
      setStatus('idle')
    } catch {
      setStatus('error')
    } finally {
      setReportingID('')
    }
  }

  const redirect = `/account/login?redirect=${encodeURIComponent(item.url)}`
  return (
    <section className="page comment-block-shell" aria-label="评论区">
      <div className="detail-card comment-block">
        <div>
          <p className="eyebrow">评论区</p>
          <h2>读者评论</h2>
          <p className="muted">注册用户可以发表评论并回复他人。回复统一显示在主评论下，避免无限嵌套；作者可删除自己的评论，编辑及以上可删除不当内容。</p>
        </div>

        <div className="comment-list" aria-live="polite">
          {status === 'loading' ? <p className="muted">正在加载评论……</p> : null}
          {roots.length === 0 && status !== 'loading' ? <p className="muted">暂无评论。</p> : null}
          {roots.map((comment) => {
            const replies = repliesByRoot.get(String(comment.id)) || []
            return (
              <article className="comment-item" key={comment.id}>
                <CommentHeader comment={comment} deletingID={deletingID} mayDelete={mayDelete(comment)} mayReport={Boolean(user?.id) && relationID(comment.author) !== String(user?.id)} onDelete={deleteComment} onReply={startReply} onReport={reportComment} reportingID={reportingID} />
                <p>{comment.body}</p>

                {replies.length ? (
                  <div className="comment-replies" aria-label={`${comment.authorName || '注册用户'}的评论回复`}>
                    {replies.map((reply) => (
                      <article className="comment-reply" key={reply.id}>
                        <CommentHeader comment={reply} deletingID={deletingID} mayDelete={mayDelete(reply)} mayReport={Boolean(user?.id) && relationID(reply.author) !== String(user?.id)} onDelete={deleteComment} onReply={startReply} onReport={reportComment} reportingID={reportingID} />
                        <p>{reply.replyToName ? <span className="comment-reply-to">回复 {reply.replyToName}：</span> : null}{reply.body}</p>
                      </article>
                    ))}
                  </div>
                ) : null}

                {replyingTo && (String(replyingTo.id) === String(comment.id) || relationID(replyingTo.parentComment) === String(comment.id)) ? (
                  <form className="comment-reply-form" onSubmit={submitReply}>
                    <label>回复 {replyingTo.authorName || '注册用户'}</label>
                    <textarea autoFocus maxLength={1200} minLength={2} onChange={(event) => setReplyBody(event.target.value)} placeholder="友善交流，并尽量围绕这条评论展开。" value={replyBody} />
                    <div className="comment-compose-actions">
                      <button disabled={status === 'submitting' || replyBody.trim().length < 2} type="submit">{status === 'submitting' ? '回复中……' : '发布回复'}</button>
                      <button className="comment-cancel" onClick={() => { setReplyingTo(null); setReplyBody('') }} type="button">取消</button>
                      <span>{replyBody.trim().length}/1200</span>
                    </div>
                  </form>
                ) : null}
              </article>
            )
          })}
        </div>

        <form className="comment-compose-placeholder" onSubmit={submitComment}>
          <label htmlFor={`comment-${item.collection}-${item.slug}`}>发表评论</label>
          <textarea id={`comment-${item.collection}-${item.slug}`} maxLength={1200} minLength={2} onChange={(event) => setBody(event.target.value)} placeholder="友善交流；如果要提交排雷证据，请使用页面上的人工材料入口。" value={body} />
          <div className="comment-compose-actions">
            <button disabled={status === 'submitting' || body.trim().length < 2} type="submit">{status === 'submitting' ? '提交中……' : '提交评论'}</button>
            <span>{body.trim().length}/1200</span>
          </div>
          {status === 'submitted' ? <p className="comment-message">评论已发布；回复同样会立即显示。</p> : null}
          {status === 'login-required' ? <p className="comment-message">请先<Link href={redirect}>登录或注册</Link>后发表评论。</p> : null}
          {status === 'error' ? <p className="comment-message comment-message-error">评论功能暂时不可用，请稍后再试。</p> : null}
        </form>
      </div>
    </section>
  )
}

function CommentHeader({ comment, deletingID, mayDelete, mayReport, onDelete, onReply, onReport, reportingID }: {
  comment: CommentDoc
  deletingID: string
  mayDelete: boolean
  mayReport: boolean
  onDelete: (comment: CommentDoc) => void
  onReply: (comment: CommentDoc) => void
  onReport: (comment: CommentDoc) => void
  reportingID: string
}) {
  return (
    <header>
      <strong>{comment.authorName || '注册用户'}</strong>
      {comment.createdAt ? <time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time> : null}
      <button className="comment-reply-button" onClick={() => onReply(comment)} type="button">回复</button>
      {mayReport ? <button className="comment-report" disabled={reportingID === String(comment.id)} onClick={() => onReport(comment)} type="button">{reportingID === String(comment.id) ? '举报中……' : '举报'}</button> : null}
      {mayDelete ? <button className="comment-delete" disabled={deletingID === String(comment.id)} onClick={() => onDelete(comment)} type="button">{deletingID === String(comment.id) ? '删除中……' : '删除'}</button> : null}
    </header>
  )
}
