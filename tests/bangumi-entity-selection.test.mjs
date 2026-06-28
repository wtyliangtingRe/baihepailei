import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createBangumiEntitySelectionReport,
  selectBangumiEntities,
} from '../tools/source_import/scripts/select-bangumi-entities.mjs'

const review = {
  meta: {
    worksTotal: 10,
    creatorsTotal: 4,
    organizationsTotal: 4,
  },
  creators: [
    {
      kind: 'creator',
      key: 'creator-a',
      name: '吉田玲子',
      hintCount: 5,
      worksCount: 3,
      roles: [{ role: 'script', count: 5 }],
      sampleWorks: [{ title: '作品A' }],
      reviewFlags: [],
    },
    {
      kind: 'creator',
      key: 'creator-b',
      name: '新房昭之',
      hintCount: 1,
      worksCount: 1,
      roles: [{ role: 'director', count: 1 }],
      sampleWorks: [{ title: '作品B' }],
      reviewFlags: [],
    },
    {
      kind: 'creator',
      key: 'creator-c',
      name: 'Cygames',
      hintCount: 4,
      worksCount: 4,
      roles: [{ role: 'original_creator', count: 4 }],
      sampleWorks: [{ title: '作品C' }],
      reviewFlags: ['appears_in_both_lists'],
    },
  ],
  organizations: [
    {
      kind: 'organization',
      key: 'org-a',
      name: 'TOKYO MX',
      hintCount: 10,
      worksCount: 7,
      roles: [{ role: 'broadcaster', count: 10 }],
      sampleWorks: [{ title: '作品A' }],
      reviewFlags: [],
    },
    {
      kind: 'organization',
      key: 'org-b',
      name: 'SHAFT',
      hintCount: 2,
      worksCount: 2,
      roles: [{ role: 'animation_studio', count: 2 }],
      sampleWorks: [{ title: '作品B' }],
      reviewFlags: [],
    },
    {
      kind: 'organization',
      key: 'org-c',
      name: '武智恒雄',
      hintCount: 5,
      worksCount: 5,
      roles: [{ role: 'committee', count: 5 }],
      sampleWorks: [{ title: '作品C' }],
      reviewFlags: ['organization_name_may_be_person'],
    },
  ],
}

test('Bangumi entity selection splits selected, review, and below-threshold candidates', () => {
  const selection = selectBangumiEntities(review, {
    minCreatorWorks: 2,
    minOrganizationWorks: 3,
  })

  assert.deepEqual(selection.selectedCreators.map((item) => item.name), ['吉田玲子'])
  assert.deepEqual(selection.belowThresholdCreators.map((item) => item.name), ['新房昭之'])
  assert.deepEqual(selection.reviewCreators.map((item) => item.name), ['Cygames'])

  assert.deepEqual(selection.selectedOrganizations.map((item) => item.name), ['TOKYO MX'])
  assert.deepEqual(selection.belowThresholdOrganizations.map((item) => item.name), ['SHAFT'])
  assert.deepEqual(selection.reviewOrganizations.map((item) => item.name), ['武智恒雄'])

  assert.equal(selection.meta.selectedCreators, 1)
  assert.equal(selection.meta.selectedOrganizations, 1)
  assert.equal(selection.meta.reviewCreators, 1)
  assert.equal(selection.meta.reviewOrganizations, 1)
})

test('Bangumi entity selection report renders summary and tables', () => {
  const selection = selectBangumiEntities(review, {
    minCreatorWorks: 2,
    minOrganizationWorks: 3,
  })
  const report = createBangumiEntitySelectionReport(selection, { inputPath: 'entities.json', topLimit: 10 })

  assert.match(report, /Bangumi 候选实体选择预览/u)
  assert.match(report, /选中 creator：1/u)
  assert.match(report, /选中 organization：1/u)
  assert.match(report, /选中 creator 候选/u)
  assert.match(report, /高频复核 organization 候选/u)
  assert.match(report, /吉田玲子/u)
  assert.match(report, /TOKYO MX/u)
})
