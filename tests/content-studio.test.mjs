import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const studio = read('src/app/(frontend)/me/studio/page.tsx')
const editor = read('src/app/(frontend)/me/studio/works/[id]/page.tsx')
const create = read('src/app/(frontend)/me/studio/works/new/page.tsx')
const legacyEditor = read('src/app/(frontend)/me/review/content/works/[id]/page.tsx')
const account = read('src/app/(frontend)/_components/AccountClient.tsx')
const feedback = read('src/app/(frontend)/me/review/feedback/[id]/page.tsx')
const sync = read('src/lib/publicIndexSync.ts')
const guards = read('src/app/(frontend)/_lib/public-entity-guards.ts')
const config = read('payload.config.ts')
const fullExport = read('scripts/export/build-full-public-index.mjs')

test('content studio is database-backed and separate from review queues', () => {
  assert.match(studio, /collection: 'works'/u)
  assert.match(studio, /draft: true/u)
  assert.match(studio, /搜索数据库/u)
  assert.match(studio, /AI \/ 内容审核台/u)
  assert.match(studio, /用户反馈审核/u)
})

test('members can only submit new-work proposals while staff can edit', () => {
  assert.match(studio, /staffRoles/u)
  assert.match(studio, /普通用户不会直接修改正式资料库/u)
  assert.match(studio, /\/feedback\?type=new_work/u)
  assert.match(account, /href="\/me\/studio"/u)
  assert.match(editor, /没有作品编辑权限/u)
})

test('staff creation produces a hidden pending draft and links feedback with numeric IDs', () => {
  assert.match(create, /status: 'draft'/u)
  assert.match(create, /reviewStatus: 'pending'/u)
  assert.match(create, /isLiteVisible: false/u)
  assert.match(create, /isFullVisible: false/u)
  assert.match(create, /const actorID = numericID/u)
  assert.match(create, /const createdID = numericID\(created\.id\)/u)
  assert.match(create, /linkedWork: createdID/u)
  assert.match(create, /reviewer: actorID/u)
  assert.match(feedback, /检查重复并创建草稿/u)
})

test('soft delete archives and hides without deleting the record', () => {
  assert.match(studio, /status: 'archived'/u)
  assert.match(studio, /isLiteVisible: false/u)
  assert.match(studio, /isFullVisible: false/u)
  assert.match(studio, /恢复为待复核草稿/u)
  assert.doesNotMatch(studio, /payload\.delete/u)
  assert.doesNotMatch(studio, /DELETE FROM/u)
})

test('legacy review editor links redirect into the studio', () => {
  assert.match(legacyEditor, /\/me\/studio\/works\//u)
  assert.doesNotMatch(legacyEditor, /payload\.update/u)
})

test('studio edits synchronize existing public indexes and hide archived works', () => {
  assert.match(editor, /syncWorkToPublicIndexes/u)
  assert.match(config, /context\?\.firstPartyStudio/u)
  assert.match(sync, /search-index\.json/u)
  assert.match(sync, /detail-index\.json/u)
  assert.match(sync, /status: text\(work\.status\)/u)
  assert.match(sync, /reviewReasonValues/u)
  assert.match(guards, /item\.status === 'archived'/u)
  assert.match(fullExport, /enrich-public-work-status\.mjs/u)
})

test('studio remains Payload-only and never writes PostgreSQL directly', () => {
  for (const source of [studio, editor, create, sync]) {
    assert.doesNotMatch(source, /pg_query|psql|ALTER TABLE|UPDATE works SET|DELETE FROM works/iu)
  }
})
