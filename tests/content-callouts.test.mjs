import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const component = fs.readFileSync(new URL('../src/app/(frontend)/_components/ContentCallout.tsx', import.meta.url), 'utf8')
const detail = fs.readFileSync(new URL('../src/app/(frontend)/_components/DetailIndexDetail.tsx', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/app/(frontend)/callouts.css', import.meta.url), 'utf8')
const docs = fs.readFileSync(new URL('../docs/content-callouts.md', import.meta.url), 'utf8')

test('callout component exists', () => {
  assert.ok(component.includes('ContentCalloutItem'))
  assert.ok(component.includes('black-banner'))
  assert.ok(component.includes('warning'))
  assert.ok(component.includes('image-text'))
})

test('detail component renders callouts', () => {
  assert.ok(detail.includes('ContentCallout'))
  assert.ok(detail.includes('callouts?: ContentCalloutItem[]'))
  assert.ok(detail.includes('function DetailCallouts'))
  assert.ok(detail.includes('<DetailCallouts item={item} />'))
})

test('callout styles and docs exist', () => {
  assert.ok(layout.includes("import './callouts.css'"))
  assert.ok(css.includes('.content-callout.black-banner'))
  assert.ok(css.includes('.content-callout.warning'))
  assert.ok(css.includes('.content-callout.image-text'))
  assert.ok(docs.includes('callouts'))
})
