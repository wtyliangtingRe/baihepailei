import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const collection = read('src/collections/FeedbackSubmissions.ts')
const form = read('src/app/(frontend)/_components/FeedbackForm.tsx')
const prompt = read('src/app/(frontend)/_components/FeedbackPrompt.tsx')
const proposal = read('src/lib/newWorkProposal.ts')
const migration = read('scripts/migrations/20260720-add-feedback-new-work-metadata.sql')
const config = read('payload.config.ts')

test('feedback collection is registered with a moderated workflow', () => {
  assert.match(config, /FeedbackSubmissions/u)
  assert.match(collection, /slug: 'feedback-submissions'/u)
  assert.match(collection, /create: signedIn/u)
  assert.match(collection, /workflowStatus: 'pending'/u)
  assert.match(collection, /value: 'accepted'/u)
  assert.match(collection, /value: 'rejected'/u)
})

test('human radar material keeps grade, rules, sources and spoiler state', () => {
  assert.match(collection, /name: 'proposedGrade'/u)
  assert.match(collection, /name: 'matchedRuleCodes'/u)
  assert.match(collection, /name: 'evidenceLinks'/u)
  assert.match(collection, /name: 'containsSpoilers'/u)
  assert.match(form, /proposedGrade/u)
  assert.match(form, /matchedRuleCodes/u)
  assert.match(form, /提交给人工审核/u)
})

test('new work proposals keep catalog metadata but exclude member-authored AI assessment fields', () => {
  assert.match(collection, /name: 'newWorkMetadata'/u)
  assert.match(collection, /type: 'json'/u)
  assert.match(collection, /sanitizeNewWorkProposalMetadata/u)
  assert.match(collection, /next\.proposedGrade = null/u)
  assert.match(collection, /next\.matchedRuleCodes = \[\]/u)
  assert.match(form, /newWorkOriginalTitle/u)
  assert.match(form, /newWorkAliases/u)
  assert.match(form, /newWorkMediaGroup/u)
  assert.match(form, /newWorkFirstPublishedAt/u)
  assert.match(form, /newWorkSummary/u)
  assert.match(form, /newWorkSearchText/u)
  assert.match(form, /proposedGrade: isNewWork \? undefined/u)
  assert.match(form, /matchedRuleCodes: isNewWork \? \[\]/u)
  assert.match(proposal, /NewWorkProposalMetadata/u)
  assert.match(proposal, /sanitizeNewWorkProposalMetadata/u)
})

test('structured proposal storage is an additive nullable JSONB migration', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "new_work_metadata" jsonb/u)
  assert.match(migration, /BEGIN;/u)
  assert.match(migration, /COMMIT;/u)
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|DELETE FROM|UPDATE /iu)
})

test('detail feedback prompt routes into the internal form', () => {
  assert.match(prompt, /feedbackPageUrl/u)
  assert.match(prompt, /\/feedback\?/u)
  assert.match(prompt, /params\.set\('workId', item\.recordId\)/u)
  assert.doesNotMatch(prompt, /params\.set\('workId', item\.id\)/u)
  assert.match(form, /站内作品 ID/u)
  assert.doesNotMatch(form, /type="url"/u)
  assert.match(collection, /label: '关联站内作品 ID'/u)
  assert.match(form, /linkedWork: workID \? Number\(workID\) : undefined/u)
  assert.match(collection, /name: 'pageUrl'.*hidden: true/u)
  assert.doesNotMatch(prompt, /github\.com\/wtyliangtingRe\/baihepailei\/issues\/new/u)
})

test('accepted submissions never auto-write work ratings', () => {
  assert.doesNotMatch(collection, /collection: 'works'/u)
  assert.doesNotMatch(collection, /req\.payload\.update/u)
})

test('members can only revise their own still-open submissions', () => {
  assert.match(collection, /ownEditableSubmissionOrStaff/u)
  assert.match(collection, /in: \['pending', 'needs_information'\]/u)
  assert.match(collection, /update: ownEditableSubmissionOrStaff/u)
})
