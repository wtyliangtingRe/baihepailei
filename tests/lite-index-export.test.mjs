import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const searchExporter = fs.readFileSync(new URL('../scripts/export/build-lite-search-index.mjs', import.meta.url), 'utf8')
const detailExporter = fs.readFileSync(new URL('../scripts/export/build-lite-detail-index.mjs', import.meta.url), 'utf8')
const detailEnricher = fs.readFileSync(new URL('../scripts/export/enrich-lite-detail-index.mjs', import.meta.url), 'utf8')
const detailIndexTypes = fs.readFileSync(new URL('../src/app/(frontend)/_lib/detail-index.ts', import.meta.url), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('search export includes frontend content collections', () => {
  assert.ok(searchExporter.includes("'organizations'"))
  assert.ok(searchExporter.includes("'evidence'"))
  assert.ok(searchExporter.includes('function mapOrganization'))
  assert.ok(searchExporter.includes('function mapEvidence'))
  assert.ok(searchExporter.includes('mediaImage(doc.cover)'))
  assert.ok(searchExporter.includes('mediaImage(doc.image)'))
})

test('search export does not emit old wiki tracking fields', () => {
  assert.equal(searchExporter.includes('legacyXWikiPage'), false)
})

test('detail export is enriched after base export', () => {
  assert.ok(packageJson.scripts['export:lite-details'].includes('build-lite-detail-index.mjs'))
  assert.ok(packageJson.scripts['export:lite-details'].includes('enrich-lite-detail-index.mjs'))
  assert.ok(detailEnricher.includes('detailsFromSearchItem'))
  assert.ok(detailEnricher.includes("['organizations', 'evidence']"))
  assert.ok(detailEnricher.includes('delete copy.legacyXWikiPage'))
})

test('detail index frontend types include enriched fields', () => {
  assert.ok(detailIndexTypes.includes("'organizations'"))
  assert.ok(detailIndexTypes.includes("'evidence'"))
  assert.ok(detailIndexTypes.includes('organizationType?: string'))
  assert.ok(detailIndexTypes.includes('evidenceType?: string'))
  assert.ok(detailIndexTypes.includes('relatedWorks?: string[]'))
  assert.ok(detailIndexTypes.includes('image?: DetailCoverImage'))
})

test('base detail exporter remains available', () => {
  assert.ok(detailExporter.includes("const COLLECTIONS = ['works', 'creators', 'terms', 'rules']"))
  assert.equal(packageJson.scripts['export:lite-details:base'], 'node scripts/export/build-lite-detail-index.mjs')
  assert.equal(packageJson.scripts['export:lite-details:enrich'], 'node scripts/export/enrich-lite-detail-index.mjs')
})
