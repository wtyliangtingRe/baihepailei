import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('src/app/(frontend)/feedback/page.tsx')
const profile = read('src/lib/deploymentProfile.ts')
const layout = read('src/app/(frontend)/layout.tsx')
const styles = read('src/app/(frontend)/feedback.css')
const correctionForm = read('.github/ISSUE_TEMPLATE/work-correction.yml')
const newWorkForm = read('.github/ISSUE_TEMPLATE/new-work.yml')

test('feedback page always exposes a real authenticated submission link', () => {
  assert.match(profile, /DEFAULT_PUBLIC_FEEDBACK_ISSUE_URL/u)
  assert.match(page, /issueSubmissionHref/u)
  assert.match(page, /打开作品补充与纠错表/u)
  assert.match(page, /打开新作品提交表/u)
  assert.match(page, /targetWorkID/u)
  assert.match(page, /targetTitle/u)
  assert.match(page, /work_id/u)
  assert.match(page, /work_title/u)
  assert.match(page, /slice\(0, maxLength\)/u)
  assert.match(page, /\^\\d\{1,12\}\$/u)
})

test('issue forms collect structured evidence while preserving moderation boundaries', () => {
  for (const form of [correctionForm, newWorkForm]) {
    assert.match(form, /id: work_title/u)
    assert.match(form, /id: sources/u)
    assert.match(form, /required: true/u)
    assert.match(form, /不会自动/u)
  }
  assert.match(correctionForm, /id: work_id/u)
  assert.match(correctionForm, /id: feedback_kind/u)
  assert.match(correctionForm, /id: spoilers/u)
  assert.doesNotMatch(page, /\/api\/feedback-submissions/u)
})

test('feedback entry remains visible in navigation and has responsive channel styling', () => {
  assert.match(layout, /href: '\/feedback', label: '补充纠错'/u)
  assert.match(layout, /feedback\.css/u)
  assert.match(styles, /\.feedback-channel-grid/u)
  assert.match(styles, /\.feedback-channel-primary/u)
})
