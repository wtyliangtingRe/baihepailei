'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'

import type { DetailItem } from '../_lib/detail-index'

type CommentDoc = {
  id: string
  authorName?: string
  body?: string
  createdAt?: string
  moderationStatus?: string
}

function commentsUrl(item: DetailItem) {
  const params = new URLSearchParams()
  params.set('limit', '20')
  params.set('sort', '-createdAt')
  params.set('where[targetCollection][equals]', item.collection)
  params.set('where[targetSlug][equals]', item.slug)
  params.set('where[moderationStatus][equals]', 'approved')
  return `/api/comments?${params.toString()}`
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
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'submitting' | 'submitted' | 'login-required' | 'error'>('idle')

  const apiUrl = useMemo(() => commentsUrl(item), [item.collection, item.slug])

  useEffect(() => {
    let active = true
    setStatus((current) => (current === 'submitted' ? current : 'loading'))

    fetch(apiUrl)
      .then((response) => response.json())
      .then((payload) => {
        if (!active) return
        setComments(Array.isArray(payload?.docs) ? payload.docs : [])
        setStatus((current) => (current === 'submitted' ? current : 'idle'))
      })
      .catch(() => {
        if (!active) return
        setStatus('error')
      })

    return () => {
      active = false
    }
  }, [apiUrl])

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = body.trim()
    if (!text) return

    setStatus('submitting')

    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
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

      setBody('')
      setStatus('submitted')
    } catch {
      setStatus('error')
    }
  }

  return (
    <section className="page comment-block-shell" aria-label="评论区">
      <div className="detail-card comment-block">
        <div>
          <p className="eyebrow">评论区</p>
          <h2>读者评论</h2>
          <p className="muted">注册用户可以提交短评、补充阅读感想，或提醒条目需要复核。评论审核后公开显示。</p>
        </div>

        <div className="comment-list" aria-live="polite">
          {status === 'loading' ? <p className="muted">正在加载评论……</p> : null}
          {comments.length === 0 && status !== 'loading' ? <p className="muted">暂无公开评论。</p> : null}
          {comments.map((comment) => (
            <article className="comment-item" key={comment.id}>
              <header>
                <strong>{comment.authorName || '注册用户'}</strong>
                {comment.createdAt ? <time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time> : null}
              </header>
              <p>{comment.body}</p>
            </article>
          ))}
        </div>

        <form className="comment-compose-placeholder" onSubmit={submitComment}>
          <label htmlFor={`comment-${item.collection}-${item.slug}`}>发表评论</label>
          <textarea
            id={`comment-${item.collection}-${item.slug}`}
            maxLength={1200}
            onChange={(event) => setBody(event.target.value)}
            placeholder="登录后可以提交评论。评论会先进入审核队列。"
            value={body}
          />
          <div className="comment-compose-actions">
            <button disabled={status === 'submitting' || !body.trim()} type="submit">
              {status === 'submitting' ? '提交中……' : '提交评论'}
            </button>
            <span>{body.trim().length}/1200</span>
          </div>
          {status === 'submitted' ? <p className="comment-message">评论已提交，审核通过后会公开显示。</p> : null}
          {status === 'login-required' ? <p className="comment-message">需要先登录后台账户，才能提交评论。</p> : null}
          {status === 'error' ? <p className="comment-message comment-message-error">评论功能暂时不可用，请稍后再试。</p> : null}
        </form>
      </div>
    </section>
  )
}
