import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBangumiSelectedEntitySeed,
  createBangumiSelectedEntitySeedReport,
} from '../tools/source_import/scripts/build-bangumi-selected-entity-seed.mjs'

const selection = {
  meta: {
    sourceWorksTotal: 10,
    selectedCreators: 2,
    selectedOrganizations: 1,
  },
  selectedCreators: [
    {
      name: '吉田玲子',
      suggestedSlug: 'creator-abc',
      key: 'creator:abc',
      worksCount: 3,
      hintCount: 5,
      roles: [{ role: 'script', count: 5 }],
      originalRoles: [{ role: '脚本', count: 5 }],
      sampleWorks: [{ title: '作品A', slug: 'work-a' }],
    },
    {
      name: '新房昭之',
      suggestedSlug: 'creator-def',
      key: 'creator:def',
      worksCount: 2,
      hintCount: 2,
      roles: [{ role: 'director', count: 2 }],
      sampleWorks: [{ title: '作品B', slug: 'work-b' }],
    },
  ],
  selectedOrganizations: [
    {
      name: 'TOKYO MX',
      suggestedSlug: 'organization-abc',
      key: 'organization:abc',
      worksCount: 7,
      hintCount: 10,
      roles: [{ role: 'broadcaster', count: 10 }],
      sampleWorks: [{ title: '作品A', slug: 'work-a' }],
    },
  ],
  reviewCreators: [
    { name: 'Cygames', suggestedSlug: 'creator-review', key: 'creator:review', worksCount: 4, hintCount: 4, reviewFlags: ['appears_in_both_lists'] },
  ],
  belowThresholdOrganizations: [
    { name: 'SHAFT', suggestedSlug: 'organization-low', key: 'organization:low', worksCount: 2, hintCount: 2, reviewFlags: [] },
  ],
}

test('selected Bangumi entity seed only uses selected candidates', () => {
  const seed = buildBangumiSelectedEntitySeed(selection)

  assert.equal(seed.meta.sourceWorksTotal, 10)
  assert.equal(seed.meta.creatorsTotal, 2)
  assert.equal(seed.meta.organizationsTotal, 1)
  assert.equal(seed.meta.mode, 'preview-only')

  assert.deepEqual(seed.creators.map((item) => item.name), ['吉田玲子', '新房昭之'])
  assert.deepEqual(seed.organizations.map((item) => item.name), ['TOKYO MX'])
  assert.equal(seed.creators.some((item) => item.name === 'Cygames'), false)
  assert.equal(seed.organizations.some((item) => item.name === 'SHAFT'), false)
})

test('selected Bangumi entity seed keeps safe draft metadata and evidence note', () => {
  const seed = buildBangumiSelectedEntitySeed(selection)
  const creator = seed.creators[0]

  assert.equal(creator.status, 'draft')
  assert.equal(creator.reviewStatus, 'pending')
  assert.equal(creator.source, 'bangumi-selected-preview')
  assert.equal(creator.sourceKey, 'creator:abc')
  assert.match(creator.evidenceNote, /Generated from Bangumi selected entity preview/u)
  assert.match(creator.evidenceNote, /Covered works: 3/u)
  assert.match(creator.evidenceNote, /Roles: script:5/u)
})

test('selected Bangumi entity seed report renders summary and tables', () => {
  const seed = buildBangumiSelectedEntitySeed(selection)
  const report = createBangumiSelectedEntitySeedReport(seed, { inputPath: 'selection.json', topLimit: 10 })

  assert.match(report, /Bangumi selected 实体 seed 预览/u)
  assert.match(report, /seed creator 草稿：2/u)
  assert.match(report, /seed organization 草稿：1/u)
  assert.match(report, /creator seed 草稿/u)
  assert.match(report, /organization seed 草稿/u)
  assert.match(report, /吉田玲子/u)
  assert.match(report, /TOKYO MX/u)
})
