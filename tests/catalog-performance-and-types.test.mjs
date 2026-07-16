import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const works = read('src/app/(frontend)/works/page.tsx')
const search = read('src/app/(frontend)/search/search-client.tsx')
const recommendations = read('src/app/(frontend)/_lib/recommendations.ts')
const packageJson = JSON.parse(read('package.json'))

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

test('frontend validation uses a Next-compatible TypeScript and a non-recursive command', () => {
  assert.equal(packageJson.devDependencies.typescript, '5.9.3')
  assert.doesNotMatch(packageJson.scripts['test:frontend-polish'], /pnpm test:frontend-polish/u)
  assert.match(packageJson.scripts['test:frontend-polish'], /catalog-performance-and-types\.test\.mjs/u)
})
