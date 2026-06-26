import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const detailComponent = fs.readFileSync(new URL('../src/app/(frontend)/_components/DetailIndexDetail.tsx', import.meta.url), 'utf8')
const coverStyles = fs.readFileSync(new URL('../src/app/(frontend)/covers.css', import.meta.url), 'utf8')
const workDetail = fs.readFileSync(new URL('../src/app/(frontend)/works/[slug]/page.tsx', import.meta.url), 'utf8')
const creatorDetail = fs.readFileSync(new URL('../src/app/(frontend)/creators/[slug]/page.tsx', import.meta.url), 'utf8')
const organizationDetail = fs.readFileSync(new URL('../src/app/(frontend)/organizations/[slug]/page.tsx', import.meta.url), 'utf8')

test('basic fields render inline links', () => {
  assert.ok(detailComponent.includes('function relationCollection'))
  assert.ok(detailComponent.includes('function InlineValue'))
  assert.ok(detailComponent.includes('detailTarget(collection, value)'))
  assert.ok(detailComponent.includes('detail-inline-link'))
})

test('extra relation card blocks are not used on main entity pages', () => {
  assert.equal(workDetail.includes('EntityRelationCards'), false)
  assert.equal(creatorDetail.includes('EntityRelationCards'), false)
  assert.equal(organizationDetail.includes('EntityRelationCards'), false)
})

test('creator and organization pages keep related works lookup', () => {
  assert.ok(creatorDetail.includes('findWorksByCreatorName'))
  assert.ok(organizationDetail.includes('findWorksByOrganizationName'))
})

test('detail page has material and work summary sections', () => {
  assert.ok(detailComponent.includes('材料留存'))
  assert.ok(detailComponent.includes('作品简介'))
})

test('inline link styles are present', () => {
  assert.ok(coverStyles.includes('.detail-inline-values'))
  assert.ok(coverStyles.includes('.detail-inline-link'))
  assert.ok(coverStyles.includes('.detail-inline-separator'))
})
