import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const commentsCollection = fs.readFileSync(new URL('../src/collections/Comments.ts', import.meta.url), 'utf8')
const payloadConfig = fs.readFileSync(new URL('../payload.config.ts', import.meta.url), 'utf8')
const commentBlock = fs.readFileSync(new URL('../src/app/(frontend)/_components/CommentBlock.tsx', import.meta.url), 'utf8')
const commentsCss = fs.readFileSync(new URL('../src/app/(frontend)/comments.css', import.meta.url), 'utf8')
const docs = fs.readFileSync(new URL('../docs/comments-system.md', import.meta.url), 'utf8')

test('comments collection is registered in payload config', () => {
  assert.ok(payloadConfig.includes("import { Comments } from './src/collections/Comments'"))
  assert.ok(payloadConfig.includes('Evidence, Comments, Terms'))
})

test('comments collection defines target and moderation fields', () => {
  assert.ok(commentsCollection.includes("slug: 'comments'"))
  assert.ok(commentsCollection.includes("name: 'targetCollection'"))
  assert.ok(commentsCollection.includes("name: 'targetSlug'"))
  assert.ok(commentsCollection.includes("name: 'targetTitle'"))
  assert.ok(commentsCollection.includes("name: 'body'"))
  assert.ok(commentsCollection.includes("name: 'moderationStatus'"))
  assert.ok(commentsCollection.includes("value: 'pending'"))
  assert.ok(commentsCollection.includes("value: 'approved'"))
})

test('comments collection requires login to create and restricts moderation reads', () => {
  assert.ok(commentsCollection.includes('create: signedIn'))
  assert.ok(commentsCollection.includes('delete: editorsAndUp'))
  assert.ok(commentsCollection.includes('update: editorsAndUp'))
  assert.ok(commentsCollection.includes('approvedCommentsOrModerator'))
  assert.ok(commentsCollection.includes("equals: 'approved'"))
  assert.ok(commentsCollection.includes('canModerateComments'))
})

test('comments collection stamps author and pending status on create', () => {
  assert.ok(commentsCollection.includes('beforeChange'))
  assert.ok(commentsCollection.includes('operation !== \'create\''))
  assert.ok(commentsCollection.includes('authorName'))
  assert.ok(commentsCollection.includes('moderationStatus: \'pending\''))
})

test('frontend comment block fetches and posts comments', () => {
  assert.ok(commentBlock.includes("'use client'"))
  assert.ok(commentBlock.includes('/api/comments'))
  assert.ok(commentBlock.includes("where[targetCollection][equals]"))
  assert.ok(commentBlock.includes("where[targetSlug][equals]"))
  assert.ok(commentBlock.includes("where[moderationStatus][equals]"))
  assert.ok(commentBlock.includes("method: 'POST'"))
  assert.ok(commentBlock.includes("credentials: 'include'"))
  assert.ok(commentBlock.includes('评论已提交，审核通过后会公开显示。'))
})

test('comment styles support list and compose states', () => {
  assert.ok(commentsCss.includes('.comment-list'))
  assert.ok(commentsCss.includes('.comment-item'))
  assert.ok(commentsCss.includes('.comment-compose-actions'))
  assert.ok(commentsCss.includes('.comment-message'))
  assert.ok(commentsCss.includes("[data-theme='light'] .comment-item"))
})

test('comments system docs describe moderation flow', () => {
  assert.ok(docs.includes('Signed-in users can submit comments'))
  assert.ok(docs.includes('pending'))
  assert.ok(docs.includes('approved'))
  assert.ok(docs.includes('targetCollection'))
})
