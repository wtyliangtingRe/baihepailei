import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const collection = read('src/collections/Comments.ts')
const block = read('src/app/(frontend)/_components/CommentBlock.tsx')
const css = read('src/app/(frontend)/comments.css')

test('comments publish immediately and preserve server-stamped authorship', () => {
  assert.match(collection, /create: signedIn/u)
  assert.match(collection, /delete: ownCommentOrStaff/u)
  assert.match(collection, /update: \(\{ req \}\) => isEditor\(req\.user\)/u)
  assert.match(collection, /visibleCommentsOrStaff/u)
  assert.match(collection, /moderationStatus: 'approved'/u)
  assert.match(collection, /author:\s*\{\s*equals: userID/u)
  assert.match(collection, /maxLength: 1200/u)
})

test('frontend shows immediate comments with owner and staff deletion controls', () => {
  assert.doesNotMatch(block, /where\[moderationStatus\]\[equals\]/u)
  assert.match(block, /params\.set\('depth', '0'\)/u)
  assert.match(block, /method: 'POST'/u)
  assert.match(block, /method: 'DELETE'/u)
  assert.match(block, /commentModeratorRoles/u)
  assert.match(block, /评论已发布/u)
  assert.match(block, /\/account\/login/u)
  assert.doesNotMatch(block, /登录后台账户/u)
  assert.match(css, /\.comment-list/u)
  assert.match(css, /\.comment-delete/u)
})
