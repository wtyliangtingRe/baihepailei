import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const payloadConfig = read('payload.config.ts')
const account = read('src/app/(frontend)/_components/AccountClient.tsx')
const feedback = read('src/app/(frontend)/_components/FeedbackForm.tsx')
const feedbackPage = read('src/app/(frontend)/feedback/page.tsx')
const feedbackDetail = read('src/app/(frontend)/me/review/feedback/[id]/page.tsx')
const workRoute = read('src/app/(frontend)/works/[slug]/page.tsx')
const reviewUtils = read('src/app/(frontend)/me/review/content/review-utils.ts')
const retirements = read('src/app/(frontend)/review-editor-retirements.css')

test('Payload admin is restricted to owner and admin through the configured auth collection', () => {
  assert.match(payloadConfig, /UsersWithRestrictedAdmin/u)
  assert.match(payloadConfig, /admin:\s*\(\{ req \}\) => isAdmin\(req\.user\)/u)
  assert.match(payloadConfig, /user: UsersWithRestrictedAdmin\.slug/u)
})

test('account dashboard separates content management, review queues and advanced maintenance', () => {
  assert.match(account, /href="\/me\/studio"/u)
  assert.match(account, /'站内内容管理'/u)
  assert.match(account, /<strong>AI \/ 内容审核<\/strong>/u)
  assert.match(account, /<strong>用户反馈审核<\/strong>/u)
  assert.match(account, /mayUsePayload/u)
  assert.match(account, /<strong>Payload 高级维护<\/strong>/u)
  assert.match(account, /user\.role === 'owner' \|\| user\.role === 'admin'/u)
})

test('all signed-in users can choose a dedicated new-work proposal mode', () => {
  assert.match(account, /'提交新作品'/u)
  assert.match(feedbackPage, /requestedType/u)
  assert.match(feedback, /initialType/u)
  assert.match(feedback, /feedbackType === 'new_work'/u)
  assert.match(feedback, /新作品申请已经进入人工审核队列/u)
  assert.match(feedback, /linkedWork: workID \? Number\(workID\) : undefined/u)
})

test('accepted feedback clearly requires an explicit implementation step in content management', () => {
  assert.match(feedbackDetail, /已采纳”只表示材料成立，不会自动改作品/u)
  assert.match(feedbackDetail, /现在编辑关联作品/u)
  assert.match(feedbackDetail, /检查重复并创建草稿/u)
  assert.match(feedbackDetail, /\/me\/studio\/works\//u)
})

test('legacy review publication values are normalized without direct database writes', () => {
  assert.match(payloadConfig, /data\.status !== 'review'/u)
  assert.match(payloadConfig, /data\.reviewStatus === 'reviewed' \? 'published' : 'draft'/u)
  assert.match(reviewUtils, /normalizePublicationStatus/u)
  assert.match(reviewUtils, /isStudio/u)
})

test('staff work pages can overlay current Payload values while public indexes stay stable', () => {
  assert.match(workRoute, /staffLiveWork/u)
  assert.match(workRoute, /工作人员实时预览/u)
  assert.match(workRoute, /ordinary visitors|普通访客/u)
})

test('retired matrix and daily Payload links are removed from the first-party workspace', () => {
  assert.match(retirements, /nth-of-type\(3\)/u)
  assert.match(retirements, /a\[href\^='\/admin'\]/u)
})
