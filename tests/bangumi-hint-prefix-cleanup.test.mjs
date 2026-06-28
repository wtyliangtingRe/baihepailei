import test from 'node:test'
import assert from 'node:assert/strict'

import { createRawSourceRecord, sourceRecordToCandidateWork } from '../tools/source_import/lib/source-record.mjs'

test('Bangumi hint cleanup strips music cooperation prefixes from organization names', () => {
  const record = createRawSourceRecord({
    source: 'bangumi',
    sourceRecordId: 'music-prefixes',
    sourceUrl: 'https://bgm.tv/subject/music-prefixes',
    raw: {
      name_cn: '音乐前缀候选',
      mediaType: 'anime',
      organizationCreditHints: [
        { name: '音乐协力:テレビ東京ミュージック', role: 'music_label', originalRole: '音乐协力', source: 'bangumi' },
        { name: '音楽協力:ランティス', role: 'music_label', originalRole: '音楽協力', source: 'bangumi' },
        { name: '音楽制作協力:ポニーキャニオン', role: 'music_label', originalRole: '音楽制作協力', source: 'bangumi' },
        { name: '音乐制作:フライングドッグ', role: 'music_label', originalRole: '音乐制作', source: 'bangumi' },
      ],
    },
  })

  const candidate = sourceRecordToCandidateWork(record)

  assert.deepEqual(candidate.organizationCreditHints.map((row) => row.name), [
    'テレビ東京ミュージック',
    'ランティス',
    'ポニーキャニオン',
    'フライングドッグ',
  ])
  assert.match(candidate.organizationCreditHints[0].note, /cleaned Bangumi hint name/u)
})
