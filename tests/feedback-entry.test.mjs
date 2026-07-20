import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('src/app/(frontend)/feedback/page.tsx')
const prompt = read('src/app/(frontend)/_components/FeedbackPrompt.tsx')
const form = read('src/app/(frontend)/_components/FeedbackForm.tsx')
const account = read('src/app/(frontend)/_components/AccountClient.tsx')
const layout = read('src/app/(frontend)/layout.tsx')
const styles = read('src/app/(frontend)/feedback.css')

test('feedback page provides a first-party moderated submission form', () => {
  assert.match(page, /FeedbackForm/u)
  assert.match(page, /人工排雷/u)
  assert.match(page, /规则与等级纠错/u)
  assert.match(form, /\/api\/feedback-submissions/u)
  assert.match(form, /证据链接/u)
  assert.match(form, /站内作品 ID/u)
  assert.doesNotMatch(form, /相关页面链接/u)
  assert.match(prompt, /提交人工材料/u)
})

test('feedback submissions remain available through account and content prompts without a duplicate top-nav item', () => {
  assert.doesNotMatch(layout, /href: '\/feedback', label: '反馈'/u)
  assert.match(account, /href="\/feedback"/u)
  assert.match(account, /提交人工排雷/u)
  assert.match(account, /提交新作品/u)
  assert.match(layout, /feedback\.css/u)
  assert.match(styles, /\.feedback-form/u)
  assert.doesNotMatch(prompt, /issues\/new/u)
})
