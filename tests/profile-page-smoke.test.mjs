import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync(new URL('../src/app/(frontend)/me/lists/page.tsx', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/app/(frontend)/profile-lists.css', import.meta.url), 'utf8')

test('profile page is wired', () => {
  assert.ok(page.includes('MyListsClient'))
  assert.ok(layout.includes('/me/lists'))
  assert.ok(css.includes('.my-list-item'))
})
