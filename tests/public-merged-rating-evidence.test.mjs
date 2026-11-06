import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPublicRelease } from '../scripts/lib/load-public-release.mjs'

const { selectMergedRating } = loadPublicRelease(process.cwd())

function work(rating, extra = {}) {
  return {
    localizedTitles: [], aliases: [], creators: [], organizations: [], sources: [], publicTags: [],
    rating: { state: 'rated', grade: 'B', classes: [], ...rating }, ...extra,
  }
}

test('merged reasons keep the URL from the same assessment', () => {
  const first = work({ reasoningSummary: '短的判断', evidenceUrl: 'https://example.test/first' }, { aliases: ['one'] })
  const second = work({ reasoningSummary: '这是另一条更详细的判断', evidenceUrl: 'https://example.test/second' })
  const result = selectMergedRating([first, second])
  assert.equal(result.reasoningSummary, second.rating.reasoningSummary)
  assert.equal(result.evidenceUrl, second.rating.evidenceUrl)
})

test('a reason without a URL is not paired with an unrelated assessment URL', () => {
  const first = work({ evidenceUrl: 'https://example.test/unrelated' }, { aliases: ['one'] })
  const second = work({ reasoningSummary: '暂时没有公开证据链接的判断' })
  const result = selectMergedRating([first, second])
  assert.equal(result.reasoningSummary, second.rating.reasoningSummary)
  assert.equal(result.evidenceUrl, undefined)
})

test('an assessment URL is preserved when no merged record has a reason', () => {
  const result = selectMergedRating([work({}), work({ evidenceUrl: 'https://example.test/source' })])
  assert.equal(result.reasoningSummary, undefined)
  assert.equal(result.evidenceUrl, 'https://example.test/source')
})

test('multiple cited sources stay attached to their own merged assessment', () => {
  const first = work({ reasoningSummary: '短', evidenceUrl: 'https://example.test/first', evidenceSources: [{url:'https://example.test/first',kind:'official'}] })
  const second = work({ reasoningSummary: '这是更详细的判断', evidenceUrl: 'https://example.test/second', evidenceSources: [{url:'https://example.test/community',kind:'community'}] })
  const result = selectMergedRating([first, second])
  assert.equal(result.reasoningSummary, second.rating.reasoningSummary)
  assert.deepEqual(result.evidenceSources, second.rating.evidenceSources)
})
