import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBangumiWorkEntityLinkPreview,
  createBangumiWorkEntityLinkPreviewReport,
  extractBangumiCreditHints,
} from '../tools/source_import/scripts/build-bangumi-work-entity-link-preview.mjs'

function work(title, evidenceNote) {
  return {
    title,
    slug: title.toLowerCase().replace(/\s+/gu, '-'),
    siteId: `bangumi:${title}`,
    externalIds: { bangumiSubjectId: title },
    evidenceNote,
  }
}

const note = `## Bangumi 简介候选
Sample.

## Bangumi 创作者职位候选
- Creator A | role=writer | originalRole=脚本 | source=bangumi | note=sample
- Missing Person | role=director | source=bangumi

## Bangumi 机构/制作候选
- Studio A | role=animation_studio | originalRole=动画制作 | source=bangumi
`

const worksSeed = {
  works: [
    work('Work A', note),
    work('Work B', `## Bangumi 创作者职位候选
- Creator A | role=writer | source=bangumi
- Creator A | role=writer | source=bangumi
`),
  ],
}

const entitySeed = {
  creators: [
    { name: 'Creator A', slug: 'creator-a', siteId: 'creator-a', status: 'draft', isLiteVisible: false, isFullVisible: false },
  ],
  organizations: [
    { name: 'Studio A', slug: 'studio-a', siteId: 'studio-a', status: 'draft', isLiteVisible: false, isFullVisible: false },
  ],
}

test('extractBangumiCreditHints parses creator and organization sections from evidenceNote', () => {
  const hints = extractBangumiCreditHints(worksSeed.works[0])

  assert.equal(hints.creators.length, 2)
  assert.equal(hints.creators[0].name, 'Creator A')
  assert.equal(hints.creators[0].role, 'writer')
  assert.equal(hints.organizations.length, 1)
  assert.equal(hints.organizations[0].name, 'Studio A')
})

test('work entity link preview matches imported draft entities and keeps unmatched hints', () => {
  const preview = buildBangumiWorkEntityLinkPreview(worksSeed, entitySeed)

  assert.equal(preview.meta.mode, 'preview-only-no-payload-write')
  assert.equal(preview.meta.worksTotal, 2)
  assert.equal(preview.meta.worksWithCreatorLinks, 2)
  assert.equal(preview.meta.worksWithOrganizationLinks, 1)
  assert.equal(preview.meta.creatorLinksTotal, 2)
  assert.equal(preview.meta.organizationLinksTotal, 1)
  assert.equal(preview.meta.unmatchedCreatorHintsTotal, 1)
  assert.equal(preview.works[0].creators[0].siteId, 'creator-a')
  assert.equal(preview.works[0].organizations[0].siteId, 'studio-a')
  assert.equal(preview.works[0].unmatchedCreatorHints[0].name, 'Missing Person')
  assert.equal(preview.works[1].creators.length, 1)
})

test('work entity link preview report includes safety summary', () => {
  const preview = buildBangumiWorkEntityLinkPreview(worksSeed, entitySeed)
  const report = createBangumiWorkEntityLinkPreviewReport(preview, { worksInputPath: 'works.json', entitiesInputPath: 'entities.json' })

  assert.match(report, /Bangumi works ↔ entities 关系预览/u)
  assert.match(report, /不调用 Payload API/u)
  assert.match(report, /Creator A\(writer\)/u)
  assert.match(report, /Missing Person\(director\)/u)
})
