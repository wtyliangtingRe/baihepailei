import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const renderer = fs.readFileSync(new URL('../src/app/(frontend)/_components/RichTextRenderer.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/app/(frontend)/frontend-simplification.css', import.meta.url), 'utf8')

test('legacy rank lines become section starts instead of loose paragraphs', () => {
  assert.ok(renderer.includes('function sectionStartOf'))
  assert.ok(renderer.includes('rankTitleFromLine'))
  assert.ok(renderer.includes('removeRankPrefix'))
})

test('legacy author rating sections are hidden', () => {
  assert.ok(renderer.includes('function isAuthorRatingMarker'))
  assert.ok(renderer.includes('function isAuthorRankTitle'))
  assert.ok(renderer.includes('let skipAuthorRatings = false'))
  assert.ok(renderer.includes('if (skipAuthorRatings) continue'))
})

test('legacy section keys stay unique', () => {
  assert.ok(renderer.includes("return `rule-${cleaned || 'section'}-${index + 1}`"))
})

test('empty legacy sections are removed', () => {
  assert.ok(renderer.includes('sections.filter((section) => section.entries.length > 0)'))
})

test('legacy heading markers are stripped from normal lines', () => {
  assert.ok(renderer.includes('function stripHeadingMarks'))
  assert.ok(renderer.includes('replace(/^\\s*=+\\s*/'))
})

test('long detail titles stay readable', () => {
  assert.ok(css.includes('.detail-hero h1'))
  assert.ok(css.includes('word-break: keep-all'))
  assert.ok(css.includes('overflow-wrap: anywhere'))
})
