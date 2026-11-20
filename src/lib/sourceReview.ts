import { isRadarRatingClass, radarClassDefinitions } from './radar/ratingPolicy'
import type { PublicGrade, PublicWorkRating } from './publicRelease'

export type SourceFinding = {
  kind: 'official' | 'community'
  grade: PublicGrade
  classes: string[]
  urls: string[]
}

export type SourceReview = {
  workId: string
  siteId: string | null
  edition?: { catalogTitle: string; isbn: string; sourceUrl: string; media: 'novel' | 'manga' }
  rationale: string
  findings: SourceFinding[]
  attributionOnly?: boolean
}

export function matchesReviewEdition(review: SourceReview, originalTitle: string, siteId: string | null) {
  if (siteId) return review.siteId === siteId && !review.edition
  const edition = review.edition
  if (review.siteId !== null || !edition || edition.catalogTitle !== originalTitle ||
      !['novel', 'manga'].includes(edition.media) || !/^97[89]\d{10}$/.test(edition.isbn)) return false
  const checksum = [...edition.isbn].reduce((value, digit, index) => value + Number(digit) * (index % 2 ? 3 : 1), 0)
  if (checksum % 10 !== 0 || !URL.canParse(edition.sourceUrl)) return false
  const url = new URL(edition.sourceUrl)
  return url.protocol === 'https:' && !url.username && !url.password && url.pathname !== '/'
}

export function resolveReview(review: SourceReview, previous: PublicWorkRating, grades: readonly PublicGrade[]): PublicWorkRating {
  if (!review.findings.length || !review.rationale.trim()) throw new Error(`Empty assessment for ${review.workId}`)
  for (const finding of review.findings) {
    if (!['official', 'community'].includes(finding.kind) || !grades.includes(finding.grade) ||
        !finding.urls.length || finding.urls.some(url => !/^https?:\/\//i.test(url) || new URL(url).username || new URL(url).password) ||
        !finding.classes.every(code => isRadarRatingClass(code) && radarClassDefinitions[code].grade === finding.grade)) {
      throw new Error(`Invalid source finding for ${review.workId}`)
    }
  }
  const ordered = [...review.findings].sort((a, b) =>
    grades.indexOf(b.grade) - grades.indexOf(a.grade) || Number(b.kind === 'official') - Number(a.kind === 'official'))
  const winner = ordered[0]
  if (review.attributionOnly && previous.grade !== winner.grade) throw new Error(`Stale attribution for ${review.workId}`)
  const classes = [...new Set(ordered.filter(f => f.grade === winner.grade).flatMap(f => f.classes))]
  if (!review.attributionOnly && !classes.length) throw new Error(`Missing deciding rating class for ${review.workId}`)
  const sources = ordered.flatMap(f => f.urls.map(url => ({ kind: f.kind, url })))
  const evidenceSources = [...new Map([...sources, ...(review.attributionOnly ? previous.evidenceSources || [] : [])]
    .map(s => [s.kind + '|' + s.url, s])).values()]
  return {
    ...(review.attributionOnly ? previous : {
      state: 'rated', grade: winner.grade, class: classes[0], classes,
      mode: 'single', needsMoreResearch: true, reasoningSummary: review.rationale,
    }),
    reviewMethod: review.attributionOnly ? 'attribution' : 'assessment',
    decidingSource: winner.kind, sourceFindings: ordered, evidenceSources, evidenceUrl: winner.urls[0],
  }
}
