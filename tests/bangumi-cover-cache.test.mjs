import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBangumiCoverManifestFromRecords,
  cacheBangumiCovers,
  createBangumiCoverCacheReport,
} from '../tools/source_import/scripts/cache-bangumi-cover-images.mjs'

function subject(id, title, images = {}) {
  return {
    id,
    name_cn: title,
    type: 2,
    images,
  }
}

test('cover manifest extracts and prioritizes Bangumi subject images', () => {
  const manifest = buildBangumiCoverManifestFromRecords([
    subject(1, 'Work A', {
      small: 'https://example.test/a-small.jpg',
      common: 'https://example.test/a-common.jpg',
      large: 'https://example.test/a-large.jpg',
    }),
    subject(2, 'Work B', {
      grid: '//example.test/b-grid.webp',
      small: 'https://example.test/b-small.jpg',
    }),
  ], { sourcePath: 'subjects.json' })

  assert.equal(manifest.length, 2)
  assert.equal(manifest[0].bangumiSubjectId, '1')
  assert.equal(manifest[0].selectedImageKind, 'large')
  assert.equal(manifest[0].imageUrl, 'https://example.test/a-large.jpg')
  assert.equal(manifest[1].selectedImageKind, 'grid')
  assert.equal(manifest[1].imageUrl, 'https://example.test/b-grid.webp')
})

test('cover manifest deduplicates by Bangumi subject id', () => {
  const manifest = buildBangumiCoverManifestFromRecords([
    subject(1, 'Work A', { large: 'https://example.test/a-large.jpg' }),
    subject(1, 'Work A duplicate', { large: 'https://example.test/a-large-2.jpg' }),
  ])

  assert.equal(manifest.length, 1)
  assert.equal(manifest[0].title, 'Work A')
})

test('cover manifest can find nested raw images', () => {
  const manifest = buildBangumiCoverManifestFromRecords([
    {
      source: 'bangumi',
      sourceRecordId: '9',
      raw: subject(9, 'Raw Work', { common: 'https://example.test/raw.jpg' }),
    },
  ])

  assert.equal(manifest.length, 1)
  assert.equal(manifest[0].bangumiSubjectId, '9')
  assert.equal(manifest[0].imageUrl, 'https://example.test/raw.jpg')
})

test('cover cache skips existing files without network download', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'bangumi-cover-cache-'))
  await writeFile(path.join(outputDir, 'already-exists.jpg'), 'cached')

  const manifest = {
    covers: [
      {
        bangumiSubjectId: '1',
        title: 'Work A',
        imageUrl: 'https://example.test/a.jpg',
        relativePath: 'files/already-exists.jpg',
      },
    ],
  }

  const result = await cacheBangumiCovers(manifest, { outputDir, limit: 0 })

  assert.equal(result.meta.coversTotal, 1)
  assert.equal(result.meta.skipped, 1)
  assert.equal(result.meta.errors, 0)
  assert.equal(result.results[0].status, 'skipped-existing')
})

test('cover report includes safety summary', () => {
  const report = createBangumiCoverCacheReport({
    meta: {
      mode: 'manifest-only-no-payload-write',
      generatedAt: '2026-01-01T00:00:00.000Z',
      coversTotal: 1,
    },
    covers: [
      {
        bangumiSubjectId: '1',
        title: 'Work A',
        type: '2',
        selectedImageKind: 'large',
        relativePath: 'files/bgm-1-work-a.jpg',
      },
    ],
  })

  assert.match(report, /Bangumi cover cache/u)
  assert.match(report, /manifest-only-no-payload-write/u)
  assert.match(report, /不上传 Payload/u)
  assert.match(report, /不修改 works/u)
})
