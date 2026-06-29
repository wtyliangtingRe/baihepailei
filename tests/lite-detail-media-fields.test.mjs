import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const detailExporter = read('scripts/export/build-lite-detail-index.mjs')
const detailIndexLib = read('src/app/(frontend)/_lib/detail-index.ts')
const detailIndexDetail = read('src/app/(frontend)/_components/DetailIndexDetail.tsx')

test('lite detail exporter keeps work media metadata', () => {
  assert.match(detailExporter, /mediaGroup: doc\.mediaGroup \|\| 'unknown'/)
  assert.match(detailExporter, /mediaType: doc\.mediaType \|\| 'unknown'/)
  assert.match(detailExporter, /format: doc\.format \|\| 'unknown'/)
  assert.match(detailExporter, /firstPublishedAt: doc\.firstPublishedAt \|\| ''/)
  assert.match(detailExporter, /firstPublishedPrecision: doc\.firstPublishedPrecision \|\| ''/)
  assert.match(detailExporter, /firstPublishedLabel: doc\.firstPublishedLabel \|\| ''/)
})

test('lite detail exporter maps work organizations and covers', () => {
  assert.match(detailExporter, /function workOrganizationNames\(values\)/)
  assert.match(detailExporter, /organizations: workOrganizationNames\(doc\.organizations\)/)
  assert.match(detailExporter, /function mediaImage\(value\)/)
  assert.match(detailExporter, /cover: mediaImage\(doc\.cover\)/)
})

test('detail index type includes work media metadata fields', () => {
  for (const field of [
    'mediaGroup',
    'mediaType',
    'format',
    'firstPublishedAt',
    'firstPublishedPrecision',
    'firstPublishedLabel',
  ]) {
    assert.match(detailIndexLib, new RegExp(`${field}\\?: string`))
  }
})

test('detail page renders work media metadata', () => {
  assert.match(detailIndexDetail, /const mediaGroup = item\.collection === 'works' \? mediaGroupLabel\(extendedItem\.mediaGroup\) : ''/)
  assert.match(detailIndexDetail, /\['作品类型', mediaGroupLabel\(extendedItem\.mediaGroup\)\]/)
  assert.match(detailIndexDetail, /\['媒体类型', visibleMetadataValue\(extendedItem\.mediaType\)\]/)
  assert.match(detailIndexDetail, /\['格式', visibleMetadataValue\(extendedItem\.format\)\]/)
  assert.match(detailIndexDetail, /\['首发日期', extendedItem\.firstPublishedLabel \|\| extendedItem\.firstPublishedAt\]/)
})
