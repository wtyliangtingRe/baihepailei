import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  bangumiRawSourceRecordSubjectId,
  createBangumiSearchRequestBody,
  createCurlJsonArgs,
  normalizeBangumiKeywordMode,
  readBangumiResumeState,
} from '../tools/source_import/scripts/fetch-bangumi-tagged-subjects.mjs'
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

test('Bangumi fetcher builds curl args with a scoped proxy', () => {
  const args = createCurlJsonArgs(
    new URL('https://api.bgm.tv/v0/search/subjects?limit=5&offset=0'),
    {
      method: 'POST',
      headers: {
        'User-Agent': 'BaihepaileiSourceImport/0.1',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ keyword: '百合' }),
    },
    { proxy: 'socks5h://127.0.0.1:10808' },
  )

  assert.deepEqual(args.slice(0, 8), [
    '--silent',
    '--show-error',
    '--fail',
    '--location',
    '--connect-timeout',
    '30',
    '--request',
    'POST',
  ])
  assert.match(args.join('\n'), /--proxy\nsocks5h:\/\/127\.0\.0\.1:10808/u)
  assert.match(args.join('\n'), /--data-binary\n\{"keyword":"百合"\}/u)
  assert.equal(args.at(-1), 'https://api.bgm.tv/v0/search/subjects?limit=5&offset=0')
})

test('Bangumi search body keeps tag keyword mode as the default behavior', () => {
  assert.deepEqual(createBangumiSearchRequestBody({ tag: '百合', type: 2, sort: 'rank' }), {
    keyword: '百合',
    sort: 'rank',
    filter: {
      tag: ['百合'],
      type: [2],
    },
  })
})

test('Bangumi search body can probe empty and omitted keyword modes', () => {
  assert.deepEqual(createBangumiSearchRequestBody({ tag: '百合', type: 2, sort: 'rank', keywordMode: 'empty' }), {
    keyword: '',
    sort: 'rank',
    filter: {
      tag: ['百合'],
      type: [2],
    },
  })

  assert.deepEqual(createBangumiSearchRequestBody({ tag: '百合', type: 2, sort: 'rank', keywordMode: 'none' }), {
    sort: 'rank',
    filter: {
      tag: ['百合'],
      type: [2],
    },
  })
})

test('Bangumi keyword mode normalizer falls back to tag mode', () => {
  assert.equal(normalizeBangumiKeywordMode('empty'), 'empty')
  assert.equal(normalizeBangumiKeywordMode('none'), 'none')
  assert.equal(normalizeBangumiKeywordMode('TAG'), 'tag')
  assert.equal(normalizeBangumiKeywordMode('invalid'), 'tag')
})

test('Bangumi resume ids prefer sourceRecordId and fall back to raw subject ids', () => {
  assert.equal(bangumiRawSourceRecordSubjectId({ source: 'bangumi', sourceRecordId: 101 }), '101')
  assert.equal(bangumiRawSourceRecordSubjectId({ source: 'bangumi', raw: { subject_id: 102 } }), '102')
  assert.equal(bangumiRawSourceRecordSubjectId({ source: 'other', sourceRecordId: 103 }), '')
})

test('Bangumi fetcher reads resume ids from existing raw JSONL', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bangumi-resume-'))

  try {
    const file = path.join(dir, 'existing.jsonl')
    await writeFile(
      file,
      [
        JSON.stringify({ source: 'bangumi', sourceRecordId: 201, raw: { id: 201, name: 'Existing A' } }),
        JSON.stringify({ source: 'bangumi', raw: { subject_id: 202, name: 'Existing B' } }),
      ].join('\n') + '\n',
      'utf8',
    )

    const state = await readBangumiResumeState(file)

    assert.equal(state.records.length, 2)
    assert.deepEqual([...state.ids].sort(), ['201', '202'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Bangumi fetch resume state starts empty when output is missing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bangumi-resume-missing-'))

  try {
    const state = await readBangumiResumeState(path.join(dir, 'missing.jsonl'))

    assert.equal(state.records.length, 0)
    assert.equal(state.ids.size, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
