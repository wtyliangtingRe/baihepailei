import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const feedbackPage = fs.readFileSync(new URL('../src/app/(frontend)/feedback/page.tsx', import.meta.url), 'utf8')
const feedbackPrompt = fs.readFileSync(new URL('../src/app/(frontend)/_components/FeedbackPrompt.tsx', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const styles = fs.readFileSync(new URL('../src/app/(frontend)/feedback.css', import.meta.url), 'utf8')

const detailRoutes = [
  '../src/app/(frontend)/works/[slug]/page.tsx',
  '../src/app/(frontend)/creators/[slug]/page.tsx',
  '../src/app/(frontend)/organizations/[slug]/page.tsx',
  '../src/app/(frontend)/evidence/[slug]/page.tsx',
  '../src/app/(frontend)/terms/[slug]/page.tsx',
  '../src/app/(frontend)/rules/[slug]/page.tsx',
].map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8'))

test('feedback page provides correction entry points', () => {
  assert.ok(feedbackPage.includes('反馈与纠错'))
  assert.ok(feedbackPage.includes('信息错误'))
  assert.ok(feedbackPage.includes('补充证据'))
  assert.ok(feedbackPage.includes('链接失效'))
  assert.ok(feedbackPage.includes('页面显示问题'))
  assert.ok(feedbackPage.includes('FeedbackPrompt'))
})

test('feedback prompt creates prefilled github issue links', () => {
  assert.ok(feedbackPrompt.includes('feedbackIssueUrl'))
  assert.ok(feedbackPrompt.includes('https://github.com/wtyliangtingRe/baihepailei/issues/new'))
  assert.ok(feedbackPrompt.includes('URLSearchParams'))
  assert.ok(feedbackPrompt.includes('信息错误'))
  assert.ok(feedbackPrompt.includes('补充证据'))
  assert.ok(feedbackPrompt.includes('链接失效'))
  assert.ok(feedbackPrompt.includes('页面显示问题'))
  assert.ok(feedbackPrompt.includes('提交反馈'))
})

test('feedback navigation and styles are wired', () => {
  assert.ok(layout.includes("{ href: '/feedback', label: '反馈' }"))
  assert.ok(layout.includes("import './feedback.css'"))
  assert.ok(styles.includes('.feedback-page'))
  assert.ok(styles.includes('.feedback-prompt'))
  assert.ok(styles.includes('.feedback-grid'))
})

test('detail routes render feedback prompt for detail-index pages', () => {
  for (const route of detailRoutes) {
    assert.ok(route.includes('FeedbackPrompt'))
    assert.ok(route.includes('<FeedbackPrompt item={detailItem} />'))
  }
})

test('feedback entry avoids old wiki source concepts', () => {
  const combined = [feedbackPage, feedbackPrompt].join('\n')
  assert.equal(combined.includes('legacyXWikiPage'), false)
  assert.equal(combined.includes('旧站来源'), false)
})
