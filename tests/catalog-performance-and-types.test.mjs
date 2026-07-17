import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const works = read('src/app/(frontend)/works/page.tsx')
const search = read('src/app/(frontend)/search/search-client.tsx')
const recommendations = read('src/app/(frontend)/_lib/recommendations.ts')
const detailLayout = read('src/app/(frontend)/detail-layout-fixes.css')
const assessmentBadge = read('src/app/(frontend)/_components/AssessmentOriginBadge.tsx')

test('works page caches sort, titles and normalized search blobs', () => {
  assert.match(works, /cachedSortedWorks/u)
  assert.match(works, /titleCache/u)
  assert.match(works, /searchBlobCache/u)
  assert.match(works, /workFormatLabels/u)
  assert.match(works, /work-type-chip/u)
})

test('client search defers typing and reuses the exported index', () => {
  assert.match(search, /useDeferredValue/u)
  assert.match(search, /cache: 'force-cache'/u)
  assert.match(search, /activeMedia/u)
  assert.match(search, /activeRank/u)
})

test('recommendations demote uncertain AI grades and high-risk ranks', () => {
  assert.match(recommendations, /ai_synthesized_pending_review/u)
  assert.match(recommendations, /rank === 'X'/u)
  assert.match(recommendations, /needsHumanReview/u)
  assert.match(recommendations, /confidencePercent/u)
  assert.match(recommendations, /evidenceCoveragePercent/u)
})

test('detail titles wrap in full instead of using an ellipsis', () => {
  const detailHeadingRule = detailLayout.match(/\.detail-hero h1\s*\{(?<body>[^}]*)\}/u)?.groups?.body || ''
  assert.match(detailHeadingRule, /white-space:\s*normal/u)
  assert.match(detailHeadingRule, /overflow-wrap:\s*anywhere/u)
  assert.match(detailHeadingRule, /text-wrap:\s*wrap/u)
  assert.doesNotMatch(detailHeadingRule, /text-wrap:\s*balance/u)
  assert.doesNotMatch(detailHeadingRule, /text-overflow:\s*ellipsis/u)
  assert.doesNotMatch(detailHeadingRule, /white-space:\s*nowrap/u)
  assert.match(detailLayout, /\.detail-hero-layout > div:only-child/u)
  assert.match(detailLayout, /grid-column:\s*1 \/ -1/u)
})

test('AI assessment origin is visible without pretending it is human review', () => {
  assert.match(works, /AssessmentOriginBadge/u)
  assert.match(search, /AssessmentOriginBadge/u)
  assert.match(assessmentBadge, /AI 已评估 · 待人工复核/u)
  assert.match(assessmentBadge, /AI 辅助 · 人工已复核/u)
  assert.doesNotMatch(assessmentBadge, /AI 已人工审核/u)
})
