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
const feedbackForm = read('src/app/(frontend)/_components/FeedbackForm.tsx')
const ruleSelector = read('src/app/(frontend)/_components/RadarRuleSelector.tsx')
const pendingButton = read('src/app/(frontend)/me/studio/_components/PendingSubmitButton.tsx')
const sync = read('src/lib/publicIndexSync.ts')
const richText = read('src/lib/richTextPlain.ts')
const guards = read('src/app/(frontend)/_lib/public-entity-guards.ts')
const config = read('payload.config.ts')
const fullExport = read('scripts/export/build-full-public-index.mjs')

function functionBody(source, name, nextName) {
  const start = source.indexOf(`async function ${name}`)
  const end = source.indexOf(`async function ${nextName}`, start + 1)
  assert.notEqual(start, -1, `missing function ${name}`)
  return source.slice(start, end === -1 ? source.length : end)
}

test('content studio is database-backed and separate from review queues', () => {
  assert.match(studio, /collection: 'works'/u)
  assert.match(studio, /draft: false/u)
  assert.match(studio, /搜索数据库/u)
  assert.match(studio, /AI \/ 内容审核台/u)
  assert.match(studio, /用户反馈审核/u)
})

test('studio does not send business archive values through Payload version rows', () => {
  assert.match(studio, /catalogStatus/u)
  assert.match(studio, /archiveSchemaReady/u)
  assert.match(studio, /回收站目录状态尚未完成数据库迁移/u)

  const pageQuery = functionBody(studio, 'findStudioPage', 'countByStatus')
  const statusCount = functionBody(studio, 'countByStatus', 'ContentStudioPage')
  assert.match(pageQuery, /draft: false/u)
  assert.match(statusCount, /draft: false/u)
  assert.doesNotMatch(pageQuery, /draft: true/u)
  assert.doesNotMatch(statusCount, /draft: true/u)
})

test('members can only submit new-work proposals while staff can edit', () => {
  assert.match(studio, /staffRoles/u)
  assert.match(studio, /普通用户不会直接修改正式资料库/u)
  assert.match(studio, /\/feedback\?type=new_work/u)
  assert.match(account, /href="\/me\/studio"/u)
  assert.match(editor, /没有作品编辑权限/u)
})

test('staff creation produces a hidden pending draft and links feedback with numeric IDs', () => {
  assert.match(create, /_status: 'draft'/u)
  assert.match(create, /catalogStatus: 'active'/u)
  assert.match(create, /reviewStatus: 'pending'/u)
  assert.match(create, /isLiteVisible: false/u)
  assert.match(create, /isFullVisible: false/u)
  assert.match(create, /const actorID = numericID/u)
  assert.match(create, /const createdID = numericID\(created\.id\)/u)
  assert.match(create, /linkedWork: createdID/u)
  assert.match(create, /reviewer: actorID/u)
  assert.match(feedback, /检查重复并创建草稿/u)
})

