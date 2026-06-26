import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const evidenceCollection = fs.readFileSync(new URL('../src/collections/Evidence.ts', import.meta.url), 'utf8')
const importer = fs.readFileSync(new URL('../scripts/import/demo-fixtures.mjs', import.meta.url), 'utf8')
const detailIndex = fs.readFileSync(new URL('../src/app/(frontend)/_lib/detail-index.ts', import.meta.url), 'utf8')
const workPage = fs.readFileSync(new URL('../src/app/(frontend)/works/[slug]/page.tsx', import.meta.url), 'utf8')
const creatorPage = fs.readFileSync(new URL('../src/app/(frontend)/creators/[slug]/page.tsx', import.meta.url), 'utf8')
const organizationPage = fs.readFileSync(new URL('../src/app/(frontend)/organizations/[slug]/page.tsx', import.meta.url), 'utf8')
const evidenceEnricher = fs.readFileSync(new URL('../scripts/export/enrich-lite-evidence-details.mjs', import.meta.url), 'utf8')
const wrapper = fs.readFileSync(new URL('../scripts/export/build-and-enrich-lite-detail-index.mjs', import.meta.url), 'utf8')

test('evidence collection uses confirmed public access for public reads', () => {
  assert.ok(evidenceCollection.includes('publicEvidenceOrSignedIn'))
  assert.ok(evidenceCollection.includes("equals: 'confirmed'"))
  assert.ok(evidenceCollection.includes('isPublic'))
  assert.ok(evidenceCollection.includes('evidenceStatusOptions'))
  assert.ok(evidenceCollection.includes("{ label: '已确认', value: 'confirmed' }"))
})

test('demo importer validates and normalizes evidence payloads', () => {
  assert.ok(importer.includes('evidenceStatusValues'))
  assert.ok(importer.includes('validateEvidenceValues(seed)'))
  assert.ok(importer.includes('function normalizeEvidenceDoc'))
  assert.ok(importer.includes("evidenceType: 'other'"))
  assert.ok(importer.includes("status: 'draft'"))
})

test('detail index exposes evidence relation helpers', () => {
  assert.ok(detailIndex.includes('function evidenceItems'))
  assert.ok(detailIndex.includes('function evidenceByRelation'))
  assert.ok(detailIndex.includes('findEvidenceByWorkTitle'))
  assert.ok(detailIndex.includes('findEvidenceByCreatorName'))
  assert.ok(detailIndex.includes('findEvidenceByOrganizationName'))
})

test('work creator and organization detail pages pass related evidence', () => {
  assert.ok(workPage.includes('findEvidenceByWorkTitle'))
  assert.ok(workPage.includes('relatedEvidence={findEvidenceByWorkTitle(detailItem.title)}'))
  assert.ok(creatorPage.includes('findEvidenceByCreatorName'))
  assert.ok(creatorPage.includes('relatedEvidence={findEvidenceByCreatorName(detailItem.title)}'))
  assert.ok(organizationPage.includes('findEvidenceByOrganizationName'))
  assert.ok(organizationPage.includes('relatedEvidence={findEvidenceByOrganizationName(detailItem.title)}'))
})

test('evidence detail enricher maps retained material fields', () => {
  assert.ok(evidenceEnricher.includes('/api/evidence'))
  assert.ok(evidenceEnricher.includes("where[status][equals]"))
  assert.ok(evidenceEnricher.includes("where[isPublic][equals]"))
  assert.ok(evidenceEnricher.includes('relatedWorks: relationshipNames'))
  assert.ok(evidenceEnricher.includes('relatedCreators: relationshipNames'))
  assert.ok(evidenceEnricher.includes('relatedOrganizations: relationshipNames'))
  assert.ok(evidenceEnricher.includes('sourceLinks: sourceLinks'))
  assert.ok(evidenceEnricher.includes('description: normalizeText'))
})

test('detail index wrapper runs evidence details enrichment', () => {
  assert.ok(wrapper.includes('enrich-lite-evidence-details.mjs'))
  assert.ok(wrapper.indexOf('enrich-lite-detail-index.mjs') < wrapper.indexOf('enrich-lite-evidence-details.mjs'))
})
