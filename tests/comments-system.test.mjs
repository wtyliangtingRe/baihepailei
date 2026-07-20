import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const collection = read('src/collections/Comments.ts')
const block = read('src/app/(frontend)/_components/CommentBlock.tsx')
const messages = read('src/app/(frontend)/me/messages/page.tsx')
const replyMigration = read('scripts/migrations/20260720-add-comment-reply-recipient.sql')
const moderationMigration = read('scripts/migrations/20260721-add-comment-moderation-columns.sql')
const css = read('src/app/(frontend)/comments.css')

test('comments publish immediately and preserve server-stamped authorship', () => {
  assert.match(collection, /create: signedIn/u)
  assert.match(collection, /delete: ownCommentOrStaff/u)
  assert.match(collection, /update: \(\{ req \}\) => isEditor\(req\.user\)/u)
  assert.match(collection, /visibleCommentsOrStaff/u)
  assert.match(collection, /moderationStatus: 'approved'/u)
  assert.match(collection, /author:\s*\{\s*equals: userID/u)
  assert.match(collection, /maxLength: 1200/u)
  assert.match(collection, /name: 'parentComment'/u)
  assert.match(collection, /relationTo: 'comments'/u)
  assert.match(collection, /replyToName/u)
})

test('reply recipients are server-stamped and available only to internal message queries', () => {
  assert.match(collection, /name: 'replyToUser'/u)
  assert.match(collection, /replyToUser: relationID\(parent\.author/u)
  assert.match(collection, /仅用于账户消息提醒/u)
  assert.match(collection, /access: \{ read: \(\{ req \}\) => isEditor\(req\.user\) \}/u)
  assert.match(messages, /replyToUser: \{ equals: userID \}/u)
  assert.match(messages, /uniqueComments/u)
  assert.match(replyMigration, /ADD COLUMN IF NOT EXISTS "reply_to_user_id" integer/u)
  assert.match(replyMigration, /CREATE INDEX IF NOT EXISTS "comments_reply_to_user_idx"/u)
  assert.doesNotMatch(replyMigration, /DROP TABLE|DROP COLUMN|DELETE FROM/iu)
})

test('comment moderation fields have an additive schema repair migration', () => {
  assert.match(collection, /name: 'reportCount'/u)
  assert.match(collection, /name: 'hiddenReason'/u)
  assert.match(moderationMigration, /ADD COLUMN IF NOT EXISTS "report_count" integer DEFAULT 0/u)
  assert.match(moderationMigration, /ADD COLUMN IF NOT EXISTS "hidden_reason" text/u)
  assert.match(moderationMigration, /ALTER COLUMN "report_count" SET DEFAULT 0/u)
  assert.doesNotMatch(moderationMigration, /DROP TABLE|DROP COLUMN|DELETE FROM/iu)
})

test('frontend shows immediate comments with owner and staff deletion controls', () => {
  assert.doesNotMatch(block, /where\[moderationStatus\]\[equals\]/u)
  assert.match(block, /params\.set\('depth', '0'\)/u)
  assert.match(block, /method: 'POST'/u)
  assert.match(block, /method: 'DELETE'/u)
  assert.match(block, /commentModeratorRoles/u)
  assert.match(block, /评论已发布/u)
  assert.match(block, /comment-replies/u)
  assert.match(block, /parentComment: parentComment\?\.id/u)
  assert.match(block, /发布回复/u)
  assert.match(block, /\/account\/login/u)
  assert.doesNotMatch(block, /登录后台账户/u)
  assert.match(css, /\.comment-list/u)
  assert.match(css, /\.comment-delete/u)
})
