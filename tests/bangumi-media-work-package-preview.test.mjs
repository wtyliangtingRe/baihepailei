import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBangumiMediaWorkPackagePreview,
  createBangumiMediaWorkPackagePreviewReport,
  parseJsonLines,
} from '../tools/source_import/scripts/build-bangumi-media-work-package-preview.mjs'

import {
  auditBangumiMediaWorkPackagePreview,
  createBangumiMediaWorkPackagePreviewAuditReport,
} from '../tools/source_import/scripts/audit-bangumi-media-work-package-preview.mjs'

function candidate(overrides = {}) {
  return {
    source: 'bangumi-media-normalize-preview',
    mode: 'candidate-work-preview-only',
    title: '样本漫画',
    slug: 'sample-manga',
    mediaGroup: 'book',
    mediaType: 'manga',
    bangumiSubjectId: '1001',
    aliases: ['Sample Manga'],
    summary: '一条样本简介。',
    cover: {
      large: 'https://example.test/cover.jpg',
    },
    creatorCreditHints: [
      { name: '作者A', role: 'original_creator', originalRole: '作者', source: 'bangumi' },
    ],
    organizationCreditHints: [
      { name: '出版社B', role: 'publisher', originalRole: '出版社', source: 'bangumi' },
    ],
    ...overrides,
  }
}

test('work package preview preserves candidate fields and stays no-write', () => {
  const pkg = buildBangumiMediaWorkPackagePreview([candidate()], {
    generatedAt: '2026-06-29T00:00:00.000Z',
  })
  const work = pkg.works[0]

  assert.equal(pkg.meta.source, 'bangumi-media-work-package-preview')
  assert.equal(pkg.meta.mode, 'package-preview-only-no-payload-write')
  assert.equal(pkg.meta.safety.payloadWrite, false)
  assert.equal(pkg.meta.safety.databaseWrite, false)
  assert.equal(pkg.meta.safety.workImport, false)
  assert.equal(pkg.meta.safety.coverUpload, false)
  assert.equal(pkg.meta.stats.worksTotal, 1)
  assert.equal(pkg.meta.stats.creatorCreditHintsTotal, 1)
  assert.equal(pkg.meta.stats.organizationCreditHintsTotal, 1)
  assert.equal(pkg.meta.stats.rowsWithCoverReferences, 1)
  assert.equal(work.collection, 'works')
  assert.equal(work.kind, 'media-work')
  assert.equal(work.title, '样本漫画')
  assert.equal(work.bangumiSubjectId, '1001')
  assert.equal(work.coverPreview.upload, false)
  assert.equal(work.coverPreview.referenceOnly, true)
  assert.equal(work.creatorCreditHints[0].name, '作者A')
  assert.equal(work.organizationCreditHints[0].name, '出版社B')
})

test('work package audit passes valid package and records cover reference info', () => {
  const pkg = buildBangumiMediaWorkPackagePreview([candidate()])
  const audit = auditBangumiMediaWorkPackagePreview(pkg, {
    generatedAt: '2026-06-29T01:00:00.000Z',
  })

  assert.equal(audit.source, 'bangumi-media-work-package-preview-audit')
  assert.equal(audit.mode, 'audit-only-no-payload-write')
  assert.equal(audit.status, 'pass')
  assert.equal(audit.errors.length, 0)
  assert.equal(audit.stats.worksTotal, 1)
  assert.equal(audit.stats.creatorCreditHintsTotal, 1)
  assert.equal(audit.stats.organizationCreditHintsTotal, 1)
  assert.equal(audit.stats.rowsWithCoverReferences, 1)
  assert.ok(audit.infos.some((info) => info.code === 'cover-references-present'))
})

test('work package audit fails unsafe and malformed rows', () => {
  const pkg = buildBangumiMediaWorkPackagePreview([candidate(), candidate({ title: '重复', slug: 'sample-manga', bangumiSubjectId: '1001' })])
  pkg.meta.source = 'wrong-source'
  pkg.meta.mode = 'apply'
  pkg.meta.safety.payloadWrite = true
  pkg.meta.stats.worksTotal = 99
  pkg.works[0].collection = 'other'
  pkg.works[0].kind = 'other'
  pkg.works[0].title = ''
  pkg.works[0].slug = ''
  pkg.works[0].bangumiSubjectId = ''
  pkg.works[0].mediaGroup = ''
  pkg.works[0].mediaType = ''
  pkg.works[0].status = 'published'
  pkg.works[0].importAction = 'update'
  pkg.works[0].source = 'other'
  pkg.works[0].safety.payloadWrite = true
  pkg.works[0].coverPreview.upload = true
  pkg.works[0].evidence = []

  const audit = auditBangumiMediaWorkPackagePreview(pkg)
  const codes = audit.errors.map((error) => error.code)

  assert.equal(audit.status, 'fail')
  assert.ok(codes.includes('unexpected-source'))
  assert.ok(codes.includes('unexpected-mode'))
  assert.ok(codes.includes('unsafe-package-flag'))
  assert.ok(codes.includes('unexpected-work-collection'))
  assert.ok(codes.includes('unexpected-work-kind'))
  assert.ok(codes.includes('missing-work-title'))
  assert.ok(codes.includes('missing-work-slug'))
  assert.ok(codes.includes('missing-bangumi-subject-id'))
  assert.ok(codes.includes('missing-media-group'))
  assert.ok(codes.includes('missing-media-type'))
  assert.ok(codes.includes('unexpected-work-status'))
  assert.ok(codes.includes('unexpected-import-action'))
  assert.ok(codes.includes('unexpected-work-source'))
  assert.ok(codes.includes('unsafe-work-flag'))
  assert.ok(codes.includes('cover-upload-not-disabled'))
  assert.ok(codes.includes('missing-work-evidence'))
  assert.ok(codes.includes('works-total-mismatch'))
})

test('work package audit detects duplicate Bangumi ids and slugs', () => {
  const pkg = buildBangumiMediaWorkPackagePreview([
    candidate(),
    candidate({ title: '重复作品', slug: 'sample-manga', bangumiSubjectId: '1001' }),
  ])
  const audit = auditBangumiMediaWorkPackagePreview(pkg)
  const codes = audit.errors.map((error) => error.code)

  assert.equal(audit.status, 'fail')
  assert.ok(codes.includes('duplicate-bangumi-subject-id'))
  assert.ok(codes.includes('duplicate-work-slug'))
})

test('work package reports include safety and summary sections', () => {
  const pkg = buildBangumiMediaWorkPackagePreview([candidate()])
  const previewReport = createBangumiMediaWorkPackagePreviewReport(pkg)
  const audit = auditBangumiMediaWorkPackagePreview(pkg)
  const auditReport = createBangumiMediaWorkPackagePreviewAuditReport(audit)

  assert.match(previewReport, /# Bangumi media work package preview/)
  assert.match(previewReport, /No Payload connection/)
  assert.match(previewReport, /Cover values are reference-only/)
  assert.match(previewReport, /样本漫画/)
  assert.match(auditReport, /# Bangumi media work package preview audit/)
  assert.match(auditReport, /status: pass/)
  assert.match(auditReport, /Cover references are not uploaded/)
})

test('parseJsonLines reads non-empty JSONL rows', () => {
  const rows = parseJsonLines(`${JSON.stringify(candidate({ title: 'A' }))}\n\n${JSON.stringify(candidate({ title: 'B' }))}\n`)

  assert.equal(rows.length, 2)
  assert.equal(rows[0].title, 'A')
  assert.equal(rows[1].title, 'B')
})
