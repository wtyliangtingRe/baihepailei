import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  classifySteamApp,
  classifyVndbRow,
  parseSteamSearchAppIds,
  parseYurizukanArticle,
  parseYurizukanArticleIds,
  steamAppToCandidate,
  vndbApiRowToCandidate,
} from '../scripts/radar/fetch-controlled-source-snapshots-v01.mjs'

test('Yurizukan list and detail parsing produces a traceable candidate', () => {
  const listHtml = '<a href="/articles/articleDetail/7737">A</a><a href="/articles/articleDetail/7738">B</a><a href="/articles/articleDetail/7737">A</a>'
  assert.deepEqual(parseYurizukanArticleIds(listHtml), ['7737', '7738'])
  const detail = '<html><body><h1>百合小説コレクション wiz 2</h1><div>媒体</div><div>小説</div><a href="https://www.amazon.co.jp/dp/1234567890">Amazon</a></body></html>'
  const row = parseYurizukanArticle(detail, '7737', '2026-07-21T00:00:00.000Z')
  assert.equal(row.title, '百合小説コレクション wiz 2')
  assert.equal(row.mediaType, 'novel')
  assert.equal(row.firstYurizukanId, '7737')
  assert.equal(row.sourceLinks[0].url, 'https://www.yurizukan.com/articles/articleDetail/7737')
})

test('VNDB tag gates separate romance and sex-only candidates', () => {
  const romance = classifyVndbRow({ tags: [{ id: 'g97', rating: 2, category: 'cont' }], image: { sexual: 0 } })
  assert.equal(romance.status, 'ordinary_romance_create_review')
  const sexOnly = classifyVndbRow({ tags: [{ id: 'g82', rating: 2, category: 'ero' }], image: { sexual: 2 } })
  assert.equal(sexOnly.status, 'lesbian_sex_only_review')
  const row = vndbApiRowToCandidate({ id: 'v123', title: 'Example Yuri', alttitle: '例', released: '2026-07-01', tags: [{ id: 'g97', rating: 2, category: 'cont' }] }, '2026-07-21T00:00:00.000Z')
  assert.equal(row.vndbId, 'v123')
  assert.equal(row.yuriCreateCandidateV3.firstWaveEligible, true)
  assert.equal(row.createCandidatePreview.payloadPreview.externalIds.vndbId, 'v123')
})

test('Steam search parsing deduplicates app ids and only classifies page evidence', () => {
  const ids = parseSteamSearchAppIds({ results_html: '<a data-ds-appid="11" href="/app/11/x"></a><a href="/app/22/y"></a><a data-ds-appid="11"></a>' })
  assert.deepEqual(ids, ['11', '22'])

  const unrelated = { name: 'Ordinary Puzzle', short_description: 'A quiet tile-matching puzzle.', required_age: 0 }
  assert.equal(classifySteamApp(unrelated, ['yuri']).bucket, 'p9-other-review', 'the discovery query itself must not become content evidence')

  const app = { name: 'Example', short_description: 'A yuri girls love romance.', required_age: 0, release_date: { date: '1 Jul, 2026' } }
  assert.equal(classifySteamApp(app, ['yuri']).bucket, 'p1-strong-yuri-nonadult')
  const row = steamAppToCandidate('11', app, ['yuri'], '2026-07-21T00:00:00.000Z')
  assert.equal(row.bucket, 'p1-strong-yuri-nonadult')
  assert.equal(row.createCandidatePreview.payloadPreview.externalIds.steamAppId, '11')
})

test('online refresh and fetch commands reject direct writes', () => {
  const fetchSource = fs.readFileSync('scripts/radar/fetch-controlled-source-snapshots-v01.mjs', 'utf8')
  const refreshSource = fs.readFileSync('scripts/radar/run-controlled-online-refresh-v01.mjs', 'utf8')
  assert.match(fetchSource, /cannot apply, create, update, assess, or publish Works/u)
  assert.match(refreshSource, /checkpoint-gated release stage/u)
})
