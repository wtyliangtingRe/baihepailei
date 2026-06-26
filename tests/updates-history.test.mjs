import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const updatesPage = fs.readFileSync(new URL('../src/app/(frontend)/updates/page.tsx', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const styles = fs.readFileSync(new URL('../src/app/(frontend)/updates.css', import.meta.url), 'utf8')
const versionInfo = fs.readFileSync(new URL('../src/app/(frontend)/_components/VersionInfo.tsx', import.meta.url), 'utf8')

const detailRoutes = [
  '../src/app/(frontend)/works/[slug]/page.tsx',
  '../src/app/(frontend)/creators/[slug]/page.tsx',
  '../src/app/(frontend)/organizations/[slug]/page.tsx',
  '../src/app/(frontend)/evidence/[slug]/page.tsx',
  '../src/app/(frontend)/terms/[slug]/page.tsx',
  '../src/app/(frontend)/rules/[slug]/page.tsx',
].map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8'))

test('updates page reads detail index and renders recent updates', () => {
  assert.ok(updatesPage.includes('readDetailIndex'))
  assert.ok(updatesPage.includes('最近更新'))
  assert.ok(updatesPage.includes('updatedAt'))
  assert.ok(updatesPage.includes('createdAt'))
  assert.ok(updatesPage.includes('reviewStatus'))
  assert.ok(updatesPage.includes('evidenceStrength'))
  assert.ok(updatesPage.includes('update-card'))
})

test('updates page avoids old wiki source concepts', () => {
  assert.equal(updatesPage.includes('legacyXWikiPage'), false)
  assert.equal(updatesPage.includes('旧站来源'), false)
  assert.equal(versionInfo.includes('legacyXWikiPage'), false)
  assert.equal(versionInfo.includes('旧站来源'), false)
})

test('updates navigation and styles are wired', () => {
  assert.ok(layout.includes("{ href: '/updates', label: '最近更新' }"))
  assert.ok(layout.includes("import './updates.css'"))
  assert.ok(styles.includes('.updates-list'))
  assert.ok(styles.includes('.update-card'))
  assert.ok(styles.includes('.version-note'))
})

test('version info component renders new-site version notes', () => {
  assert.ok(versionInfo.includes('版本说明'))
  assert.ok(versionInfo.includes('最近更新：'))
  assert.ok(versionInfo.includes('创建时间：'))
  assert.ok(versionInfo.includes('/updates'))
  assert.ok(versionInfo.includes('新站当前条目的时间信息'))
})

test('detail routes render version info for detail-index pages', () => {
  for (const route of detailRoutes) {
    assert.ok(route.includes('VersionInfo'))
    assert.ok(route.includes('<VersionInfo item={detailItem} />'))
  }
})
