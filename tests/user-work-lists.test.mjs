import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const collection = read('src/collections/UserLists.ts')
const control = read('src/app/(frontend)/_components/WorkListControl.tsx')
const profile = read('src/app/(frontend)/_components/MyListsClient.tsx')

test('private user lists support six practical states', () => {
  for (const value of ['want', 'watching', 'seen', 'favorite', 'avoid', 'needs_review']) {
    assert.match(collection, new RegExp(`value: '${value}'`, 'u'))
  }
  assert.match(collection, /ownListOrOwner/u)
  assert.match(collection, /update: ownListOnly/u)
  assert.match(collection, /uniqueKey/u)
})

test('work and profile controls create, update and remove list rows', () => {
  assert.match(control, /\/api\/user-lists/u)
  assert.match(control, /method: record \? 'PATCH' : 'POST'/u)
  assert.match(control, /method: 'DELETE'/u)
  assert.match(control, /\/account\/login/u)
  assert.match(profile, /method: 'DELETE'/u)
  assert.match(profile, /favorite/u)
})
