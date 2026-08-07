import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = (relativePath) => fs.readFileSync(new URL(relativePath, root), 'utf8')
const exists = (relativePath) => fs.existsSync(new URL(relativePath, root))

test('exact repository feeds the existing Works AI panel without a second detail centre', () => {
  const workDetail = read('src/app/(frontend)/works/[slug]/page.tsx')
  const bridge = read('src/app/(frontend)/_lib/radar-public-rating-bridge.ts')
  const repository = read('src/app/(frontend)/_lib/radar-read-repository.ts')
  const trustCard = read('src/app/(frontend)/_components/WorkAssessmentTrustCard.tsx')

  assert.equal(exists('src/app/(frontend)/_components/RadarPublicProjection.tsx'), false)
  assert.doesNotMatch(workDetail, /RadarPublicProjection/u)
  assert.match(workDetail, /applyPublicRatingBridge/u)
  assert.match(workDetail, /readPublicRatingBridge/u)
  assert.match(workDetail, /<DetailIndexDetail item=\{bridgedItem\}/u)
  assert.match(workDetail, /<SearchIndexDetail item=\{bridgedItem\}/u)

  assert.match(bridge, /readRadarSnapshotForWork/u)
  assert.match(bridge, /selectRadarAuthority/u)
  assert.match(bridge, /if \(!state\.valid\) return 'labels_only'/u)
  assert.doesNotMatch(bridge, /@payload-config|getPayload|payload\.find|collection: 'radar-public-ratings'|collection: 'radar-public-records'/u)
  assert.doesNotMatch(bridge, /title:\s*\{ equals:/u)
  assert.doesNotMatch(bridge, /hasCanonicalWorksAssessment/u)
  assert.doesNotMatch(bridge, /payload\.(create|update|delete)/u)

  assert.match(repository, /collection: 'works'/u)
  assert.match(repository, /const siteId = clean\(work\.siteId\)/u)
  assert.match(repository, /return await readWithPayload\(payload, \{/u)
  assert.match(repository, /sourceDocuments:/u)
  assert.match(repository, /exactRecord && rawRecord \? rawRecord : null/u)
  assert.match(repository, /exactRating && rawRating \? rawRating : null/u)
  assert.match(repository, /exactCandidate && rawCandidate \? rawCandidate : null/u)
  assert.match(repository, /exactResearchDocuments/u)
  assert.doesNotMatch(repository, /title:\s*\{ equals:/u)

  assert.match(bridge, /selection\.authority === 'published'/u)
  assert.match(bridge, /selection\.authority === 'candidate'/u)
  assert.match(bridge, /selection\.authority === 'research'/u)
  assert.match(bridge, /bridge\.authority === 'research'[\s\S]*\? undefined[\s\S]*: bridge\.radarAssessment/u)
  assert.match(bridge, /researchPreview: bridge\.researchPreview/u)

  assert.match(trustCard, /runtimeAuthority === 'research'/u)
  assert.match(trustCard, /AI 候选结论（待发布）/u)
  assert.match(trustCard, /待发布，不进入目录/u)
  assert.match(trustCard, /范围兼容投影/u)
  assert.match(trustCard, /研究建议等级不会自动提升为 Candidate、Published 或固定 AI 等级/u)
  assert.match(trustCard, /AI 暂定评级范围/u)
  assert.match(trustCard, /固定 AI 等级/u)
  assert.match(trustCard, /独立展示，不覆盖人工评级/u)
})

test('explicit conclusion modes flow into presentation', () => {
  const presentation = read('src/lib/radar/assessmentPresentation.ts')
  const normalizer = read('src/lib/radar/conclusionNormalizer.mjs')
  assert.match(presentation, /conclusionMode: assessment\?\.conclusionMode/u)
  assert.match(normalizer, /explicitMode === 'blocked'/u)
  assert.match(normalizer, /explicitMode === 'labels_only'/u)
  assert.match(normalizer, /explicitMode === 'bounded_range'/u)
  assert.match(normalizer, /explicitMode === 'fixed_grade'/u)
  assert.match(normalizer, /bounded_range_not_distinct/u)
  assert.match(normalizer, /incomplete_fixed_grade_range/u)
  assert.match(normalizer, /machine_x_not_allowed/u)
})
