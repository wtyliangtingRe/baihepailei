import { getPublicWorkList, type PublicWorkRecord } from '@/lib/publicRelease'
import { gradeLabel, mediaLabel, ratingClassEntries } from '@/lib/radar/publicPresentation'

import { canonicalContentUrl } from '../_lib/content-identity'

export type RecommendationCursor = { sOffset: number; aOffset: number }

export type RecommendationBatch = {
  cards: Array<{
    workId: string
    grade: 'S' | 'A'
    title: string
    href: string
    description: string
  }>
  next: RecommendationCursor | null
}

const firstBatch = { sOffset: 0, aOffset: 0 }
const batchSize = 18

function recommendationCards(works: PublicWorkRecord[], grade: 'S' | 'A') {
  return works.map((work) => {
    const classLabels = ratingClassEntries(work.rating).map(({ definition }) => definition.label).join('、')
    return {
      workId: work.workId,
      grade,
      title: work.title,
      href: canonicalContentUrl('works', work.workId),
      description: `${mediaLabel(work.media.group, work.media.type)} · ${classLabels || gradeLabel(grade)}`,
    }
  })
}

export function getRecommendationBatch(
  { sOffset, aOffset }: RecommendationCursor = firstBatch,
): RecommendationBatch {
  const filters = { status: 'rated', limit: batchSize }
  const s = getPublicWorkList({ ...filters, grade: 'S', offset: sOffset })
  const a = getPublicWorkList({ ...filters, grade: 'A', offset: aOffset })
  const total = s.total + a.total

  if (total && !s.items.length && !a.items.length) return getRecommendationBatch()

  // Keep the 12 S / 6 A mix when possible and fill from the other grade as one runs out.
  const sCount = Math.min(s.items.length, Math.max(12, batchSize - a.items.length))
  const sCards = recommendationCards(s.items.slice(0, sCount), 'S')
  const aCards = recommendationCards(a.items.slice(0, batchSize - sCount), 'A')
  const cards = [...sCards, ...aCards]

  const next = { sOffset: s.offset + sCards.length, aOffset: a.offset + aCards.length }
  const hasUnseen = next.sOffset < s.total || next.aOffset < a.total

  return { cards, next: hasUnseen ? next : total > cards.length ? firstBatch : null }
}