test('draft creation returns to its parent with a visible success state and double-submit protection', () => {
  assert.match(create, /withCreatedWork\(returnTo, createdID\)/u)
  assert.match(create, /name="returnTo"/u)
  assert.match(create, /PendingSubmitButton/u)
  assert.match(pendingButton, /useFormStatus/u)
  assert.match(pendingButton, /disabled=\{pending\}/u)
  assert.match(studio, /const createdWork = first\(raw\.createdWork\)/u)
  assert.match(studio, /作品草稿 #\{createdWork\} 已创建/u)
  assert.match(feedback, /已创建待复核作品草稿 #\{createdWork\}/u)
  assert.match(feedbackForm, /router\.back\(\)/u)
  assert.match(feedbackForm, /返回上一级/u)
})

test('new work proposals and staff drafts share main and all-matched rule controls', () => {
  assert.match(ruleSelector, /主规则（决定性规则）/u)
  assert.match(ruleSelector, /<details/u)
  assert.match(ruleSelector, /全部命中规则/u)
  assert.match(ruleSelector, /name=\{decisiveName\}/u)
  assert.match(ruleSelector, /name=\{matchedName\}/u)
  assert.match(ruleSelector, /if \(checked && !decisive\) setDecisive\(code\)/u)
  assert.match(feedbackForm, /orderedRuleCodes/u)
  assert.match(create, /RADAR_RATING_POLICY_ID/u)
  assert.match(create, /decisiveRuleCode/u)
  assert.match(create, /matchedRules: orderedRuleCodes/u)
  assert.match(create, /suggestedGrade: suggestedRuleGrade/u)
  assert.match(create, /主规则（单选）与全部命中规则（多选）/u)
  assert.match(feedback, /主规则 \/ 决定性规则/u)
  assert.match(feedback, /全部命中规则/u)
})

test('soft delete archives and hides without deleting the record', () => {
  assert.match(studio, /catalogStatus: 'archived'/u)
  assert.match(studio, /_status: 'draft'/u)
  assert.match(studio, /isLiteVisible: false/u)
  assert.match(studio, /isFullVisible: false/u)
  assert.match(studio, /恢复为待复核草稿/u)
  assert.match(studio, /First-party studio soft hide failed/u)
  assert.doesNotMatch(studio, /payload\.delete/u)
  assert.doesNotMatch(studio, /DELETE FROM/u)
})

test('legacy review editor links redirect into the studio', () => {
  assert.match(legacyEditor, /\/me\/studio\/works\//u)
  assert.doesNotMatch(legacyEditor, /payload\.update/u)
})

test('work introduction and rating source summary are editable but remain separate fields', () => {
  assert.match(editor, /name="summary"/u)
  assert.match(editor, /name="sourceSummary"/u)
  assert.match(editor, /作品简介（面向读者）/u)
  assert.match(editor, /来源摘要（AI \/ 规则评级依据）/u)
  assert.match(editor, /data\.summary = plainTextToRichText/u)
  assert.match(editor, /data\.radarAssessment/u)
  assert.match(editor, /sourceSummary,/u)
  assert.match(create, /name="summary"/u)
  assert.match(create, /plainTextToRichText\(summary\)/u)
  assert.match(create, /作品简介（面向读者）/u)
  assert.match(richText, /richTextToPlainText/u)
  assert.match(richText, /plainTextToRichText/u)
  assert.match(richText, /typeof value === 'string'/u)
  assert.match(richText, /plainText\?: unknown/u)
})

test('studio edits synchronize public indexes and remove hidden records', () => {
  assert.match(editor, /syncWorkToPublicIndexes/u)
  assert.match(config, /context\?\.firstPartyStudio/u)
  assert.match(sync, /search-index\.json/u)
  assert.match(sync, /detail-index\.json/u)
  assert.match(sync, /status: text\(work\._status\)/u)
  assert.match(sync, /catalogStatus: text\(work\.catalogStatus\)/u)
  assert.match(sync, /reviewReasonValues/u)
  assert.match(sync, /detailSections/u)
  assert.match(sync, /radarAssessment: work\.radarAssessment/u)
  assert.match(sync, /richTextToPlainText\(work\.summary\)/u)
  assert.match(sync, /work\.radarAssessment\?\.sourceSummary/u)
  assert.match(sync, /shouldRemoveFromPublicIndexes/u)
  assert.match(sync, /work\.isLiteVisible === false && work\.isFullVisible === false/u)
  assert.match(sync, /index\.items\.splice\(position, 1\)/u)
  assert.match(guards, /item\.catalogStatus === 'archived'/u)
  assert.match(fullExport, /build-and-enrich-lite-search-index\.mjs/u)
  assert.match(fullExport, /build-and-enrich-lite-detail-index\.mjs/u)
})

test('studio remains Payload-only and never writes PostgreSQL directly', () => {
  for (const source of [studio, editor, create, sync]) {
    assert.doesNotMatch(source, /pg_query|psql|ALTER TABLE|UPDATE works SET|DELETE FROM works/iu)
  }
})
