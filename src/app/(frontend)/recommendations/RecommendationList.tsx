'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'

import type { RecommendationBatch } from './get-batch'
import styles from './recommendation-list.module.css'

export default function RecommendationList({ initialBatch }: { initialBatch: RecommendationBatch }) {
  const [batch, setBatch] = useState(initialBatch)
  const [pending, startTransition] = useTransition()
  const [outcome, setOutcome] = useState<'success' | 'error' | null>(null)
  const hasError = !pending && outcome === 'error'
  const message = pending
    ? '正在换一批作品。'
    : hasError
      ? '暂时无法换一批，请再试一次。'
      : outcome === 'success' ? `已换一批，共 ${batch.cards.length} 部作品。` : ''

  function refreshBatch() {
    if (pending || !batch.next) return
    const query = new URLSearchParams({
      sOffset: String(batch.next.sOffset),
      aOffset: String(batch.next.aOffset),
    })

    startTransition(async () => {
      try {
        const response = await fetch(`/api/recommendations?${query}`)
        if (!response.ok) throw new Error('Recommendations request failed')
        const nextBatch: RecommendationBatch = await response.json()
        setBatch(nextBatch)
        setOutcome('success')
      } catch {
        setOutcome('error')
      }
    })
  }

  return (
    <>
      {batch.next ? (
        <div className={styles.controls}>
          <button
            aria-controls="recommended-works"
            aria-disabled={pending}
            className="back-link"
            onClick={refreshBatch}
            type="button"
          >
            换一批
          </button>
          <p className={hasError ? styles.error : styles.screenReader} role="status">{message}</p>
        </div>
      ) : null}
      <section
        aria-busy={pending}
        aria-label="推荐作品"
        className="release-featured-grid"
        id="recommended-works"
      >
        {batch.cards.map(({ workId, grade, title, href, description }) => (
          <Link className="release-featured-card" href={href} key={workId}>
            <span className={`rating-chip grade-${grade}`}>{grade}</span>
            <div>
              <h2 className={styles.cardTitle}>{title}</h2>
              <p>{description}</p>
            </div>
            <span aria-hidden="true">↗</span>
          </Link>
        ))}
      </section>
    </>
  )
}
