import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const rules = read('src/app/(frontend)/_components/RadarRuleSelector.tsx')
const feedback = read('src/app/(frontend)/_components/FeedbackForm.tsx')
const create = read('src/app/(frontend)/me/studio/works/new/page.tsx')
const editor = read('src/app/(frontend)/me/studio/works/[id]/page.tsx')
const stewardshipSelector = read('src/app/(frontend)/me/studio/works/[id]/StewardshipNoticeSelector.tsx')
const pending = read('src/app/(frontend)/me/studio/_components/PendingSubmitButton.tsx')
const feedbackCollection = read('src/collections/FeedbackSubmissions.ts')
const searchIndex = read('src/app/(frontend)/_lib/search-index.ts')

test('rule choices use native disclosures with a distinct primary rule', () => {
  assert.match(rules, /<select name=\{decisiveName\}/u)
  assert.match(rules, /<details/u)
  assert.match(rules, /<summary>/u)
  assert.match(rules, /全部命中规则/u)
  assert.match(rules, /主规则（决定性规则）/u)
  assert.match(rules, /首次勾选会自动成为主规则/u)
  assert.match(rules, /type="hidden" value=\{option\.code\}/u)
})

test('stewardship disclosure is type-safe and remains manually collapsible', () => {
  assert.match(stewardshipSelector, /const \[isOpen, setIsOpen\] = useState/u)
  assert.match(stewardshipSelector, /open=\{isOpen\}/u)
  assert.match(stewardshipSelector, /onToggle=\{\(event\) => setIsOpen\(event\.currentTarget\.open\)\}/u)
  assert.doesNotMatch(stewardshipSelector, /defaultOpen/u)
})

test('feedback preserves primary-first rule ordering without changing its schema shape', () => {
  assert.match(feedback, /\[decisiveRuleCode, \.\.\.selectedRuleCodes\]/u)
  assert.match(feedback, /matchedRuleCodes: rules/u)
  assert.match(feedbackCollection, /第一项作为主规则 \/ 决定性规则/u)
  assert.match(feedbackCollection, /name: 'matchedRuleCodes'/u)
  assert.doesNotMatch(feedbackCollection, /name: 'decisiveRuleCode'/u)
})

test('staff draft creation resolves a primary rule on both client and server', () => {
  assert.match(create, /const resolvedDecisiveRuleCode = decisiveRuleCode \|\| matchedRuleCodes\[0\] \|\| null/u)
  assert.match(create, /const suggestedRuleGrade: RadarGrade \| null/u)
  assert.match(create, /radarClassDefinitions\[resolvedDecisiveRuleCode\]\.grade/u)
  assert.match(create, /suggestedGrade: suggestedRuleGrade/u)
  assert.match(create, /policyVersion: RADAR_RATING_POLICY_ID/u)
  assert.match(create, /decisiveRuleCode: resolvedDecisiveRuleCode \|\| undefined/u)
  assert.match(create, /matchedRules: orderedRuleCodes\.map/u)
  assert.match(create, /requiresHumanReview: true/u)
})

test('full work editor maintains rule suggestions separately from the human grade', () => {
  assert.match(editor, /RadarRuleSelector/u)
  assert.match(editor, /主规则与全部命中规则/u)
  assert.match(editor, /resolvedDecisiveRuleCode/u)
  assert.match(editor, /suggestedGrade: resolvedDecisiveRuleCode/u)
  assert.match(editor, /matchedRules: orderedRuleCodes\.map/u)
  assert.match(editor, /人工正式分级/u)
  assert.match(editor, /PendingSubmitButton/u)
  assert.match(pending, /useFormStatus/u)
  assert.match(pending, /disabled=\{pending\}/u)
})

test('organization cards hide imported leading punctuation without rewriting source data', () => {
  assert.match(searchIndex, /function cleanImportedOrganizationTitle/u)
  assert.match(searchIndex, /item\.collection !== 'organizations'/u)
  assert.match(searchIndex, /replace\(\/\^\[\\s\.:：/u)
  assert.match(searchIndex, /\.map\(cleanImportedOrganizationTitle\)/u)
  assert.doesNotMatch(searchIndex, /payload\.update|UPDATE organizations/iu)
})
