import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const doc = fs.readFileSync(new URL('../docs/comment-roadmap.md', import.meta.url), 'utf8')

test('comment roadmap keeps write system separate', () => {
  assert.ok(doc.includes('comments'))
  assert.ok(doc.includes('signed-in user'))
  assert.ok(doc.includes('moderation'))
  assert.ok(doc.includes('separate PR'))
})
