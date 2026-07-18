import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const resolver = read('src/lib/radar/effectiveWorkGrade.ts')
const worksPage = read('src/app/(frontend)/works/page.tsx')
const searchIndex = read('src/app/(frontend)/_lib/search-index.ts')
const sync = read('src/lib/publicIndexSync.ts')

test('effective catalog grade uses human review before AI suggestions', () => {
  assert.match(resolver, /if \(humanReviewed\) return \{ grade: storedGrade, source: 'human'/u)
  assert.match(resolver, /item\.radarAssessment\?\.suggestedGrade \|\| item\.researchPreview\?\.likelyGrade/u)
  assert.match(resolver, /source: 'ai'/u)
  assert.match(resolver, /source: 'ai_legacy'/u)
  assert.match(resolver, /source: 'unassessed'/u)
})

test('works catalog filters sorts groups and cards by one displayed grade', () => {
  assert.match(worksPage, /function displayedGrade/u)
  assert.match(worksPage, /rankSortValue\(displayedGrade\(a\)\.grade\)/u)
  assert.match(worksPage, /const rank = displayedGrade\(item\)\.grade/u)
  assert.match(worksPage, /pageItems\.filter\(\(item\) => displayedGrade\(item\)\.grade === rank\)/u)
  assert.match(worksPage, /rankLabel\(grade\.grade\)/u)
  assert.match(worksPage, /effectiveWorkGradeLabel\(grade\.source\)/u)
  assert.match(worksPage, /人工正式评级优先/u)
})

test('retired merged works are removed from public index views and sync', () => {
  assert.match(searchIndex, /isMergedDuplicateWork/u)
  assert.match(searchIndex, /mergedIntoWorkId/u)
  assert.match(sync, /isMergedDuplicateWork\(work\)/u)
  assert.match(sync, /mergedIntoWorkId: mergeTarget\?\.id/u)
  assert.match(sync, /radarAssessment: work\.radarAssessment/u)
})
