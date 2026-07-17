import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const searchExporter = read('scripts/export/build-lite-search-index.mjs')
const detailExporter = read('scripts/export/build-lite-detail-index.mjs')
const detailEnricher = read('scripts/export/enrich-lite-detail-index.mjs')
const identity = read('src/app/(frontend)/_lib/content-identity.ts')
const workRoute = read('src/app/(frontend)/works/[slug]/page.tsx')
const prompt = read('src/app/(frontend)/_components/FeedbackPrompt.tsx')

test('public content URLs use Payload record IDs instead of third-party slugs', () => {
  assert.match(searchExporter, /recordId: String\(doc\.id\)/u)
  assert.match(searchExporter, /`\/works\/w-\$\{encodeURIComponent\(String\(recordId\)\)\}`/u)
  assert.match(searchExporter, /`\/creators\/c-\$\{encodeURIComponent\(String\(recordId\)\)\}`/u)
  assert.match(searchExporter, /`\/organizations\/o-\$\{encodeURIComponent\(String\(recordId\)\)\}`/u)
  assert.match(detailExporter, /recordId: String\(doc\.id\)/u)
  assert.match(detailEnricher, /recordId: searchItem\.recordId \|\| detailItem\.recordId/u)
  assert.match(identity, /canonicalContentRouteKey/u)
  assert.match(workRoute, /isCanonicalContentRoute/u)
  assert.match(workRoute, /redirect\(detailItem\.url\)/u)
})

test('feedback relationships use the real Works primary key', () => {
  assert.match(prompt, /item\.recordId/u)
  assert.doesNotMatch(prompt, /workId', item\.id/u)
})
