import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const collection = fs.readFileSync(new URL('../src/collections/UserLists.ts', import.meta.url), 'utf8')
const payloadConfig = fs.readFileSync(new URL('../payload.config.ts', import.meta.url), 'utf8')
const control = fs.readFileSync(new URL('../src/app/(frontend)/_components/WorkListControl.tsx', import.meta.url), 'utf8')
const detail = fs.readFileSync(new URL('../src/app/(frontend)/_components/DetailIndexDetail.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/app/(frontend)/work-list.css', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const docs = fs.readFileSync(new URL('../docs/user-lists.md', import.meta.url), 'utf8')

test('user lists collection is registered', () => {
  assert.ok(payloadConfig.includes("import { UserLists } from './src/collections/UserLists'"))
  assert.ok(payloadConfig.includes('Comments, UserLists, Terms'))
})

test('user lists collection has owner, work and status fields', () => {
  assert.ok(collection.includes("slug: 'user-lists'"))
  assert.ok(collection.includes("name: 'user'"))
  assert.ok(collection.includes("name: 'workSlug'"))
  assert.ok(collection.includes("name: 'workTitle'"))
  assert.ok(collection.includes("name: 'listStatus'"))
  assert.ok(collection.includes("value: 'want'"))
  assert.ok(collection.includes("value: 'seen'"))
  assert.ok(collection.includes("value: 'avoid'"))
  assert.ok(collection.includes("value: 'needs_review'"))
})

test('user lists are scoped to owner or editors', () => {
  assert.ok(collection.includes('ownListOrEditor'))
  assert.ok(collection.includes('create: signedIn'))
  assert.ok(collection.includes('read: ownListOrEditor'))
  assert.ok(collection.includes('update: ownListOrEditor'))
  assert.ok(collection.includes('beforeValidate'))
  assert.ok(collection.includes('uniqueKey'))
})

test('frontend work list control uses user-lists API', () => {
  assert.ok(control.includes("'use client'"))
  assert.ok(control.includes('/api/user-lists'))
  assert.ok(control.includes("method: record ? 'PATCH' : 'POST'"))
  assert.ok(control.includes("credentials: 'include'"))
  assert.ok(control.includes('want'))
  assert.ok(control.includes('seen'))
  assert.ok(control.includes('avoid'))
  assert.ok(control.includes('needs_review'))
})

test('work list control is rendered and styled', () => {
  assert.ok(detail.includes("import WorkListControl from './WorkListControl'"))
  assert.ok(detail.includes('<WorkListControl item={item} />'))
  assert.ok(layout.includes("import './work-list.css'"))
  assert.ok(css.includes('.work-list-control'))
  assert.ok(css.includes('.work-list-option'))
})

test('user list docs exist', () => {
  assert.ok(docs.includes('user-lists'))
  assert.ok(docs.includes('/api/user-lists'))
})
