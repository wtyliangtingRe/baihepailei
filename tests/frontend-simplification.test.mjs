import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const home = fs.readFileSync(new URL('../src/app/(frontend)/page.tsx', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const detail = fs.readFileSync(new URL('../src/app/(frontend)/_components/DetailIndexDetail.tsx', import.meta.url), 'utf8')
const works = fs.readFileSync(new URL('../src/app/(frontend)/works/page.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/app/(frontend)/frontend-simplification.css', import.meta.url), 'utf8')

test('home page keeps four primary cards and links to user lists', () => {
  assert.ok(home.includes("href: '/works'"))
  assert.ok(home.includes("href: '/creators'"))
  assert.ok(home.includes("href: '/organizations'"))
  assert.ok(home.includes("href: '/rules'"))
  assert.ok(!home.includes("href: '/evidence'"))
  assert.ok(!home.includes("href: '/terms'"))
  assert.ok(home.includes('href="/me/lists"'))
  assert.ok(!home.includes('href="/admin"'))
})

test('primary nav hides admin and keeps user list entry', () => {
  assert.ok(layout.includes("href: '/me/lists'"))
  assert.ok(!layout.includes("href: '/admin'"))
})

test('detail page starts with basic info instead of conclusion card', () => {
  assert.ok(!detail.includes('WorkConclusionCard'))
  assert.ok(detail.indexOf('<BasicInfo item={item} />') < detail.indexOf('<WorkRiskMatrixCard item={item} />'))
  assert.ok(detail.indexOf('<BasicInfo item={item} />') < detail.indexOf('<WorkListControl item={item} />'))
})

test('works rank explanation is collapsed with full rules link', () => {
  assert.ok(works.includes('<details className="rank-explainer"'))
  assert.ok(works.includes('rank-explainer-link'))
  assert.ok(works.includes('href="/rules"'))
  assert.ok(css.includes('.rank-explainer summary'))
})
