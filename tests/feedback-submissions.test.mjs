import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('src/app/(frontend)/feedback/page.tsx')
const correctionForm = read('.github/ISSUE_TEMPLATE/work-correction.yml')
const newWorkForm = read('.github/ISSUE_TEMPLATE/new-work.yml')
const docs = read('docs/feedback-submissions.md')
const migration = read('scripts/migrations/20260720-add-feedback-new-work-metadata.sql')

test('public feedback is an authenticated issue handoff, not an anonymous database write', () => {
  assert.match(page, /需要登录 GitHub/u)
  assert.match(page, /不会获得任何数据库写入权限/u)
  assert.doesNotMatch(page, /method=["']POST|\/api\/feedback-submissions/u)
  assert.match(docs, /does not expose a first-party anonymous database-write endpoint/u)
})

test('correction and new-work issue forms preserve the facts needed for moderation', () => {
  assert.match(correctionForm, /id: work_id/u)
  assert.match(correctionForm, /id: correction/u)
  assert.match(correctionForm, /id: version_location/u)
  assert.match(correctionForm, /id: spoilers/u)
  assert.match(newWorkForm, /id: original_title/u)
  assert.match(newWorkForm, /id: aliases/u)
  assert.match(newWorkForm, /id: creators/u)
  assert.match(newWorkForm, /id: summary/u)
  for (const form of [correctionForm, newWorkForm]) {
    assert.match(form, /id: sources/u)
    assert.match(form, /不会自动/u)
  }
})

test('historical feedback metadata migration remains additive and auditable', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "new_work_metadata" jsonb/u)
  assert.match(migration, /BEGIN;/u)
  assert.match(migration, /COMMIT;/u)
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|DELETE FROM|UPDATE /iu)
})
