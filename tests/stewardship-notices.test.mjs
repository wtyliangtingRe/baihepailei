import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const collection = read('src/collections/StewardshipNotices.ts')
const fields = read('src/collections/fields/stewardshipNotices.ts')
const payload = read('payload.config.ts')
const editor = read('src/app/(frontend)/me/studio/works/[id]/page.tsx')
const display = read('src/app/(frontend)/_components/StewardshipNoticeBlock.tsx')
const assessment = read('src/app/(frontend)/_components/WorkAssessmentTrustCard.tsx')
const terms = read('src/app/(frontend)/terms/page.tsx')
const transparency = read('src/app/(frontend)/transparency/page.tsx')
const exportWrapper = read('scripts/export/build-and-enrich-lite-detail-index.mjs')
const exportNotices = read('scripts/export/enrich-stewardship-notices.mjs')
const seed = read('scripts/import/seed-stewardship-notices-v01.mjs')

test('stewardship notices are reusable administrator-owned records rather than fixed per-page text', () => {
  assert.match(collection, /slug:\s*'stewardship-notices'/u)
  assert.match(collection, /name:\s*'summary'/u)
  assert.match(collection, /name:\s*'category'/u)
  assert.match(collection, /name:\s*'tone'/u)
  assert.match(collection, /name:\s*'severity'/u)
  assert.match(collection, /name:\s*'isPublic'/u)
  assert.match(collection, /create:\s*adminsOnly/u)
  assert.match(collection, /update:\s*adminsOnly/u)
  assert.match(collection, /delete:\s*adminsOnly/u)
})

test('works creators and organizations receive optional many-notice relationships', () => {
  assert.match(fields, /name:\s*'stewardshipNotices'/u)
  assert.match(fields, /hasMany:\s*true/u)
  assert.match(payload, /withStewardshipNotices\(Works\)/u)
  assert.match(payload, /withStewardshipNotices\(Creators\)/u)
  assert.match(payload, /withStewardshipNotices\(Organizations\)/u)
})

test('work studio uses a multi-select and avoids clearing relationships when schema is unavailable', () => {
  assert.match(editor, /multiple name="stewardshipNotices"/u)
  assert.match(editor, /stewardshipNoticeSelectorReady/u)
  assert.match(editor, /data\.stewardshipNotices = submittedRelationIDs/u)
  assert.match(editor, /站务与用语提示（可选）/u)
})

test('detail pages place notices before assessment and basic information', () => {
  assert.match(assessment, /StewardshipNoticeBlock/u)
  assert.match(assessment, /if \(item\.collection !== 'works'\) return stewardship/u)
  assert.match(display, /站务与用语/u)
  assert.match(display, /notices\.length/u)
})

test('terms page removes the useless template-count control and exposes transparency', () => {
  assert.doesNotMatch(terms, /warningTemplates\.length/u)
  assert.match(terms, /href="\/transparency"/u)
  assert.match(terms, /stewardship-notices/u)
})

test('transparency report explains AI, feedback and reversible moderation with live index counts', () => {
  assert.match(transparency, /透明度报告/u)
  assert.match(transparency, /AI 与人工审核/u)
  assert.match(transparency, /隐藏、恢复与合并/u)
  assert.match(transparency, /readDetailIndex/u)
})

test('full detail exports carry public stewardship notices', () => {
  assert.match(exportWrapper, /enrich-stewardship-notices\.mjs/u)
  assert.match(exportNotices, /stewardshipNotices/u)
  assert.match(exportNotices, /value\.isPublic === false/u)
  assert.match(exportNotices, /COLLECTIONS = \['works', 'creators', 'organizations'\]/u)
})

test('notice bootstrap enforces dry-run, single-item validation and explicit bulk confirmation', () => {
  assert.match(seed, /const apply = process\.argv\.includes\('--apply'\)/u)
  assert.match(seed, /const only = String\(arg\('--only'\)/u)
  assert.match(seed, /Bulk apply requires --confirm-bulk/u)
  assert.match(seed, /Dry-run only/u)
  assert.match(seed, /method: row\.action === 'create' \? 'POST' : 'PATCH'/u)
})
