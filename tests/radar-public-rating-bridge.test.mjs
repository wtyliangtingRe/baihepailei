import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)

const read = (relativePath) =>
  fs.readFileSync(new URL(relativePath, root), 'utf8')

const exists = (relativePath) =>
  fs.existsSync(new URL(relativePath, root))

test('public ratings feed the existing Works AI panel without a second detail centre', () => {
  const workDetail = read(
    'src/app/(frontend)/works/[slug]/page.tsx',
  )

  const bridge = read(
    'src/app/(frontend)/_lib/radar-public-rating-bridge.ts',
  )

  const trustCard = read(
    'src/app/(frontend)/_components/WorkAssessmentTrustCard.tsx',
  )

  assert.equal(
    exists(
      'src/app/(frontend)/_components/RadarPublicProjection.tsx',
    ),
    false,
  )

  assert.doesNotMatch(
    workDetail,
    /RadarPublicProjection/,
  )

  assert.match(
    workDetail,
    /applyPublicRatingBridge/,
  )

  assert.match(
    workDetail,
    /readPublicRatingBridge/,
  )

  assert.match(
    workDetail,
    /<DetailIndexDetail item=\{bridgedItem\}/,
  )

  assert.match(
    workDetail,
    /<SearchIndexDetail item=\{bridgedItem\}/,
  )

  assert.match(
    bridge,
    /collection: 'radar-public-ratings'/,
  )

  assert.match(
    bridge,
    /collection: 'radar-public-records'/,
  )

  assert.match(
    bridge,
    /Promise\.all/,
  )

  assert.match(
    bridge,
    /clean\(record\?\.publicationKey\) === publicationKey/,
  )

  assert.match(
    bridge,
    /publicState === 'needs_more_research'/,
  )

  assert.match(
    bridge,
    /researchStatus === 'needs_more_research'/,
  )

  assert.match(
    bridge,
    /\['B', 'C'\]\.includes\(clean\(item\?\.tier\)\)/,
  )

  assert.match(
    bridge,
    /return 'primary_material_confirmed'/,
  )

  assert.doesNotMatch(
    bridge,
    /sourceReferenceCount[\s\S]*factRefs/,
  )

  assert.match(
    bridge,
    /suggestedGrade: coreGrade/,
  )

  assert.match(
    bridge,
    /matchedRules: matchedClasses\.map/,
  )

  assert.match(
    bridge,
    /hasCanonicalWorksAssessment/,
  )

  assert.doesNotMatch(
    bridge,
    /humanAssessment\s*:/,
  )

  assert.doesNotMatch(
    bridge,
    /payload\.(create|update|delete)/,
  )

  assert.match(
    trustCard,
    /AI 建议与规则分析/,
  )

  assert.match(
    trustCard,
    /独立展示，不覆盖人工评级/,
  )
})
