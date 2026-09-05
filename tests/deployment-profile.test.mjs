import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const profile = read('src/lib/deploymentProfile.ts')
const detail = read('src/app/(frontend)/_components/DetailIndexDetail.tsx')
const fallback = read('src/app/(frontend)/_components/SearchIndexDetail.tsx')
const feedback = read('src/app/(frontend)/feedback/page.tsx')
const compact = read('scripts/export/compact-public-index.mjs')

test('complete enhanced mode is the default and text mode remains an explicit low-bandwidth option', () => {
  assert.match(profile, /NEXT_PUBLIC_MEDIA_MODE/u)
  assert.match(profile, /=== 'text'/u)
  assert.match(profile, /\? 'text'\s*:\s*'enhanced'/u)
  assert.match(detail, /publicContentImagesEnabled/u)
  assert.match(detail, /showImages && item\.collection/u)
  assert.match(fallback, /showImages && item\.collection/u)
})

test('feedback page has an authenticated default channel and no first-party anonymous write', () => {
  assert.match(profile, /DEFAULT_PUBLIC_FEEDBACK_ISSUE_URL/u)
  assert.match(profile, /\/baihepailei\/issues\/new/u)
  assert.match(profile, /parsed\.protocol === 'https:'/u)
  assert.match(feedback, /publicFeedbackChannels/u)
  assert.match(feedback, /work-correction\.yml/u)
  assert.match(feedback, /new-work\.yml/u)
  assert.match(feedback, /mailto:/u)
  assert.match(feedback, /外部材料表单/u)
  assert.match(feedback, /不用注册或绑定本站账号/u)
  assert.doesNotMatch(feedback, /\/api\/feedback-submissions/u)
  assert.doesNotMatch(profile, /NEXT_PUBLIC_FEEDBACK_EMAIL'\] \|\| process\.env\['SITE_OWNER_EMAIL/u)
})

test('export pipeline records media profile and writes compact JSON', () => {
  assert.match(compact, /payload\.mediaMode/u)
  assert.match(compact, /JSON\.stringify\(payload\)/u)
})
