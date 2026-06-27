import test from 'node:test'
import assert from 'node:assert/strict'

import {
  annotateBangumiYuriSignal,
  bangumiSubjectToCandidateInput,
  scoreBangumiYuriTags,
  subjectPassesYuriTagThreshold,
} from '../tools/source_import/sources/bangumi.mjs'

const strongSubject = {
  id: 1,
  type: 2,
  name: 'Strong Yuri Sample',
  name_cn: '强百合样本',
  date: '2020-01-01',
  tags: [
    { name: '百合', count: 120 },
    { name: '校园', count: 40 },
  ],
}

const lightSubject = {
  id: 2,
  type: 2,
  name: 'Light Yuri Sample',
  name_cn: '轻百合样本',
  date: '2020-01-01',
  tags: [
    { name: '轻百合', count: 20 },
  ],
}

const weakSubject = {
  id: 3,
  type: 2,
  name: 'Weak Sample',
  name_cn: '弱样本',
  date: '2020-01-01',
  tags: [
    { name: '校园', count: 20 },
    { name: '日常', count: 15 },
  ],
}

test('Bangumi yuri tag scoring prefers high-count yuri tags', () => {
  const signal = scoreBangumiYuriTags(strongSubject)

  assert.equal(signal.matchedTags.length, 1)
  assert.equal(signal.matchedTags[0].name, '百合')
  assert.equal(signal.maxCount, 120)
  assert.equal(signal.weightedScore, 120)
  assert.equal(signal.candidateScore, 1)
})

test('Bangumi yuri tag scoring supports light yuri labels with lower weight', () => {
  const signal = scoreBangumiYuriTags(lightSubject)

  assert.equal(signal.matchedTags.length, 1)
  assert.equal(signal.matchedTags[0].matchedAs, '轻百合')
  assert.equal(signal.weightedScore, 15)
  assert.equal(subjectPassesYuriTagThreshold(lightSubject, { minWeightedScore: 10, minTopTagCount: 10 }), true)
})

test('Bangumi yuri tag threshold rejects subjects without matching tags', () => {
  assert.equal(subjectPassesYuriTagThreshold(weakSubject), false)
})

test('Annotated Bangumi signal flows into candidate source notes and score', () => {
  const annotated = annotateBangumiYuriSignal(strongSubject)
  const candidate = bangumiSubjectToCandidateInput(annotated)

  assert.equal(candidate.yuriCandidateScore, 1)
  assert.match(candidate.candidateSources[0].note, /百合\(120\)/u)
})
