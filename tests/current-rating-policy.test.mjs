import test from 'node:test'
import assert from 'node:assert/strict'
import { loadPublicModule, loadPublicRelease } from '../scripts/lib/load-public-release.mjs'

const root = process.cwd()
const { resolveReview } = loadPublicModule(root, 'src/lib/sourceReview.ts')
const { ratingClassEntries } = loadPublicModule(root, 'src/lib/radar/publicPresentation.ts')
const { PUBLIC_GRADES } = loadPublicRelease(root)
const previous = { state: 'not_assessed', classes: [] }
const finding = (kind, grade, classes) => ({ kind, grade, classes, urls: [`https://example.org/${kind}`] })
const row = findings => ({ workId: '1', siteId: null, rationale: 'Scoped evidence for this edition.', findings })

test('the deciding grade carries every distinct supported class through to public cards', () => {
  const official = finding('official', 'F', ['F-HET-END', 'F-MALE-INTIMACY'])
  const community = finding('community', 'F', ['F-HET-END', 'F-MALE-NTR', 'F-MALE-ROMANTIC-AXIS'])
  const rating = resolveReview(row([community, official]), previous, PUBLIC_GRADES)
  assert.equal(rating.decidingSource, 'official')
  assert.deepEqual(ratingClassEntries(rating).map(entry => entry.code),
    ['F-HET-END', 'F-MALE-INTIMACY', 'F-MALE-NTR', 'F-MALE-ROMANTIC-AXIS'])
})

test('a retired X grade or class cannot enter a new assessment', () => {
  for (const grade of ['X', 'F']) {
    const retired = finding('official', grade, ['X-PREPAID-FRAUD'])
    assert.throws(() => resolveReview(row([retired]), previous, PUBLIC_GRADES), /Invalid source finding/)
  }
})

test('source attribution adds newly supported classes of the existing grade and keeps its primary class', () => {
  const existing = {
    state: 'rated', grade: 'F', class: 'F-HET-END', classes: ['F-MALE-INTIMACY', 'F-HET-END'],
    reasoningSummary: 'Original assessment.',
  }
  const update = { ...row([
    finding('community', 'F', ['F-HET-END', 'F-MALE-NTR']),
    finding('official', 'C', ['C-FRIENDSHIP']),
  ]), attributionOnly: true }
  const rating = resolveReview(update, existing, PUBLIC_GRADES)
  assert.equal(rating.class, existing.class)
  assert.equal(rating.reasoningSummary, existing.reasoningSummary)
  assert.deepEqual(rating.classes, ['F-MALE-INTIMACY', 'F-HET-END', 'F-MALE-NTR'])
  const legacy = resolveReview(update, { ...existing, classes: undefined }, PUBLIC_GRADES)
  assert.deepEqual(legacy.classes, ['F-HET-END', 'F-MALE-NTR'])
})

test('a continuity warning links an identified character and yields to a lower grade in this work', () => {
  const linked = finding('community', 'C', ['C-FRIENDSHIP', 'C-CONTINUITY-EF'])
  const continuity = [{ workId: '2', character: '同一人物' }]
  assert.throws(() => resolveReview(row([linked]), previous, PUBLIC_GRADES), /Invalid continuity reference/)
  assert.throws(() => resolveReview({ ...row([linked]), continuity: [{workId:'1', character:'同名'}] }, previous, PUBLIC_GRADES), /Invalid continuity reference/)
  const evaluate = findings => resolveReview({ ...row(findings), continuity }, previous, PUBLIC_GRADES)
  assert.deepEqual(evaluate([linked]).continuity, continuity)
  const intrinsic = evaluate([linked, finding('official', 'E', ['E-PAST-MALE-ROMANCE'])])
  assert.equal(intrinsic.grade, 'E')
  assert.deepEqual(intrinsic.classes, ['E-PAST-MALE-ROMANCE'])
  assert.equal(intrinsic.continuity, undefined)
})
