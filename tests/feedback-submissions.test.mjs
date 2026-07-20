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

test('directly accepted new-work drafts receive every factual proposal field', () => {
  assert.match(collection, /linkedWorkID !== previousLinkedWorkID/u)
  assert.match(collection, /directIntakeDraft/u)
  assert.match(collection, /newWorkProposalToWorkTransfer/u)
  assert.match(collection, /feedbackMetadataTransfer: true/u)
  assert.match(collection, /plainTextToRichText\(transfer\.summaryText\)/u)
  assert.match(proposal, /originalTitle/u)
  assert.match(proposal, /aliases: \(metadata\.aliases \|\| \[\]\)\.map/u)
  assert.match(proposal, /localizedTitles/u)
  assert.match(proposal, /mediaGroup: metadata\.mediaGroup \|\| 'unknown'/u)
  assert.match(proposal, /mediaType: metadata\.mediaType \|\| 'unknown'/u)
  assert.match(proposal, /format: metadata\.format \|\| 'unknown'/u)
  assert.match(proposal, /firstPublishedAt: metadata\.firstPublishedAt \|\| null/u)
  assert.match(proposal, /firstPublishedPrecision: metadata\.firstPublishedPrecision \|\| 'unknown'/u)
  assert.match(proposal, /firstPublishedLabel: metadata\.firstPublishedLabel \|\| ''/u)
  assert.doesNotMatch(proposal, /radarAssessment|humanAssessment/u)
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

test('proposal transfer never writes member-authored ratings or AI conclusions', () => {
  assert.match(collection, /collection: 'works'/u)
  assert.match(collection, /req\.payload\.update/u)
  assert.doesNotMatch(collection, /workData\.radarAssessment|workData\.humanAssessment|workData\.suggestedGrade/u)
})

test('members can only revise their own still-open submissions', () => {
  assert.match(collection, /ownEditableSubmissionOrStaff/u)
  assert.match(collection, /in: \['pending', 'needs_information'\]/u)
  assert.match(collection, /update: ownEditableSubmissionOrStaff/u)
})
