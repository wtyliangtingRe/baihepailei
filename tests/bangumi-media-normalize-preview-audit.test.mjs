import test from 'node:test'
import assert from 'node:assert/strict'

import {
  auditBangumiMediaNormalizePreview,
  createBangumiMediaNormalizePreviewAuditReport,
} from '../tools/source_import/scripts/audit-bangumi-media-normalize-preview.mjs'

function validCandidate(overrides = {}) {
  return {
    siteId: null,
    title: '样本作品',
    slug: 'sample-work',
    mediaGroup: 'book',
    mediaType: 'manga',
    format: 'manga_series',
    externalIds: {
      bangumiSubjectId: '1',
    },
    candidateSources: [
      {
        source: 'bangumi',
        label: 'Bangumi',
        externalId: '1',
        url: 'https://bgm.tv/subject/1',
      },
    ],
    externalCoverImages: [
      {
        source: 'bangumi',
        label: 'Bangumi cover common',
        url: 'https://example.test/common.jpg',
        usage: 'candidate_reference',
      },
    ],
    localizedTitles: [
      { title: '样本作品', language: 'zh-Hans', kind: 'localized' },
    ],
    aliases: [{ value: 'Sample Work' }],
    creatorCreditHints: [{ name: 'Example Author', role: 'original_creator' }],
    organizationCreditHints: [{ name: 'Example Publisher', role: 'publisher' }],
    status: 'draft',
    isLiteVisible: false,
    isFullVisible: false,
    hasEvidence: false,
    ...overrides,
  }
}

test('valid normalized media candidates audit passes', () => {
  const audit = auditBangumiMediaNormalizePreview([
    validCandidate(),
    validCandidate({
      title: '样本游戏',
      slug: 'sample-game',
      mediaGroup: 'game',
      mediaType: 'visual_novel',
      format: 'visual_novel',
      externalIds: { bangumiSubjectId: '2' },
      candidateSources: [{ source: 'bangumi', externalId: '2' }],
    }),
  ])

  assert.equal(audit.status, 'pass')
  assert.equal(audit.errors.length, 0)
  assert.equal(audit.stats.candidatesTotal, 2)
  assert.equal(audit.stats.uniqueBangumiSubjectIdsTotal, 2)
  assert.deepEqual(audit.stats.mediaTypeCounts, { manga: 1, visual_novel: 1 })
})

test('audit fails missing fields, duplicate Bangumi ids, unsafe visibility, and unexpected types', () => {
  const audit = auditBangumiMediaNormalizePreview([
    validCandidate({
      title: '',
      slug: '',
      mediaGroup: 'anime',
      mediaType: 'anime',
      format: 'tv_series',
      status: 'published',
      isLiteVisible: true,
      hasEvidence: true,
    }),
    validCandidate({
      title: 'dup',
      slug: 'dup',
      externalIds: { bangumiSubjectId: '1' },
      candidateSources: [],
    }),
  ])

  const codes = audit.errors.map((error) => error.code)

  assert.equal(audit.status, 'fail')
  assert.ok(codes.includes('missing-title'))
  assert.ok(codes.includes('missing-slug'))
  assert.ok(codes.includes('unexpected-media-group'))
  assert.ok(codes.includes('unexpected-media-type'))
  assert.ok(codes.includes('unexpected-format'))
  assert.ok(codes.includes('duplicate-bangumi-subject-id'))
  assert.ok(codes.includes('missing-bangumi-source'))
  assert.ok(codes.includes('unexpected-status'))
  assert.ok(codes.includes('unexpected-visibility'))
  assert.ok(codes.includes('unexpected-evidence-flag'))
})

test('audit warns when candidates have no cover refs and informs on missing hints', () => {
  const audit = auditBangumiMediaNormalizePreview([
    validCandidate({
      externalCoverImages: [],
      creatorCreditHints: [],
      organizationCreditHints: [],
    }),
  ])

  assert.equal(audit.status, 'pass')
  assert.ok(audit.warnings.some((warning) => warning.code === 'no-cover-refs'))
  assert.ok(audit.infos.some((info) => info.code === 'no-creator-hints'))
  assert.ok(audit.infos.some((info) => info.code === 'no-organization-hints'))
})

test('audit report includes safety and count sections', () => {
  const audit = auditBangumiMediaNormalizePreview([validCandidate()])
  const report = createBangumiMediaNormalizePreviewAuditReport(audit, {
    inputPath: 'data_local/normalized/bangumi-media-subjects.candidate-works.jsonl',
  })

  assert.match(report, /# Bangumi media normalize preview audit/)
  assert.match(report, /status: pass/)
  assert.match(report, /No Payload connection/)
  assert.match(report, /No database writes/)
  assert.match(report, /manga: 1/)
  assert.match(report, /manga_series: 1/)
  assert.match(report, /## Errors/)
})
