import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('src/app/(frontend)/me/review/public-catalog/page.tsx')
const contentPage = read('src/app/(frontend)/me/review/content/page.tsx')
const feedbackPage = read('src/app/(frontend)/me/review/feedback/page.tsx')
const feedbackDetailPage = read('src/app/(frontend)/me/review/feedback/[id]/page.tsx')
const works = read('src/collections/Works.ts')
const creators = read('src/collections/Creators.ts')
const organizations = read('src/collections/Organizations.ts')
const reviewFields = read('src/collections/fields/contentReview.ts')
const css = read('src/app/(frontend)/review-workbench.css')

test('review workbench is paginated and queries the database', () => {
  assert.match(page, /limit: filters\.perPage/u)
  assert.match(page, /page: filters\.page/u)
  assert.match(page, /buildWhere\(filters\)/u)
  assert.doesNotMatch(page, /limit: 2000/u)
  assert.match(css, /\.review-row-facts/u)
})

test('single-entry review actions leave publication and grade untouched', () => {
  assert.match(page, /updateReviewAction/u)
  assert.match(page, /humanReviewedAt/u)
  assert.match(page, /humanReviewedBy/u)
  assert.match(page, /decision === 'reviewed'/u)
  assert.doesNotMatch(page, /data\.rank\s*=/u)
  assert.doesNotMatch(page, /data\.status\s*=/u)
  assert.match(works, /name: 'humanReviewNote'/u)
})

test('research queues remain clearly separate from formal ratings', () => {
  assert.match(page, /radar-research-records/u)
  assert.match(page, /研究建议，不等于正式评级/u)
  assert.match(page, /不会把 25,048 条研究建议写进正式评级/u)
})

test('unified content workbench covers works, creators and organizations', () => {
  assert.match(contentPage, /type ContentCollection = 'works' \| 'creators' \| 'organizations'/u)
  assert.match(contentPage, /saveContentAction/u)
  assert.match(contentPage, /AI 已评估只说明机器整理已经存在，不代表人工通过/u)
  assert.match(contentPage, /canonicalContentUrl/u)
  assert.match(contentPage, /完整编辑/u)
  assert.match(contentPage, /value="approve"/u)
  assert.match(contentPage, /value="reject"/u)
  assert.match(contentPage, /limit: filters\.perPage/u)
  assert.match(contentPage, /AI 建议：/u)
  assert.match(creators, /contentReviewFields/u)
  assert.match(organizations, /contentReviewFields/u)
  assert.match(reviewFields, /name: 'reviewOrigin'/u)
  assert.match(reviewFields, /value: 'ai_assessed'/u)
  assert.match(css, /\.review-content-form/u)
})

test('user submissions have a first-party queue with explicit accept and reject decisions', () => {
  assert.match(feedbackPage, /collection: 'feedback-submissions'/u)
  assert.match(feedbackPage, /value="accepted"/u)
  assert.match(feedbackPage, /value="rejected"/u)
  assert.match(feedbackPage, /value="needs_information"/u)
  assert.match(feedbackPage, /不会自动覆盖作品等级/u)
  assert.match(feedbackPage, /reviewWorkbench: true/u)
  assert.match(feedbackPage, /reviewError/u)
  assert.match(feedbackPage, /站内完整详情/u)
  assert.doesNotMatch(feedbackPage, /采纳、未采纳或要求补充材料时必须填写/u)
  assert.match(feedbackDetailPage, /用户反馈完整详情/u)
  assert.match(feedbackDetailPage, /全部证据链接/u)
})
