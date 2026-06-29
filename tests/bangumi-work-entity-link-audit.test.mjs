import test from 'node:test'
import assert from 'node:assert/strict'

import {
  auditBangumiWorkEntityLinkPreview,
  createBangumiWorkEntityLinkAuditReport,
} from '../tools/source_import/scripts/audit-bangumi-work-entity-link-preview.mjs'

function link(collection, name, overrides = {}) {
  return {
    collection,
    siteId: `${collection}:${name}`,
    slug: name.toLowerCase().replace(/\s+/gu, '-'),
    name,
    role: 'writer',
    originalRole: '脚本',
    matchedBy: 'name',
    source: {
      type: 'bangumi-credit-hint',
      role: 'writer',
      originalRole: '脚本',
      source: 'bangumi',
      rawLine: `- ${name} | role=writer | originalRole=脚本 | source=bangumi`,
    },
    ...overrides,
  }
}

function basePreview(overrides = {}) {
  return {
    meta: {
      source: 'bangumi-work-entity-link-preview',
      mode: 'preview-only-no-payload-write',
      worksSourceShape: 'works',
      worksTotal: 1,
      worksWithCreatorLinks: 1,
      worksWithOrganizationLinks: 1,
      creatorLinksTotal: 1,
      organizationLinksTotal: 1,
      unmatchedCreatorHintsTotal: 1,
      unmatchedOrganizationHintsTotal: 0,
      ambiguousCreatorHintsTotal: 0,
      ambiguousOrganizationHintsTotal: 0,
    },
    works: [
      {
        work: { title: 'Work A', slug: 'work-a', siteId: 'bangumi:1' },
        creatorHintCount: 2,
        organizationHintCount: 1,
        creators: [link('creators', 'Creator A')],
        organizations: [link('organizations', 'Studio A', { role: 'animation_studio', originalRole: '动画制作' })],
        unmatchedCreatorHints: [{ name: 'Missing Person', role: 'director', originalRole: '監督' }],
        unmatchedOrganizationHints: [],
        ambiguousCreatorHints: [],
        ambiguousOrganizationHints: [],
      },
    ],
    ...overrides,
  }
}

test('audit passes a valid work entity link preview', () => {
  const audit = auditBangumiWorkEntityLinkPreview(basePreview())

  assert.equal(audit.meta.mode, 'audit-only-no-payload-write')
  assert.equal(audit.meta.status, 'pass')
  assert.equal(audit.meta.errors, 0)
  assert.equal(audit.stats.worksTotal, 1)
  assert.equal(audit.stats.creatorLinksTotal, 1)
  assert.equal(audit.stats.organizationLinksTotal, 1)
})

test('audit fails invalid preview mode and meta count mismatch', () => {
  const preview = basePreview({
    meta: {
      ...basePreview().meta,
      mode: 'write-enabled',
      creatorLinksTotal: 99,
    },
  })
  const audit = auditBangumiWorkEntityLinkPreview(preview)

  assert.equal(audit.meta.status, 'fail')
  assert.ok(audit.issues.some((issue) => issue.code === 'invalid-preview-mode'))
  assert.ok(audit.issues.some((issue) => issue.code === 'meta-count-mismatch' && issue.path === 'meta.creatorLinksTotal'))
})

test('audit catches duplicate relations and missing source metadata', () => {
  const duplicate = link('creators', 'Creator A', { source: {} })
  const preview = basePreview()
  preview.works[0].creators.push(duplicate)
  preview.works[0].creatorHintCount = 3
  preview.meta.creatorLinksTotal = 2

  const audit = auditBangumiWorkEntityLinkPreview(preview)

  assert.equal(audit.meta.status, 'fail')
  assert.ok(audit.issues.some((issue) => issue.code === 'duplicate-work-link'))
  assert.ok(audit.issues.some((issue) => issue.code === 'missing-link-source-type'))
})

test('audit catches footnote-only hint names', () => {
  const preview = basePreview()
  preview.works[0].unmatchedCreatorHints.push({ name: '12)', role: 'script', originalRole: '脚本' })
  preview.works[0].creatorHintCount = 3
  preview.meta.unmatchedCreatorHintsTotal = 2

  const audit = auditBangumiWorkEntityLinkPreview(preview)

  assert.equal(audit.meta.status, 'fail')
  assert.ok(audit.issues.some((issue) => issue.code === 'footnote-only-hint-name'))
})

test('audit report includes safety summary', () => {
  const audit = auditBangumiWorkEntityLinkPreview(basePreview())
  const report = createBangumiWorkEntityLinkAuditReport(audit, { inputPath: 'preview.json' })

  assert.match(report, /Bangumi work\/entity link audit/u)
  assert.match(report, /本地只读审计/u)
  assert.match(report, /不调用 Payload API/u)
  assert.match(report, /unmatched hints/u)
})
