import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBgmIdMap,
  createBgmIdMapReport,
} from '../tools/source_import/scripts/build-bgm-id-map.mjs'

import {
  auditBgmIdMap,
  createBgmIdMapAuditReport,
} from '../tools/source_import/scripts/audit-bgm-id-map.mjs'

function workPackage(overrides = {}) {
  return {
    meta: { source: 'bangumi-media-work-package-preview', mode: 'package-preview-only-no-payload-write' },
    works: [
      { title: '作品A', slug: 'work-a', bangumiSubjectId: '1001', mediaGroup: 'manga', mediaType: 'manga' },
      { title: '作品B', slug: 'work-b', bangumiSubjectId: '1002', mediaGroup: 'game', mediaType: 'visual_novel' },
    ],
    ...overrides,
  }
}

function entityPackage(overrides = {}) {
  return {
    meta: { source: 'bangumi-media-entity-seed-package-preview', mode: 'package-preview-only-no-payload-write' },
    creators: [
      { name: '作者A', slug: 'author-a', status: 'draft' },
    ],
    organizations: [
      { name: '出版社A', slug: 'publisher-a', status: 'draft' },
    ],
    ...overrides,
  }
}

test('BGM ID map matches works and entities by stable fields', async () => {
  const lookupCalls = []
  const map = await buildBgmIdMap(workPackage(), entityPackage(), {
    generatedAt: '2026-06-29T00:00:00.000Z',
    lookup: async (collection, queries) => {
      lookupCalls.push({ collection, queries })
      if (collection === 'works') {
        const siteId = queries.find((query) => query.field === 'siteId')?.value
        return [{ id: `id-${siteId}`, title: siteId === 'bangumi-1001' ? '作品A' : '作品B', slug: siteId === 'bangumi-1001' ? 'work-a' : 'work-b', siteId, status: 'draft' }]
      }
      if (collection === 'creators') return [{ id: 'creator-1', name: '作者A', slug: 'author-a', status: 'draft' }]
      return [{ id: 'organization-1', name: '出版社A', slug: 'publisher-a', status: 'draft' }]
    },
  })

  assert.equal(lookupCalls.length, 4)
  assert.equal(map.meta.source, 'bgm-id-map')
  assert.equal(map.meta.mode, 'read-only-local-query')
  assert.equal(map.meta.safety.changes, false)
  assert.equal(map.meta.safety.relationPatch, false)
  assert.equal(map.meta.stats.worksMatchedTotal, 2)
  assert.equal(map.meta.stats.creatorsMatchedTotal, 1)
  assert.equal(map.meta.stats.organizationsMatchedTotal, 1)
  assert.equal(map.works[0].payload.id, 'id-bangumi-1001')
})

test('BGM ID map records entity name collisions without failing the map', async () => {
  const map = await buildBgmIdMap(workPackage({ works: [] }), entityPackage(), {
    lookup: async (collection) => {
      if (collection === 'creators') return [
        { id: 'creator-new', name: '作者A', slug: 'author-a', status: 'draft' },
        { id: 'creator-old', name: '作者A', slug: 'legacy-author-a', status: 'draft' },
      ]
      return [{ id: 'organization-1', name: '出版社A', slug: 'publisher-a', status: 'draft' }]
    },
  })

  assert.equal(map.creators[0].status, 'matched')
  assert.equal(map.creators[0].payload.id, 'creator-new')
  assert.equal(map.creators[0].nameCollisions.length, 1)
  assert.equal(map.meta.stats.entityNameCollisionRowsTotal, 1)
  assert.equal(map.meta.stats.entityNameCollisionDocsTotal, 1)
})

test('BGM ID map reports missing, ambiguous, and query errors', async () => {
  const map = await buildBgmIdMap(workPackage(), entityPackage(), {
    lookup: async (collection, queries) => {
      if (collection === 'works') {
        const siteId = queries.find((query) => query.field === 'siteId')?.value
        if (siteId === 'bangumi-1001') return []
        return [
          { id: 'work-a', title: '作品B', slug: 'work-b', siteId: 'bangumi-1002' },
          { id: 'work-b', title: '作品B', slug: 'work-b-other', siteId: 'bangumi-1002' },
        ]
      }
      if (collection === 'creators') throw new Error('offline')
      return [{ id: 'organization-1', name: '出版社A', slug: 'publisher-a' }]
    },
  })

  assert.equal(map.meta.stats.worksMissingTotal, 1)
  assert.equal(map.meta.stats.worksAmbiguousTotal, 1)
  assert.equal(map.meta.stats.creatorsQueryErrorsTotal, 1)
  assert.equal(map.organizations[0].status, 'matched')
})

test('BGM ID map audit passes complete map and records collision info', async () => {
  const map = await buildBgmIdMap(workPackage({ works: [] }), entityPackage(), {
    lookup: async (collection) => {
      if (collection === 'creators') return [
        { id: 'creator-new', name: '作者A', slug: 'author-a' },
        { id: 'creator-old', name: '作者A', slug: 'legacy-author-a' },
      ]
      return [{ id: 'organization-1', name: '出版社A', slug: 'publisher-a' }]
    },
  })
  const audit = auditBgmIdMap(map, { generatedAt: '2026-06-29T01:00:00.000Z' })

  assert.equal(audit.source, 'bgm-id-map-audit')
  assert.equal(audit.status, 'pass')
  assert.equal(audit.errors.length, 0)
  assert.ok(audit.infos.some((info) => info.code === 'entity-name-collisions'))
})

test('BGM ID map audit fails incomplete map', async () => {
  const map = await buildBgmIdMap(workPackage(), entityPackage(), {
    lookup: async () => [],
  })
  const audit = auditBgmIdMap(map)
  const codes = audit.errors.map((error) => error.code)

  assert.equal(audit.status, 'fail')
  assert.ok(codes.includes('works-not-matched'))
  assert.ok(codes.includes('creators-not-matched'))
  assert.ok(codes.includes('organizations-not-matched'))
})

test('BGM ID map audit detects stats mismatch and unsafe flags', async () => {
  const map = await buildBgmIdMap(workPackage({ works: [] }), entityPackage(), {
    lookup: async (collection) => collection === 'creators'
      ? [{ id: 'creator-1', name: '作者A', slug: 'author-a' }]
      : [{ id: 'organization-1', name: '出版社A', slug: 'publisher-a' }],
  })
  map.meta.safety.changes = true
  map.meta.stats.creatorsMatchedTotal = 99
  const audit = auditBgmIdMap(map)
  const codes = audit.errors.map((error) => error.code)

  assert.equal(audit.status, 'fail')
  assert.ok(codes.includes('unsafe-changes-flag'))
  assert.ok(codes.includes('stats-mismatch'))
})

test('BGM ID map reports include summary sections', async () => {
  const map = await buildBgmIdMap(workPackage({ works: [] }), entityPackage(), {
    lookup: async (collection) => collection === 'creators'
      ? [{ id: 'creator-1', name: '作者A', slug: 'author-a' }]
      : [{ id: 'organization-1', name: '出版社A', slug: 'publisher-a' }],
  })
  const report = createBgmIdMapReport(map)
  const audit = auditBgmIdMap(map)
  const auditReport = createBgmIdMapAuditReport(audit)

  assert.match(report, /# BGM ID map/)
  assert.match(report, /Read-only local query/)
  assert.match(report, /Creators/)
  assert.match(auditReport, /# BGM ID map audit/)
  assert.match(auditReport, /status: pass/)
})
