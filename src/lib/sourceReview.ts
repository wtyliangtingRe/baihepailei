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
  continuity?: { workId: string; character: string }[]
  supportingSources?: { kind: SourceFinding['kind']; url: string }[]
  attributionOnly?: boolean
}

export function matchesReviewEdition(review: SourceReview, originalTitle: string, siteId: string | null,
  recovered?: { catalogTitle: string; siteId: string; isbn?: string }) {
  if (recovered) {
    if (siteId || recovered.catalogTitle !== originalTitle) return false
    if (!review.edition) return review.siteId === recovered.siteId
    if (!recovered.isbn || review.edition.isbn !== recovered.isbn) return false
  }
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
  const continuity = review.continuity || []
  const usesContinuity = ordered.some(finding => finding.classes.includes('C-CONTINUITY-EF'))
  if (usesContinuity !== Boolean(continuity.length) ||
      continuity.some(link => !/^\d+$/.test(link.workId) || link.workId === review.workId || !link.character.trim())) {
    throw new Error(`Invalid continuity reference for ${review.workId}`)
  }
  for (const source of review.supportingSources || []) {
    const url = new URL(source.url)
    if (!['official', 'community'].includes(source.kind) || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new Error(`Invalid supporting source for ${review.workId}`)
    }
  }
  const sources = ordered.flatMap(f => f.urls.map(url => ({ kind: f.kind, url })))
  const evidenceSources = [...new Map([...sources, ...(review.attributionOnly ? previous.evidenceSources || [] : [])]
    .map(s => [s.kind + '|' + s.url, s])).values()]
  const retainedClasses = review.attributionOnly
    ? [...(previous.classes || []), previous.class].filter((code): code is string =>
        typeof code === 'string' && isRadarRatingClass(code) && radarClassDefinitions[code].grade === winner.grade)
    : []
  const mergedClasses = [...new Set([...retainedClasses, ...classes])]
  return {
    ...(review.attributionOnly ? previous : {
      state: 'rated', grade: winner.grade,
      mode: 'single', needsMoreResearch: true, reasoningSummary: review.rationale,
    }),
    class: previous.class && retainedClasses.includes(previous.class) ? previous.class : mergedClasses[0],
    classes: mergedClasses,
    reviewMethod: review.attributionOnly ? 'attribution' : 'assessment',
    ...(classes.includes('C-CONTINUITY-EF') && { continuity }),
    ...(review.supportingSources?.length && { supportingSources: review.supportingSources }),
    decidingSource: winner.kind, sourceFindings: ordered, evidenceSources, evidenceUrl: winner.urls[0],
  }
}
