import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const doc = fs.readFileSync(new URL('../docs/content-callouts.md', import.meta.url), 'utf8')

test('callout docs include image text shape', () => {
  assert.ok(doc.includes('image-text'))
  assert.ok(doc.includes('legacy-example-01'))
})
