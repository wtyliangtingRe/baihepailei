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
const support = read('src/app/(frontend)/support/page.tsx')
const finance = read('src/lib/siteFinance.ts')
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

test('new relationship schema is explicitly gated until its reviewed migration is applied', () => {
  assert.match(fields, /name:\s*'stewardshipNotices'/u)
  assert.match(fields, /hasMany:\s*true/u)
  assert.match(payload, /STEWARDSHIP_NOTICES_SCHEMA_READY/u)
  assert.match(payload, /stewardshipSchemaReady \? withStewardshipNotices\(Works\) : Works/u)
  assert.match(payload, /stewardshipSchemaReady \? \[StewardshipNotices\] : \[\]/u)
})

test('works creators and organizations can receive optional many-notice relationships after migration', () => {
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

test('terms page keeps the original grouped visual guide and removes the useless total counter', () => {
  assert.match(terms, /noticeSections/u)
  assert.match(terms, /noticeImagePath/u)
  assert.match(terms, /站务与用语/u)
  assert.match(terms, /排雷协作/u)
  assert.match(terms, /不适内容/u)
  assert.doesNotMatch(terms, /warningTemplates\.length/u)
  assert.match(terms, /href="\/support"/u)
  assert.doesNotMatch(terms, /collection:\s*'stewardship-notices'/u)
})

test('support page reports income expenses balance and an optional donation QR', () => {
  assert.match(support, /网站运营收支与支持/u)
  assert.match(support, /收入明细/u)
  assert.match(support, /支出明细/u)
  assert.match(support, /本期结余/u)
  assert.match(support, /网站自愿支持二维码/u)
  assert.match(support, /捐赠不影响作品评级/u)
  assert.match(finance, /SITE_FINANCE_REPORT_JSON/u)
  assert.match(finance, /SITE_DONATION_QR_IMAGE/u)
  assert.match(finance, /configured:\s*Boolean\(raw\)/u)
})

test('legacy transparency route redirects to the clearer support route', () => {
  assert.match(transparency, /redirect\('\/support'\)/u)
})

test('full detail exports carry public stewardship notices', () => {
  assert.match(exportWrapper, /enrich-stewardship-notices\.mjs/u)
  assert.match(exportNotices, /stewardshipNotices/u)
  assert.match(exportNotices, /value\.isPublic === false/u)
  assert.match(exportNotices, /COLLECTIONS = \['works', 'creators', 'organizations'\]/u)
})

test('notice bootstrap enforces dry-run, published records, single-item validation and explicit bulk confirmation', () => {
  assert.match(seed, /const apply = process\.argv\.includes\('--apply'\)/u)
  assert.match(seed, /const only = String\(arg\('--only'\)/u)
  assert.match(seed, /_status:\s*'published'/u)
  assert.match(seed, /Bulk apply requires --confirm-bulk/u)
  assert.match(seed, /Dry-run only/u)
  assert.match(seed, /method: row\.action === 'create' \? 'POST' : 'PATCH'/u)
})