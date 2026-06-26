import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const detailIndex = fs.readFileSync(new URL('../src/app/(frontend)/_lib/detail-index.ts', import.meta.url), 'utf8')
const relationComponent = fs.readFileSync(new URL('../src/app/(frontend)/_components/EntityRelationCards.tsx', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const styles = fs.readFileSync(new URL('../src/app/(frontend)/entity-relations.css', import.meta.url), 'utf8')
const workDetail = fs.readFileSync(new URL('../src/app/(frontend)/works/[slug]/page.tsx', import.meta.url), 'utf8')
const creatorDetail = fs.readFileSync(new URL('../src/app/(frontend)/creators/[slug]/page.tsx', import.meta.url), 'utf8')
const organizationDetail = fs.readFileSync(new URL('../src/app/(frontend)/organizations/[slug]/page.tsx', import.meta.url), 'utf8')

test('detail index exposes entity relationship helpers', () => {
  assert.ok(detailIndex.includes('function uniqueItems'))
  assert.ok(detailIndex.includes('findItemsByTitles'))
  assert.ok(detailIndex.includes('findWorksByCreatorName'))
  assert.ok(detailIndex.includes('findWorksByOrganizationName'))
  assert.ok(detailIndex.includes('findOrganizationsByCreatorName'))
  assert.ok(detailIndex.includes('findCreatorsByOrganizationName'))
})

test('entity relation card component renders linked groups', () => {
  assert.ok(relationComponent.includes('EntityRelationCards'))
  assert.ok(relationComponent.includes('RelationGroupCards'))
  assert.ok(relationComponent.includes('entity-relation-card'))
  assert.ok(relationComponent.includes('href={item.url}'))
  assert.ok(relationComponent.includes('displayMeta'))
})

test('work detail links creators and organizations as cards', () => {
  assert.ok(workDetail.includes('EntityRelationCards'))
  assert.ok(workDetail.includes("title: '关联创作者'"))
  assert.ok(workDetail.includes("title: '关联机构'"))
  assert.ok(workDetail.includes("findItemsByTitles('creators', detailItem.creators)"))
  assert.ok(workDetail.includes("findItemsByTitles('organizations', detailItem.organizations)"))
})

test('creator detail links related works and organizations', () => {
  assert.ok(creatorDetail.includes('EntityRelationCards'))
  assert.ok(creatorDetail.includes("title: '相关作品'"))
  assert.ok(creatorDetail.includes("title: '相关机构'"))
  assert.ok(creatorDetail.includes('findWorksByCreatorName'))
  assert.ok(creatorDetail.includes('findOrganizationsByCreatorName'))
})

test('organization detail links related works and creators', () => {
  assert.ok(organizationDetail.includes('EntityRelationCards'))
  assert.ok(organizationDetail.includes("title: '相关作品'"))
  assert.ok(organizationDetail.includes("title: '相关创作者'"))
  assert.ok(organizationDetail.includes('findWorksByOrganizationName'))
  assert.ok(organizationDetail.includes('findCreatorsByOrganizationName'))
})

test('entity relation styles are loaded', () => {
  assert.ok(layout.includes("import './entity-relations.css'"))
  assert.ok(styles.includes('.entity-relations'))
  assert.ok(styles.includes('.entity-relation-group'))
  assert.ok(styles.includes('.entity-relation-list'))
  assert.ok(styles.includes('.entity-relation-card'))
})
