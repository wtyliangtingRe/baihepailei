import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const collection = read('src/collections/Comments.ts')
const block = read('src/app/(frontend)/_components/CommentBlock.tsx')
const css = read('src/app/(frontend)/comments.css')

test('comments are authenticated, author-stamped and moderated', () => {
  assert.match(collection, /create: signedIn/u)
  assert.match(collection, /delete: editorsAndUp/u)
  assert.match(collection, /update: editorsAndUp/u)
  assert.match(collection, /approvedCommentsOrModerator/u)
  assert.match(collection, /moderationStatus: 'pending'/u)
  assert.match(collection, /maxLength: 1200/u)
})

test('frontend reads approved comments and links guests to public login', () => {
  assert.match(block, /where\[moderationStatus\]\[equals\]/u)
  assert.match(block, /method: 'POST'/u)
  assert.match(block, /\/account\/login/u)
  assert.doesNotMatch(block, /登录后台账户/u)
  assert.match(css, /\.comment-list/u)
})
