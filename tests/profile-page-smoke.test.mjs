import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync(new URL('../src/app/(frontend)/me/lists/page.tsx', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/app/(frontend)/profile-lists.css', import.meta.url), 'utf8')

test('profile list page is wired to the public account flow', () => {
  assert.match(page, /MyListsClient/u)
  assert.match(page, /在看/u)
  assert.match(page, /喜欢/u)
  assert.match(layout, /\/me\/lists/u)
  assert.match(css, /\.my-list-item/u)
})
